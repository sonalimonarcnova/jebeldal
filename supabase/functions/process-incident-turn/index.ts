// process-incident-turn — transcribe (audio) + extract proposals for the revision's triggered forms.
// Uses the team's _shared/backend.ts helpers (caller-JWT PostgREST access, error envelope) and persists ONLY through
// RPCs: begin_incident_turn (start + idempotency) → record_incident_turn_result (processing / completed / failed).
// It never writes answers; the app saves accepted proposals with save_incident_answer (saveAcceptedProposals).
// The 200 body is a superset of what the interview app parses (turn_id, status). See docs/voice-integration.md.
import { corsHeaders } from '../_shared/cors.ts';
import {
  authenticateRequest,
  backendErrorCode,
  errorResponse,
  jsonResponse,
  readJsonResponse,
  type AuthenticatedBackend,
} from '../_shared/backend.ts';
import { incidentTurnSchema } from '../_shared/schema.ts';
import { MIN_AUDIO_BYTES, sniffAudio } from './audio.ts';
import type { CatalogEntry } from './catalog.ts';
import {
  buildFormCatalog,
  findQuestion,
  withQuestionFirst,
  type FormDefinitionRow,
  type TriggeredForm,
} from './form_catalog.ts';
import { buildInterviewCatalog, isInterviewGraph } from './interview_catalog.ts';
import { getProviders, ProviderError, type ProviderMode, type Providers } from './providers.ts';
import { validateProposals, type FieldProposal, type ValidationResult } from './validate.ts';

const FN = 'process-incident-turn';
const BUCKET = 'incident-evidence';
const STALE_PROCESSING_MS = 60_000;

/** Codes known to _shared/backend.ts errorResponse (status is decided there). */
type BackendCode =
  | 'AUTH_REQUIRED'
  | 'NOT_ALLOWED'
  | 'INCIDENT_NOT_DRAFT'
  | 'TURN_ID_REUSED'
  | 'VALIDATION_FAILED'
  | 'PROVIDER_UNAVAILABLE'
  | 'RETRYABLE_FAILURE'
  | 'INTERNAL_ERROR'
  | 'METHOD_NOT_ALLOWED';

type TurnResponse = {
  turn_id: string;
  client_turn_id: string;
  status: 'completed';
  transcript: string;
  applied: FieldProposal[];
  suggested: FieldProposal[];
  latency_ms: { stt: number; llm: number };
  mode: ProviderMode;
};

/** Stored via record_incident_turn_result into conversation_turns.extraction_proposals. */
type StoredExtraction = {
  version: 3;
  question_key: string | null;
  mode: ProviderMode;
  catalog_source: 'interview_graph' | 'form_definitions';
  forms: string[];
  rejected: ValidationResult['rejected'];
  response: TurnResponse;
  /** Exact JSON text of the first response; jsonb reorders keys, so replays send this string verbatim. */
  response_body: string;
};

/** Shape returned by begin_incident_turn / record_incident_turn_result. */
type TurnState = {
  turn_id: string;
  client_turn_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  transcript: string | null;
  proposals: unknown;
  error_code: string | null;
};

/** A failure with a driver-safe message; `errorCode` is the short code stored on the turn and logged. */
class TurnError extends Error {
  readonly code: BackendCode;
  readonly retryable: boolean;
  readonly errorCode: string;
  constructor(code: BackendCode, message: string, retryable: boolean, errorCode?: string) {
    super(message);
    this.code = code;
    this.retryable = retryable;
    this.errorCode = errorCode ?? code.toLowerCase();
  }
}

const turnErrorResponse = (e: TurnError) => errorResponse(e.code, { message: e.message, retryable: e.retryable });

