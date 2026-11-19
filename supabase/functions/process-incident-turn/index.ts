// process-incident-turn — transcribe (audio) + extract proposals for the revision's triggered forms.
// Persistence goes ONLY through Eng B's RPCs with the caller's JWT:
//   begin_incident_turn (start + idempotency) → record_incident_turn_result (processing / completed / failed).
// This function never writes answers. The app saves accepted proposals with save_incident_answer
// (apps/mobile/src/lib/api.ts saveAcceptedProposals). See docs/voice-integration.md.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.49.4';
import { corsHeaders } from '../_shared/cors.ts';
import { incidentTurnSchema } from '../_shared/schema.ts';
import { MIN_AUDIO_BYTES, sniffAudio } from './audio.ts';
import type { CatalogEntry } from './catalog.ts';
import { buildFormCatalog, findQuestion, type FormDefinitionRow, type TriggeredForm } from './form_catalog.ts';
import { getProviders, ProviderError, type ProviderMode, type Providers } from './providers.ts';
import { validateProposals, type FieldProposal, type ValidationResult } from './validate.ts';

const FN = 'process-incident-turn';
const BUCKET = 'incident-evidence';
const STALE_PROCESSING_MS = 60_000;

type ErrorCode = 'PROVIDER_UNAVAILABLE' | 'VALIDATION_FAILED' | 'NOT_ALLOWED' | 'INCIDENT_NOT_DRAFT';

type TurnResponse = {
  turn_id: string;
  status: 'completed';
  transcript: string;
  applied: FieldProposal[];
  suggested: FieldProposal[];
  latency_ms: { stt: number; llm: number };
  mode: ProviderMode;
};

/** Stored via record_incident_turn_result into conversation_turns.extraction_proposals. */
type StoredExtraction = {
  version: 2;
  question_key: string;
  mode: ProviderMode;
  forms: string[];
  fallback_forms: string[];
  rejected: ValidationResult['rejected'];
  response: TurnResponse;
  /** Exact JSON text of the first response; jsonb reorders keys, so replays send this string verbatim. */
  response_body: string;
};

/** Shape returned by begin_incident_turn / record_incident_turn_result. */
type TurnState = {
  turn_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  transcript: string | null;
  proposals: StoredExtraction | null;
  error_code: string | null;
};

