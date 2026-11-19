import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.49.4';
import { corsHeaders } from '../_shared/cors.ts';
import { incidentTurnSchema } from '../_shared/schema.ts';
import { getCatalog, type CatalogEntry } from './catalog.ts';
import { getProviders, ProviderError, type ProviderMode, type Providers } from './providers.ts';
import { validateProposals, type Proposal, type ValidationResult } from './validate.ts';

const FN = 'process-incident-turn';
const FORM_KEY = 'interview';
const BUCKET = 'incident-evidence';
const PROTECTED_SOURCES = new Set(['tap', 'typed', 'edited']);
const STALE_PROCESSING_MS = 60_000;

type ErrorCode = 'PROVIDER_UNAVAILABLE' | 'VALIDATION_FAILED' | 'NOT_ALLOWED' | 'INCIDENT_NOT_DRAFT';

type TurnResponse = {
  turn_id: string;
  status: 'completed';
  transcript: string;
  applied: Proposal[];
  suggested: Proposal[];
  latency_ms: { stt: number; llm: number };
  mode: ProviderMode;
  /** keys extracted from this turn but not written because the driver already set them (tap/typed/edited) */
  kept_existing: string[];
};

/** Shape stored in conversation_turns.extraction_proposals. */
type StoredExtraction = {
  version: 1;
  question_key: string;
  mode: ProviderMode;
  rejected: ValidationResult['rejected'];
  /** applied proposals not written because the driver already answered via tap/typed/edited */
  kept_existing: string[];
  // TODO(B1): incident_answers has no evidence_quote column yet; evidence quotes live only here
  // (inside `response.applied` / `response.suggested`) until the DB v2 migration adds it.
  response: TurnResponse;
  /** Exact JSON text of the first response; jsonb reorders keys, so replays send this string verbatim. */
  response_body: string;
};

type TurnRow = {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  extraction_proposals: StoredExtraction | null;
  updated_at: string;
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

const errorResponse = (e: HttpError) =>
  json({ code: e.code, message: e.message, retryable: e.retryable }, e.status);

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

// ---------------------------------------------------------------------------
// Turn bookkeeping
// ---------------------------------------------------------------------------
async function findTurn(db: SupabaseClient, revisionId: string, clientTurnId: string): Promise<TurnRow | null> {
  const { data, error } = await db
    .from('conversation_turns')
    .select('id, status, extraction_proposals, updated_at')
    .eq('incident_revision_id', revisionId)
    .eq('client_turn_id', clientTurnId)
    .maybeSingle();
  if (error) throw dbFailure('turn_select');
  return data as TurnRow | null;
}

/** Creates the turn row (status processing), or returns the existing row for this client_turn_id. */
async function claimTurn(
  db: SupabaseClient,
  revisionId: string,
  clientTurnId: string,
  inputKind: 'audio' | 'text',
): Promise<{ turn: TurnRow; created: boolean }> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const existing = await findTurn(db, revisionId, clientTurnId);
    if (existing) return { turn: existing, created: false };

    const { data: last, error: seqError } = await db
      .from('conversation_turns')
      .select('sequence')
      .eq('incident_revision_id', revisionId)
      .order('sequence', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (seqError) throw dbFailure('turn_sequence');

    const { data, error } = await db
      .from('conversation_turns')
      .insert({
        incident_revision_id: revisionId,
        client_turn_id: clientTurnId,
        sequence: ((last as { sequence: number } | null)?.sequence ?? 0) + 1,
        speaker: 'driver',
        input_kind: inputKind,
        status: 'processing',
      })
      .select('id, status, extraction_proposals, updated_at')
      .single();
    if (!error) return { turn: data as TurnRow, created: true };
    if (error.code !== '23505') throw dbFailure('turn_insert');
    // Unique violation: either a concurrent request with the same client_turn_id or a sequence race. Loop.
  }
  throw dbFailure('turn_claim');
}