const replayResponse = (stored: StoredExtraction) =>
  new Response(stored.response_body ?? JSON.stringify(stored.response), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

function isStored(value: unknown): value is StoredExtraction {
  return typeof value === 'object' && value !== null && typeof (value as StoredExtraction).response_body === 'string';
}

// Logs ids, status, latency and mode only — never transcripts, audio, payloads or keys.
function log(fields: Record<string, unknown>) {
  console.log(JSON.stringify({ fn: FN, ...fields }));
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const start = performance.now();
  const value = await fn();
  return { value, ms: Math.round(performance.now() - start) };
}

// ---------------------------------------------------------------------------
// PostgREST / RPC / Storage access with the caller's JWT (backend.headers)
// ---------------------------------------------------------------------------
const transient = (stage: string) =>
  new TurnError('RETRYABLE_FAILURE', 'Something went wrong. Please try again.', true, `db_${stage}`);

/** Maps an RPC / PostgREST error body (P0001 reason in `message`) to a TurnError. */
function backendFailure(stage: string, body: unknown): TurnError {
  const code = backendErrorCode(body);
  switch (code) {
    case 'AUTH_REQUIRED':
      return new TurnError('AUTH_REQUIRED', 'Sign in again to continue.', false, 'auth_required');
    case 'NOT_ALLOWED':
      return new TurnError('NOT_ALLOWED', 'This report was not found.', false, 'not_allowed');
    case 'INCIDENT_NOT_DRAFT':
      return new TurnError('INCIDENT_NOT_DRAFT', 'This report was already submitted.', false, 'incident_not_draft');
    case 'TURN_ID_REUSED':
      return new TurnError('TURN_ID_REUSED', 'This answer id was already used for different input.', false, 'turn_id_reused');
    case 'VALIDATION_FAILED':
      return new TurnError('VALIDATION_FAILED', 'The answer could not be accepted.', false, `${stage}_validation_failed`);
    default:
      return transient(stage);
  }
}

async function select<T>(backend: AuthenticatedBackend, stage: string, path: string): Promise<T[]> {
  let result: { ok: boolean; body: unknown };
  try {
    result = await readJsonResponse(await fetch(`${backend.url}/rest/v1/${path}`, { headers: backend.headers }));
  } catch {
    throw transient(stage);
  }
  if (!result.ok) throw backendFailure(stage, result.body);
  if (!Array.isArray(result.body)) throw transient(stage);
  return result.body as T[];
}

async function rpc<T>(backend: AuthenticatedBackend, stage: string, fn: string, args: Record<string, unknown>): Promise<T> {
  let result: { ok: boolean; body: unknown };
  try {
    result = await readJsonResponse(
      await fetch(`${backend.url}/rest/v1/rpc/${fn}`, { method: 'POST', headers: backend.headers, body: JSON.stringify(args) }),
    );
  } catch {
    throw transient(stage);
  }
  if (!result.ok) throw backendFailure(stage, result.body);
  return result.body as T;
}

const q = (params: Record<string, string>) => new URLSearchParams(params).toString();

// ---------------------------------------------------------------------------
// Catalog: interview graph nodes pinned to the triggered forms (fallback: all definition fields)
// ---------------------------------------------------------------------------
type Revision = { id: string; status: string; language: string | null; form_set_key: string; form_set_version: number };

async function loadCatalog(backend: AuthenticatedBackend, revision: Revision) {
  const triggered = await select<TriggeredForm>(
    backend,
    'revision_forms',
    `incident_revision_forms?${q({ select: 'form_key,form_version', incident_revision_id: `eq.${revision.id}`, activation_status: 'eq.triggered' })}`,
  );
  if (triggered.length === 0) {
    throw new TurnError('VALIDATION_FAILED', 'This report has no active forms yet.', false, 'no_triggered_forms');
  }
  const definitions = await select<FormDefinitionRow>(
    backend,
    'form_definitions',
    `form_definitions?${q({ select: 'form_key,version,definition', form_key: `in.(${triggered.map((f) => f.form_key).join(',')})` })}`,
  );
  const pinned = triggered.map((f) => ({
    form_key: f.form_key,
    definition: definitions.find((d) => d.form_key === f.form_key && d.version === f.form_version)?.definition,
  }));
  const forms = triggered.map((f) => f.form_key);

  const [formSet] = await select<{ definition: { interview_graph?: unknown } | null }>(
    backend,
    'form_sets',
    `form_sets?${q({ select: 'definition', form_set_key: `eq.${revision.form_set_key}`, version: `eq.${revision.form_set_version}` })}`,
  );
  const graph = formSet?.definition?.interview_graph;

  if (isInterviewGraph(graph)) {
    const built = buildInterviewCatalog(graph, pinned);
    if (built.skipped.length > 0 || built.groupFields.length > 0) {
      log({
        event: 'catalog_skipped',
        revision_id: revision.id,
        skipped_fields: built.skipped.map((s) => `${s.form_key}.${s.field_key}:${s.type}`),
        repeated_group_fields: built.groupFields, // TODO: voice needs create_incident_answer_group for these
      });
    }
    if (built.catalog.length > 0) return { catalog: built.catalog, forms, source: 'interview_graph' as const };
  }

  // No graph (or nothing pinned): every supported definition field, stub catalog for empty forms.
  const fallback = buildFormCatalog(triggered, definitions);
  log({
    event: 'catalog_fallback',
    revision_id: revision.id,
    reason: isInterviewGraph(graph) ? 'no_pinned_nodes' : 'no_interview_graph',
    stub_forms: fallback.fallbackForms,
  });
  return { catalog: fallback.catalog, forms, source: 'form_definitions' as const };
}

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------
type LoadedAudio = { blob: Blob; filename: string };
type LogContext = { revision_id: string; turn_id: string };

const RERECORD = 'The recording did not save properly. Please record your answer again or type it.';

/**
 * Evidence row (read-only) → storage download with the caller's JWT → content sniffing. The STT filename/type come
 * from the real bytes, not the object path (create_incident_evidence paths have no extension).
 */
async function loadAudio(backend: AuthenticatedBackend, revisionId: string, evidenceId: string, ctx: LogContext): Promise<LoadedAudio> {
  const [evidence] = await select<{ object_path: string; media_type: string; upload_status: string; size_bytes: number | null }>(
    backend,
    'evidence',
    `evidence?${q({ select: 'object_path,media_type,upload_status,size_bytes', id: `eq.${evidenceId}`, incident_revision_id: `eq.${revisionId}` })}`,
  );
  log({
    event: 'stage',
    stage: 'evidence_lookup',
    ...ctx,
    status: evidence ? 'found' : 'missing',
    media_type: evidence?.media_type,
    upload_status: evidence?.upload_status,
    size_bytes: evidence?.size_bytes,
  });
  if (!evidence) throw new TurnError('NOT_ALLOWED', 'That recording was not found for this report.', false, 'evidence_missing');
  if (evidence.media_type !== 'audio' || evidence.upload_status !== 'uploaded') {
    throw new TurnError('VALIDATION_FAILED', 'The recording is not an uploaded audio clip.', false, 'audio_not_uploaded');
  }

  let bytes: Uint8Array;
  let contentType: string | null;
  try {
    const path = evidence.object_path.split('/').map(encodeURIComponent).join('/');
    const response = await fetch(`${backend.url}/storage/v1/object/authenticated/${BUCKET}/${path}`, { headers: backend.headers });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`storage ${response.status}`);
    }
    contentType = response.headers.get('content-type');
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch {
    log({ event: 'stage', stage: 'storage_download', ...ctx, status: 'failed' });
    throw new TurnError('RETRYABLE_FAILURE', 'Could not load the recording. Please try again.', true, 'storage_download');
  }
  const sniffed = sniffAudio(bytes);
  log({ event: 'stage', stage: 'storage_download', ...ctx, status: 'ok', bytes: bytes.length, content_type: contentType, sniffed_format: sniffed.format });

  if (bytes.length < MIN_AUDIO_BYTES) throw new TurnError('VALIDATION_FAILED', RERECORD, false, 'audio_too_small');
  if (sniffed.format === 'unknown') throw new TurnError('VALIDATION_FAILED', RERECORD, false, 'audio_not_audio');
  if (!sniffed.sttSupported) throw new TurnError('VALIDATION_FAILED', RERECORD, false, `audio_unsupported_${sniffed.format}`);
  return { blob: new Blob([bytes], { type: sniffed.mime }), filename: `audio.${sniffed.ext}` };
}

