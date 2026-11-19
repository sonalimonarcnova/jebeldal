import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js';
import { z } from 'zod';

import { saveAcceptedProposalsWith, type SaveClient, type SaveProposalsResult } from './saveProposals';
import { supabase } from './supabase';

// ---------------------------------------------------------------------------
// Contracts — docs/voice-integration.md (process-incident-turn on Eng B's backend)
// ---------------------------------------------------------------------------
export const proposalSchema = z.object({
  form_key: z.string().min(1),
  field_key: z.string().min(1),
  /** text → string, enum → string, multi_enum → string[], boolean → true/false */
  value: z.union([z.string(), z.array(z.string()), z.boolean()]),
  confidence: z.number().min(0).max(1),
  evidence_quote: z.string(),
});
export type TurnProposal = z.infer<typeof proposalSchema>;

export const processTurnResponseSchema = z.object({
  turn_id: z.string(),
  client_turn_id: z.string().optional(),
  status: z.literal('completed'),
  transcript: z.string(),
  /** confidence ≥ 0.8 and explicitly stated — safe to save after the driver confirms */
  applied: z.array(proposalSchema),
  /** lower confidence or inferred — pre-select with a "from your story" badge, never save silently */
  suggested: z.array(proposalSchema),
  latency_ms: z.object({ stt: z.number(), llm: z.number() }),
  mode: z.enum(['mock', 'groq', 'xai', 'live']),
});
export type ProcessTurnResponse = z.infer<typeof processTurnResponseSchema>;

export const generateSummaryResponseSchema = z.object({
  descriptions: z.record(z.string(), z.string().trim().min(1).max(600)),
  mode: z.enum(['mock', 'groq', 'xai', 'live']),
  latency_ms: z.number().int().nonnegative(),
});
export type GenerateSummaryResponse = z.infer<typeof generateSummaryResponseSchema>;

/** Error codes of the team's _shared/backend.ts envelope ({ code, message?, retryable? }). */
export const contractErrorCodes = [
  'AUTH_REQUIRED',
  'NOT_ALLOWED',
  'INCIDENT_NOT_DRAFT',
  'TURN_ID_REUSED',
  'VALIDATION_FAILED',
  'PROVIDER_UNAVAILABLE',
  'RETRYABLE_FAILURE',
  'INTERNAL_ERROR',
  'METHOD_NOT_ALLOWED',
] as const;
type ContractErrorCode = (typeof contractErrorCodes)[number];

const RETRYABLE_BY_DEFAULT = new Set<ContractErrorCode>(['PROVIDER_UNAVAILABLE', 'RETRYABLE_FAILURE', 'INTERNAL_ERROR']);
const DEFAULT_MESSAGES: Record<ContractErrorCode, string> = {
  AUTH_REQUIRED: 'Sign in again to continue.',
  NOT_ALLOWED: 'You cannot change this report.',
  INCIDENT_NOT_DRAFT: 'This report was already submitted.',
  TURN_ID_REUSED: 'This answer was already sent with different content.',
  VALIDATION_FAILED: 'That answer could not be accepted.',
  PROVIDER_UNAVAILABLE: 'Voice processing is unavailable. Try again or type your answer.',
  RETRYABLE_FAILURE: 'Something went wrong. Please try again.',
  INTERNAL_ERROR: 'Something went wrong. Please try again.',
  METHOD_NOT_ALLOWED: 'Unexpected request.',
};

/** `message` and `retryable` are optional: backendErrorResponse() sends only `{ code }`. */
export const apiErrorSchema = z.object({
  code: z.enum(contractErrorCodes),
  message: z.string().optional(),
  retryable: z.boolean().optional(),
});

/** Contract codes plus client-side ones: no network, or a response that did not match the contract. */
export type ApiErrorCode = ContractErrorCode | 'NETWORK' | 'BAD_RESPONSE';
export type ApiResult<T> = { ok: true; data: T } | { ok: false; code: ApiErrorCode; retryable: boolean; message: string };