async function updateTurn(db: SupabaseClient, turnId: string, patch: Record<string, unknown>) {
  const { error } = await db.from('conversation_turns').update(patch).eq('id', turnId);
  if (error) throw dbFailure('turn_update');
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
async function loadAudio(db: SupabaseClient, revisionId: string, evidenceId: string): Promise<Blob> {
  const { data, error } = await db
    .from('evidence')
    .select('object_path, media_type, upload_status')
    .eq('id', evidenceId)
    .eq('incident_revision_id', revisionId)
    .maybeSingle();
  if (error) throw dbFailure('evidence_select');
  const evidence = data as { object_path: string; media_type: string; upload_status: string } | null;
  if (!evidence) throw new HttpError(403, 'NOT_ALLOWED', 'That recording was not found for this report.', false);
  if (evidence.media_type !== 'audio' || evidence.upload_status !== 'uploaded') {
    throw new HttpError(400, 'VALIDATION_FAILED', 'The recording is not an uploaded audio clip.', false);
  }

  const { data: blob, error: downloadError } = await db.storage.from(BUCKET).download(evidence.object_path);
  if (downloadError || !blob) {
    throw new HttpError(503, 'PROVIDER_UNAVAILABLE', 'Could not load the recording. Please try again.', true, 'storage_download');
  }
  return blob;
}

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------
/** Writes applied proposals as confirmed voice answers. Returns keys skipped because the driver set them. */
async function writeAnswers(
  db: SupabaseClient,
  revisionId: string,
  userId: string,
  turnId: string,
  applied: Proposal[],
): Promise<string[]> {
  if (applied.length === 0) return [];

  // Select-then-write: the current unique key includes the nullable group_instance_id, so PostgREST
  // on_conflict upserts cannot target it. TODO(B1): switch to upsert once it is UNIQUE NULLS NOT DISTINCT.
  const { data, error } = await db
    .from('incident_answers')
    .select('id, field_key, source')
    .eq('incident_revision_id', revisionId)
    .eq('form_key', FORM_KEY)
    .is('group_instance_id', null)
    .in('field_key', applied.map((p) => p.key));
  if (error) throw dbFailure('answers_select');
  const existing = new Map(
    ((data ?? []) as { id: string; field_key: string; source: string }[]).map((row) => [row.field_key, row]),
  );

  const keptExisting: string[] = [];
  const inserts: Record<string, unknown>[] = [];
  for (const p of applied) {
    const row = {
      value: p.value,
      answer_state: 'confirmed',
      source: 'voice',
      confidence: p.confidence,
      transcript_turn_id: turnId,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    };
    const current = existing.get(p.key);
    if (current && PROTECTED_SOURCES.has(current.source)) {
      keptExisting.push(p.key);
    } else if (current) {
      const { error: updateError } = await db.from('incident_answers').update(row).eq('id', current.id);
      if (updateError) throw dbFailure('answers_update');
    } else {
      inserts.push({ ...row, incident_revision_id: revisionId, form_key: FORM_KEY, field_key: p.key });
    }
  }
  if (inserts.length > 0) {
    const { error: insertError } = await db.from('incident_answers').insert(inserts);
    if (insertError) throw dbFailure('answers_insert');
  }
  return keptExisting;
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
    throw new HttpError(400, 'VALIDATION_FAILED', parsed.error.issues
      .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
      .join('; '), false);
  }
  const input = parsed.data;

  const catalog: CatalogEntry[] = getCatalog();
  const question = catalog.find((q) => q.key === input.question_key);
  if (!question) throw new HttpError(400, 'VALIDATION_FAILED', 'Unknown question_key.', false);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? '';
  const db = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await db.auth.getUser(jwt);
  if (userError || !userData.user) throw new HttpError(401, 'NOT_ALLOWED', 'Sign in again to continue.', false);
  const userId = userData.user.id;

  // RLS only returns revisions of incidents the caller reported, so "not found" = not allowed.
  const { data: revision, error: revisionError } = await db
    .from('incident_revisions')
    .select('id, status, language')
    .eq('id', input.incident_revision_id)
    .maybeSingle();
  if (revisionError) throw dbFailure('revision_select');
  if (!revision) throw new HttpError(403, 'NOT_ALLOWED', 'This report was not found.', false);

  // Idempotency: a completed turn returns its stored response, even if the revision has since been submitted.
  const prior = await findTurn(db, input.incident_revision_id, input.client_turn_id);
  if (prior?.status === 'completed' && prior.extraction_proposals?.response) {
    log({ event: 'turn_replayed', revision_id: input.incident_revision_id, turn_id: prior.id, status: 'completed' });
    return replay(prior.extraction_proposals);
  }

  if ((revision as { status: string }).status !== 'draft') {
    throw new HttpError(409, 'INCIDENT_NOT_DRAFT', 'This report was already submitted.', false);
  }

  let providers: Providers;
  try {
    providers = getProviders();
  } catch (error) {
    const code = error instanceof ProviderError ? error.code : 'config_missing';
    throw new HttpError(503, 'PROVIDER_UNAVAILABLE', 'Voice processing is not available right now. Please type your answer.', false, code);
  }

  const inputKind = input.audio_evidence_id ? 'audio' : 'text';
  const { turn, created } = await claimTurn(db, input.incident_revision_id, input.client_turn_id, inputKind);
  if (!created) {
    if (turn.status === 'completed' && turn.extraction_proposals?.response) {
      return replay(turn.extraction_proposals);
    }
    const fresh = Date.now() - new Date(turn.updated_at).getTime() < STALE_PROCESSING_MS;
    if (turn.status === 'processing' && fresh) {
      throw new HttpError(409, 'PROVIDER_UNAVAILABLE', 'This answer is still being processed.', true, 'turn_in_progress');
    }
    // failed / pending / stale processing: take it over and retry.
    await updateTurn(db, turn.id, { status: 'processing', error_code: null, input_kind: inputKind });
  }

  const started = performance.now();
  const latency = { stt: 0, llm: 0 };
  try {
    let transcript: string;
    if (input.audio_evidence_id) {
      const audio = await loadAudio(db, input.incident_revision_id, input.audio_evidence_id);
      const lang = (revision as { language?: string }).language || 'en';
      const stt = await timed(() => providers.stt.transcribe(audio, lang));
      transcript = stt.value;
      latency.stt = stt.ms;
    } else {
      transcript = (input.text ?? '').trim();
    }

    let result: ValidationResult = { applied: [], suggested: [], rejected: [] };
    if (transcript) {
      const llm = await timed(() =>
        providers.extract.extract({ transcript, questionKey: question.key, catalog }),
      );
      latency.llm = llm.ms;
      result = validateProposals(llm.value, transcript, catalog);

      // The current open question always keeps the driver's own words if extraction did not fill it.
      // A narrative question (the driver's whole story) always stores the full transcript: models tend to
      // shorten it, which silently drops facts from the story.
      const ownWords = { key: question.key, value: transcript, confidence: 1, evidence_quote: transcript };
      if (question.narrative) {
        result.applied = [...result.applied.filter((p) => p.key !== question.key), ownWords];
        result.suggested = result.suggested.filter((p) => p.key !== question.key);
      } else if (question.ui === 'voice_open' && !result.applied.some((p) => p.key === question.key)) {
        result.applied.push(ownWords);
        result.suggested = result.suggested.filter((p) => p.key !== question.key);
      }
    }

    const keptExisting = await writeAnswers(db, input.incident_revision_id, userId, turn.id, result.applied);

    const response: TurnResponse = {
      turn_id: turn.id,
      status: 'completed',
      transcript,
      applied: result.applied.filter((p) => !keptExisting.includes(p.key)),
      suggested: result.suggested,
      latency_ms: latency,
      mode: providers.mode,
      kept_existing: keptExisting,
    };
    const stored: StoredExtraction = {
      version: 1,
      question_key: question.key,
      mode: providers.mode,
      rejected: result.rejected,
      kept_existing: keptExisting,
      response,
      response_body: JSON.stringify(response),
    };
    await updateTurn(db, turn.id, { status: 'completed', transcript, extraction_proposals: stored, error_code: null });

    log({
      event: 'turn_completed',
      revision_id: input.incident_revision_id,
      turn_id: turn.id,
      status: 'completed',
      mode: providers.mode,
      input_kind: inputKind,
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

    await db
      .from('conversation_turns')
      .update({ status: 'failed', error_code: httpError.errorCode })
      .eq('id', turn.id)
      .then(() => undefined, () => undefined);

    log({
      event: 'turn_failed',
      revision_id: input.incident_revision_id,
      turn_id: turn.id,
      status: 'failed',
      mode: providers.mode,
      error_code: httpError.errorCode,
      latency_ms: { ...latency, total: Math.round(performance.now() - started) },
    });
    throw httpError;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return errorResponse(new HttpError(405, 'VALIDATION_FAILED', 'Use POST.', false));
  }
  try {
    return await handle(req);
  } catch (error) {
    if (error instanceof HttpError) return errorResponse(error);
    log({ event: 'unhandled_error', status: 'failed', error_code: error instanceof Error ? error.name : 'unknown' });
    return errorResponse(new HttpError(500, 'PROVIDER_UNAVAILABLE', 'Something went wrong. Please try again.', true));
  }
});