/** The driver's own words for the current question (narrative always; other text questions if nothing applied). */
function withOwnWords(result: ValidationResult, question: CatalogEntry | undefined, transcript: string): ValidationResult {
  if (!question) return result;
  const isQuestion = (p: FieldProposal) => p.form_key === question.formKey && p.field_key === question.fieldKey;
  const ownWords: FieldProposal = {
    form_key: question.formKey ?? '',
    field_key: question.fieldKey ?? question.key,
    value: transcript,
    confidence: 1,
    evidence_quote: transcript,
  };
  const fits = question.maxLength === undefined || transcript.length <= question.maxLength;
  if (question.narrative && fits) {
    return {
      ...result,
      applied: [...result.applied.filter((p) => !isQuestion(p)), ownWords],
      suggested: result.suggested.filter((p) => !isQuestion(p)),
    };
  }
  if (question.extractType === 'text' && fits && !result.applied.some(isQuestion)) {
    return { ...result, applied: [...result.applied, ownWords], suggested: result.suggested.filter((p) => !isQuestion(p)) };
  }
  return result;
}

/** Response for a turn completed before this pipeline stored its own result (e.g. by the earlier text-only stub). */
function legacyCompleted(turn: TurnState, mode: ProviderMode): Response {
  return jsonResponse({
    turn_id: turn.turn_id,
    client_turn_id: turn.client_turn_id,
    status: 'completed',
    transcript: turn.transcript ?? '',
    applied: [],
    suggested: [],
    latency_ms: { stt: 0, llm: 0 },
    mode,
  });
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
async function handle(req: Request): Promise<Response> {
  const backend = await authenticateRequest(req);
  if (backend instanceof Response) return backend;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse('VALIDATION_FAILED', { message: 'Request body must be JSON.', retryable: false });
  }
  const parsed = incidentTurnSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse('VALIDATION_FAILED', { message: 'Invalid turn request.', retryable: false, issues: parsed.error.flatten() });
  }
  const input = parsed.data;

  // RLS only returns revisions of incidents the caller reported, so "not found" = not allowed.
  const [revision] = await select<Revision>(
    backend,
    'revision',
    `incident_revisions?${q({ select: 'id,status,language,form_set_key,form_set_version', id: `eq.${input.incident_revision_id}` })}`,
  );
  if (!revision) throw new TurnError('NOT_ALLOWED', 'This report was not found.', false, 'not_allowed');

  // A completed turn replays its stored response even after submission (begin_incident_turn refuses non-drafts).
  if (revision.status !== 'draft') {
    const [done] = await select<{ status: string; extraction_proposals: unknown }>(
      backend,
      'turn',
      `conversation_turns?${q({ select: 'status,extraction_proposals', incident_revision_id: `eq.${revision.id}`, client_turn_id: `eq.${input.client_turn_id}` })}`,
    );
    if (done?.status === 'completed' && isStored(done.extraction_proposals)) return replayResponse(done.extraction_proposals);
    throw new TurnError('INCIDENT_NOT_DRAFT', 'This report was already submitted.', false, 'incident_not_draft');
  }

  // Catalog + current question before begin_incident_turn, so a catalog failure never leaves a pending turn behind.
  const loaded = await loadCatalog(backend, revision);
  const question = findQuestion(loaded.catalog, input.question_key, input.form_key, input.field_key);
  if (!question && (input.question_key || input.field_key)) {
    // Pinned question with no proposable field (e.g. a date or a repeated-group field): extract the rest anyway.
    log({ event: 'question_not_in_catalog', revision_id: revision.id });
  }
  const catalog = withQuestionFirst(loaded.catalog, question);

  let providers: Providers;
  try {
    providers = getProviders();
  } catch (error) {
    const code = error instanceof ProviderError ? error.code : 'config_missing';
    throw new TurnError('PROVIDER_UNAVAILABLE', 'Voice processing is not available right now. Please type your answer.', false, code);
  }

  const language = revision.language === 'es' ? 'es' : 'en';
  const turn = await rpc<TurnState>(backend, 'begin_turn', 'begin_incident_turn', {
    p_incident_revision_id: revision.id,
    p_client_turn_id: input.client_turn_id,
    p_text: input.text ?? null,
    p_audio_evidence_id: input.audio_evidence_id ?? null,
    p_language: language,
  });
  if (!turn || typeof turn.turn_id !== 'string') throw transient('begin_turn');

  if (turn.status === 'completed') {
    log({ event: 'turn_replayed', revision_id: revision.id, turn_id: turn.turn_id, status: 'completed' });
    return isStored(turn.proposals) ? replayResponse(turn.proposals) : legacyCompleted(turn, providers.mode);
  }
  if (turn.status === 'processing') {
    const [current] = await select<{ updated_at: string }>(
      backend,
      'turn',
      `conversation_turns?${q({ select: 'updated_at', id: `eq.${turn.turn_id}` })}`,
    );
    const fresh = current ? Date.now() - new Date(current.updated_at).getTime() < STALE_PROCESSING_MS : true;
    if (fresh) throw new TurnError('RETRYABLE_FAILURE', 'This answer is still being processed.', true, 'turn_in_progress');
    // stale processing: take it over below
  }

  const record = (args: { status: 'processing' | 'completed' | 'failed'; transcript?: string; proposals?: StoredExtraction; errorCode?: string }) =>
    rpc<TurnState>(backend, 'record_turn', 'record_incident_turn_result', {
      p_incident_revision_id: revision.id,
      p_turn_id: turn.turn_id,
      p_status: args.status,
      p_transcript: args.transcript ?? null,
      p_proposals: args.proposals ?? null,
      p_error_code: args.errorCode ?? null,
    });
  await record({ status: 'processing' });

  const ctx = { revision_id: revision.id, turn_id: turn.turn_id };
  const started = performance.now();
  const latency = { stt: 0, llm: 0 };
  const inputKind = input.audio_evidence_id ? 'audio' : 'text';
  try {
    let transcript: string;
    if (input.audio_evidence_id) {
      const audio = await loadAudio(backend, revision.id, input.audio_evidence_id, ctx);
      const stt = await timed(() => providers.stt.transcribe(audio.blob, language, audio.filename));
      transcript = stt.value.trim();
      latency.stt = stt.ms;
      log({ event: 'stage', stage: 'stt', ...ctx, status: 'ok', mode: providers.mode, filename: audio.filename, ms: stt.ms, chars: transcript.length });
    } else {
      transcript = (input.text ?? '').trim();
    }
    // record_incident_turn_result requires a transcript for 'completed'.
    if (!transcript) {
      throw new TurnError('VALIDATION_FAILED', 'We did not catch any words. Please try again or type your answer.', false, 'empty_transcript');
    }

    const llm = await timed(() => providers.extract.extract({ transcript, questionKey: question?.key ?? '', catalog }));
    latency.llm = llm.ms;
    const result = withOwnWords(validateProposals(llm.value, transcript, catalog), question, transcript);

    const response: TurnResponse = {
      turn_id: turn.turn_id,
      client_turn_id: input.client_turn_id,
      status: 'completed',
      transcript,
      applied: result.applied,
      suggested: result.suggested,
      latency_ms: latency,
      mode: providers.mode,
    };
    const stored: StoredExtraction = {
      version: 3,
      question_key: question?.key ?? null,
      mode: providers.mode,
      catalog_source: loaded.source,
      forms: loaded.forms,
      rejected: result.rejected,
      response,
      response_body: JSON.stringify(response),
    };
    await record({ status: 'completed', transcript, proposals: stored });

    log({
      event: 'turn_completed',
      ...ctx,
      status: 'completed',
      mode: providers.mode,
      input_kind: inputKind,
      forms: loaded.forms,
      catalog_source: loaded.source,
      catalog_size: catalog.length,
      applied: response.applied.length,
      suggested: response.suggested.length,
      rejected: result.rejected.length,
      latency_ms: { ...latency, total: Math.round(performance.now() - started) },
    });
    return replayResponse(stored);
  } catch (error) {
    const turnError =
      error instanceof TurnError
        ? error
        : error instanceof ProviderError
          ? new TurnError('PROVIDER_UNAVAILABLE', 'We could not process that answer. Try again or type it instead.', error.retryable, error.code)
          : new TurnError('RETRYABLE_FAILURE', 'Something went wrong. Please try again.', true, 'internal');

    // Best effort: the turn stays retryable with the same client_turn_id.
    await record({ status: 'failed', errorCode: turnError.errorCode }).catch(() => undefined);

    const providerInfo = error instanceof ProviderError ? error.info : {};
    log({
      event: 'turn_failed',
      ...ctx,
      status: 'failed',
      mode: providers.mode,
      input_kind: inputKind,
      error_code: turnError.errorCode,
      stage: error instanceof ProviderError ? error.code.split('_')[0] : undefined,
      provider_status: providerInfo.status,
      provider_error_type: providerInfo.type,
      provider_error_code: providerInfo.code,
      latency_ms: { ...latency, total: Math.round(performance.now() - started) },
    });
    throw turnError;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return errorResponse('METHOD_NOT_ALLOWED');
  try {
    return await handle(req);
  } catch (error) {
    if (error instanceof TurnError) return turnErrorResponse(error);
    log({ event: 'unhandled_error', status: 'failed', error_code: error instanceof Error ? error.name : 'unknown' });
    return errorResponse('INTERNAL_ERROR', { message: 'Something went wrong. Please try again.', retryable: true });
  }
});