class HttpError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly errorCode: string;
  constructor(status: number, code: ErrorCode, message: string, retryable: boolean, errorCode?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.errorCode = errorCode ?? code.toLowerCase();
  }
}

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const replay = (stored: StoredExtraction) =>
  new Response(stored.response_body ?? JSON.stringify(stored.response), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const errorResponse = (e: HttpError) => json({ code: e.code, message: e.message, retryable: e.retryable }, e.status);

// Logs ids, status, latency and mode only — never transcripts, audio, payloads or keys.
function log(fields: Record<string, unknown>) {
  console.log(JSON.stringify({ fn: FN, ...fields }));
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const start = performance.now();
  const value = await fn();
  return { value, ms: Math.round(performance.now() - start) };
}

function dbFailure(stage: string): HttpError {
  return new HttpError(503, 'PROVIDER_UNAVAILABLE', 'Something went wrong saving your answer. Please try again.', true, `db_${stage}`);
}

/** Maps Eng B's RPC exceptions (errcode P0001, reason in `message`) to the §3.3 error contract. */
function rpcFailure(stage: string, error: { code?: string; message?: string }): HttpError {
  const reason = error.code === 'P0001' ? (error.message ?? '') : '';
  switch (reason) {
    case 'AUTH_REQUIRED':
      return new HttpError(401, 'NOT_ALLOWED', 'Sign in again to continue.', false, 'auth_required');
    case 'NOT_ALLOWED':
      return new HttpError(403, 'NOT_ALLOWED', 'This report was not found.', false, 'not_allowed');
    case 'INCIDENT_NOT_DRAFT':
      return new HttpError(409, 'INCIDENT_NOT_DRAFT', 'This report was already submitted.', false, 'incident_not_draft');
    case 'TURN_ID_REUSED':
      return new HttpError(400, 'VALIDATION_FAILED', 'This answer id was already used for different input.', false, 'turn_id_reused');
    case 'VALIDATION_FAILED':
      return new HttpError(400, 'VALIDATION_FAILED', 'The answer could not be accepted.', false, `${stage}_validation_failed`);
    default:
      return dbFailure(stage);
  }
}

// ---------------------------------------------------------------------------
// Catalog from the revision's triggered forms
// ---------------------------------------------------------------------------
async function loadCatalog(db: SupabaseClient, revisionId: string) {
  const { data: forms, error: formsError } = await db
    .from('incident_revision_forms')
    .select('form_key, form_version')
    .eq('incident_revision_id', revisionId)
    .eq('activation_status', 'triggered');
  if (formsError) throw dbFailure('revision_forms_select');
  const triggered = (forms ?? []) as TriggeredForm[];
  if (triggered.length === 0) {
    throw new HttpError(409, 'VALIDATION_FAILED', 'This report has no active forms yet.', false, 'no_triggered_forms');
  }

  const { data: defs, error: defsError } = await db
    .from('form_definitions')
    .select('form_key, version, definition')
    .in('form_key', triggered.map((f) => f.form_key));
  if (defsError) throw dbFailure('form_definitions_select');

  const built = buildFormCatalog(triggered, (defs ?? []) as FormDefinitionRow[]);
  if (built.fallbackForms.length > 0 || built.skipped.length > 0) {
    log({
      event: 'catalog_degraded',
      revision_id: revisionId,
      fallback_forms: built.fallbackForms, // triggered forms with no usable fields → stub catalog used
      skipped_fields: built.skipped.map((s) => `${s.form_key}.${s.field_key}:${s.type}`),
    });
  }
  return { ...built, forms: triggered.map((f) => f.form_key) };
}

// ---------------------------------------------------------------------------
// Turn bookkeeping via RPC
// ---------------------------------------------------------------------------
async function beginTurn(
  db: SupabaseClient,
  input: { incident_revision_id: string; client_turn_id: string; text?: string; audio_evidence_id?: string },
  language: string,
): Promise<TurnState> {
  const { data, error } = await db.rpc('begin_incident_turn', {
    p_incident_revision_id: input.incident_revision_id,
    p_client_turn_id: input.client_turn_id,
    p_text: input.text ?? null,
    p_audio_evidence_id: input.audio_evidence_id ?? null,
    p_language: language,
  });
  if (error) throw rpcFailure('begin_turn', error);
  return data as TurnState;
}

async function recordTurn(
  db: SupabaseClient,
  revisionId: string,
  turnId: string,
  patch: { status: 'processing' | 'completed' | 'failed'; transcript?: string; proposals?: StoredExtraction; errorCode?: string },
): Promise<void> {
  const { error } = await db.rpc('record_incident_turn_result', {
    p_incident_revision_id: revisionId,
    p_turn_id: turnId,
    p_status: patch.status,
    p_transcript: patch.transcript ?? null,
    p_proposals: patch.proposals ?? null,
    p_error_code: patch.errorCode ?? null,
  });
  if (error) throw rpcFailure('record_turn', error);
}

/** Read-only lookup (conversation_turns is SELECT-only for drivers). */
async function readTurn(db: SupabaseClient, revisionId: string, clientTurnId: string) {
  const { data } = await db
    .from('conversation_turns')
    .select('id, status, extraction_proposals, updated_at')
    .eq('incident_revision_id', revisionId)
    .eq('client_turn_id', clientTurnId)
    .maybeSingle();
  return data as { id: string; status: string; extraction_proposals: StoredExtraction | null; updated_at: string } | null;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
type LoadedAudio = { blob: Blob; filename: string };
type LogContext = { revision_id: string; turn_id: string };

const RERECORD = 'The recording did not save properly. Please record your answer again or type it.';

/**
 * Evidence row (read-only) → storage download → content sniffing. The STT filename/type come from the real bytes,
 * not the object path (create_incident_evidence paths have no extension).
 */
async function loadAudio(db: SupabaseClient, revisionId: string, evidenceId: string, ctx: LogContext): Promise<LoadedAudio> {
  const { data, error } = await db
    .from('evidence')
    .select('object_path, media_type, upload_status, size_bytes')
    .eq('id', evidenceId)
    .eq('incident_revision_id', revisionId)
    .maybeSingle();
  if (error) throw dbFailure('evidence_select');
  const evidence = data as { object_path: string; media_type: string; upload_status: string; size_bytes: number | null } | null;
  log({
    event: 'stage',
    stage: 'evidence_lookup',
    ...ctx,
    status: evidence ? 'found' : 'missing',
    media_type: evidence?.media_type,
    upload_status: evidence?.upload_status,
    size_bytes: evidence?.size_bytes,
  });
  if (!evidence) throw new HttpError(403, 'NOT_ALLOWED', 'That recording was not found for this report.', false);
  if (evidence.media_type !== 'audio' || evidence.upload_status !== 'uploaded') {
    throw new HttpError(400, 'VALIDATION_FAILED', 'The recording is not an uploaded audio clip.', false, 'audio_not_uploaded');
  }

  const { data: stored, error: downloadError } = await db.storage.from(BUCKET).download(evidence.object_path);
  if (downloadError || !stored) {
    log({ event: 'stage', stage: 'storage_download', ...ctx, status: 'failed' });
    throw new HttpError(503, 'PROVIDER_UNAVAILABLE', 'Could not load the recording. Please try again.', true, 'storage_download');
  }
  const bytes = new Uint8Array(await stored.arrayBuffer());
  const sniffed = sniffAudio(bytes);
  log({
    event: 'stage',
    stage: 'storage_download',
    ...ctx,
    status: 'ok',
    bytes: bytes.length,
    content_type: stored.type || null,
    sniffed_format: sniffed.format,
  });

  if (bytes.length < MIN_AUDIO_BYTES) throw new HttpError(400, 'VALIDATION_FAILED', RERECORD, false, 'audio_too_small');
  if (sniffed.format === 'unknown') throw new HttpError(400, 'VALIDATION_FAILED', RERECORD, false, 'audio_not_audio');
  if (!sniffed.sttSupported) {
    throw new HttpError(400, 'VALIDATION_FAILED', RERECORD, false, `audio_unsupported_${sniffed.format}`);
  }
  return { blob: new Blob([bytes], { type: sniffed.mime }), filename: `audio.${sniffed.ext}` };
}

/** The driver's own words for the current question (narrative always; other text questions if nothing applied). */
function withOwnWords(result: ValidationResult, question: CatalogEntry, transcript: string): ValidationResult {
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
    return { ...result, applied: [...result.applied.filter((p) => !isQuestion(p)), ownWords], suggested: result.suggested.filter((p) => !isQuestion(p)) };
  }
  if (question.extractType === 'text' && fits && !result.applied.some(isQuestion)) {
    return { ...result, applied: [...result.applied, ownWords], suggested: result.suggested.filter((p) => !isQuestion(p)) };
  }
  return result;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
async function handle(req: Request): Promise<Response> {
  const authorization = req.headers.get('Authorization') ?? '';
  const jwt = authorization.replace(/^Bearer\s+/i, '');
  if (!jwt) throw new HttpError(401, 'NOT_ALLOWED', 'Sign in again to continue.', false);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, 'VALIDATION_FAILED', 'Request body must be JSON.', false);
  }
  const parsed = incidentTurnSchema.safeParse(body);
  if (!parsed.success) {
    throw new HttpError(
      400,
      'VALIDATION_FAILED',
      parsed.error.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)).join('; '),
      false,
    );
  }
  const input = parsed.data;

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? '';
  const db = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await db.auth.getUser(jwt);
  if (userError || !userData.user) throw new HttpError(401, 'NOT_ALLOWED', 'Sign in again to continue.', false);

  // RLS only returns revisions of incidents the caller reported, so "not found" = not allowed.
  const { data: revisionRow, error: revisionError } = await db
    .from('incident_revisions')
    .select('id, status, language')
    .eq('id', input.incident_revision_id)
    .maybeSingle();
  if (revisionError) throw dbFailure('revision_select');
  if (!revisionRow) throw new HttpError(403, 'NOT_ALLOWED', 'This report was not found.', false);
  const revision = revisionRow as { id: string; status: string; language: string | null };

  // A completed turn replays its stored response even after submission (begin_incident_turn refuses non-drafts).
  if (revision.status !== 'draft') {
    const done = await readTurn(db, revision.id, input.client_turn_id);
    if (done?.status === 'completed' && done.extraction_proposals?.response) return replay(done.extraction_proposals);
    throw new HttpError(409, 'INCIDENT_NOT_DRAFT', 'This report was already submitted.', false);
  }

  // Catalog + question first, so an invalid question_key never leaves a pending turn behind.
  const { catalog, forms, fallbackForms } = await loadCatalog(db, revision.id);
  const question = findQuestion(catalog, input.question_key);
  if (!question) throw new HttpError(400, 'VALIDATION_FAILED', 'Unknown question_key for this report.', false, 'unknown_question');

  let providers: Providers;
  try {
    providers = getProviders();
  } catch (error) {
    const code = error instanceof ProviderError ? error.code : 'config_missing';
    throw new HttpError(503, 'PROVIDER_UNAVAILABLE', 'Voice processing is not available right now. Please type your answer.', false, code);
  }

  const language = revision.language === 'es' ? 'es' : 'en';
  const turn = await beginTurn(db, input, language);
  if (turn.status === 'completed' && turn.proposals?.response) {
    log({ event: 'turn_replayed', revision_id: revision.id, turn_id: turn.turn_id, status: 'completed' });
    return replay(turn.proposals);
  }
  if (turn.status === 'processing') {
    const current = await readTurn(db, revision.id, input.client_turn_id);
    const fresh = current ? Date.now() - new Date(current.updated_at).getTime() < STALE_PROCESSING_MS : true;
    if (fresh) throw new HttpError(409, 'PROVIDER_UNAVAILABLE', 'This answer is still being processed.', true, 'turn_in_progress');
    // stale processing: take it over below
  }
  await recordTurn(db, revision.id, turn.turn_id, { status: 'processing' });

  const ctx = { revision_id: revision.id, turn_id: turn.turn_id };
  const started = performance.now();
  const latency = { stt: 0, llm: 0 };
  const inputKind = input.audio_evidence_id ? 'audio' : 'text';
  try {
    let transcript: string;
    if (input.audio_evidence_id) {
      const audio = await loadAudio(db, revision.id, input.audio_evidence_id, ctx);
      const stt = await timed(() => providers.stt.transcribe(audio.blob, language, audio.filename));
      transcript = stt.value.trim();
      latency.stt = stt.ms;
      log({ event: 'stage', stage: 'stt', ...ctx, status: 'ok', mode: providers.mode, filename: audio.filename, ms: stt.ms, chars: transcript.length });
    } else {
      transcript = (input.text ?? '').trim();
    }
    // record_incident_turn_result requires a transcript for 'completed'.
    if (!transcript) {
      throw new HttpError(400, 'VALIDATION_FAILED', 'We did not catch any words. Please try again or type your answer.', false, 'empty_transcript');
    }

    const llm = await timed(() => providers.extract.extract({ transcript, questionKey: question.key, catalog }));
    latency.llm = llm.ms;
    const result = withOwnWords(validateProposals(llm.value, transcript, catalog), question, transcript);

    const response: TurnResponse = {
      turn_id: turn.turn_id,
      status: 'completed',
      transcript,
      applied: result.applied,
      suggested: result.suggested,
      latency_ms: latency,
      mode: providers.mode,
    };
    const stored: StoredExtraction = {
      version: 2,
      question_key: question.key,
      mode: providers.mode,
      forms,
      fallback_forms: fallbackForms,
      rejected: result.rejected,
      response,
      response_body: JSON.stringify(response),
    };
    await recordTurn(db, revision.id, turn.turn_id, { status: 'completed', transcript, proposals: stored });

    log({
      event: 'turn_completed',
      ...ctx,
      status: 'completed',
      mode: providers.mode,
      input_kind: inputKind,
      forms,
      applied: response.applied.length,
      suggested: response.suggested.length,
      rejected: result.rejected.length,
      latency_ms: { ...latency, total: Math.round(performance.now() - started) },
    });
    return replay(stored);
  } catch (error) {
    const httpError =
      error instanceof HttpError
        ? error
        : error instanceof ProviderError
          ? new HttpError(503, 'PROVIDER_UNAVAILABLE', 'We could not process that answer. Try again or type it instead.', error.retryable, error.code)
          : new HttpError(503, 'PROVIDER_UNAVAILABLE', 'Something went wrong. Please try again.', true, 'internal');

    // Best effort: the turn stays retryable with the same client_turn_id.
    await recordTurn(db, revision.id, turn.turn_id, { status: 'failed', errorCode: httpError.errorCode }).catch(() => undefined);

    const providerInfo = error instanceof ProviderError ? error.info : {};
    log({
      event: 'turn_failed',
      ...ctx,
      status: 'failed',
      mode: providers.mode,
      input_kind: inputKind,
      error_code: httpError.errorCode,
      stage: error instanceof ProviderError ? error.code.split('_')[0] : undefined,
      provider_status: providerInfo.status,
      provider_error_type: providerInfo.type,
      provider_error_code: providerInfo.code,
      latency_ms: { ...latency, total: Math.round(performance.now() - started) },
    });
    throw httpError;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return errorResponse(new HttpError(405, 'VALIDATION_FAILED', 'Use POST.', false));
  try {
    return await handle(req);
  } catch (error) {
    if (error instanceof HttpError) return errorResponse(error);
    log({ event: 'unhandled_error', status: 'failed', error_code: error instanceof Error ? error.name : 'unknown' });
    return errorResponse(new HttpError(500, 'PROVIDER_UNAVAILABLE', 'Something went wrong. Please try again.', true));
  }
});