export type ProcessTurnInput = {
  incident_revision_id: string;
  /** Generate once per spoken/typed answer and reuse it on retry (server is idempotent on it). */
  client_turn_id: string;
  /** Current question: "form.field" / bare field key, or the pinned (form_key, field_key) from select-next-question. */
  question_key?: string;
  form_key?: string;
  field_key?: string;
} & ({ audio_evidence_id: string; text?: never } | { text: string; audio_evidence_id?: never });

const NETWORK_ERROR = { ok: false, code: 'NETWORK', retryable: true, message: 'No connection. Check your signal and try again.' } as const;
const BAD_RESPONSE = { ok: false, code: 'BAD_RESPONSE', retryable: true, message: 'Unexpected reply from the server. Try again.' } as const;

async function errorFromInvoke(error: unknown): Promise<Extract<ApiResult<never>, { ok: false }>> {
  if (error instanceof FunctionsHttpError) {
    const response = error.context as Response;
    const body: unknown = await response.json().catch(() => null);
    const parsed = apiErrorSchema.safeParse(body);
    if (parsed.success) {
      const { code, message, retryable } = parsed.data;
      return { ok: false, code, message: message ?? DEFAULT_MESSAGES[code], retryable: retryable ?? RETRYABLE_BY_DEFAULT.has(code) };
    }
    // Gateway errors (e.g. expired JWT → 401) are not in the contract shape.
    if (response.status === 401) return { ok: false, code: 'AUTH_REQUIRED', retryable: false, message: DEFAULT_MESSAGES.AUTH_REQUIRED };
    return BAD_RESPONSE;
  }
  if (error instanceof FunctionsFetchError || error instanceof FunctionsRelayError) return NETWORK_ERROR;
  return NETWORK_ERROR;
}

export async function processTurn(input: ProcessTurnInput): Promise<ApiResult<ProcessTurnResponse>> {
  let result: Awaited<ReturnType<typeof supabase.functions.invoke>>;
  try {
    result = await supabase.functions.invoke('process-incident-turn', { body: input });
  } catch {
    return NETWORK_ERROR;
  }
  if (result.error) return errorFromInvoke(result.error);

  const parsed = processTurnResponseSchema.safeParse(result.data);
  return parsed.success ? { ok: true, data: parsed.data } : BAD_RESPONSE;
}

export async function generateSummary(revisionId: string): Promise<ApiResult<GenerateSummaryResponse>> {
  let result: Awaited<ReturnType<typeof supabase.functions.invoke>>;
  try {
    result = await supabase.functions.invoke('generate-summary', {
      body: { incident_revision_id: revisionId },
    });
  } catch {
    return NETWORK_ERROR;
  }
  if (result.error) return errorFromInvoke(result.error);

  const parsed = generateSummaryResponseSchema.safeParse(result.data);
  return parsed.success ? { ok: true, data: parsed.data } : BAD_RESPONSE;
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------
export async function createDraft(): Promise<ApiResult<{ revisionId: string }>> {
  const { data, error } = await supabase.rpc('create_incident_draft');
  if (error) {
    // PostgREST "TypeError: Network request failed" surfaces without a Postgres code.
    if (!error.code) return NETWORK_ERROR;
    return { ok: false, code: 'NOT_ALLOWED', retryable: false, message: 'Could not start a report for this account.' };
  }
  const parsed = z.string().uuid().safeParse(data);
  return parsed.success ? { ok: true, data: { revisionId: parsed.data } } : BAD_RESPONSE;
}

// ---------------------------------------------------------------------------
// Saving accepted proposals — logic in ./saveProposals.ts (client-agnostic, testable in Node)
// ---------------------------------------------------------------------------
export { mapRpcError } from './saveProposals';
export type { SaveErrorCode, SavedField, SaveProposalsResult } from './saveProposals';

/**
 * Saves the driver-accepted proposals one by one with rpc save_incident_answer (source 'driver_confirmed'),
 * reading the revision version first and threading each returned version into the next call.
 */
export function saveAcceptedProposals(revisionId: string, proposals: TurnProposal[]): Promise<SaveProposalsResult> {
  // supabase-js's builder types are richer than SaveClient; the shape used is the same.
  return saveAcceptedProposalsWith(supabase as unknown as SaveClient, revisionId, proposals);
}