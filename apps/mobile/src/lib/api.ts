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

export const contractErrorCodes = ['PROVIDER_UNAVAILABLE', 'VALIDATION_FAILED', 'NOT_ALLOWED', 'INCIDENT_NOT_DRAFT'] as const;

export const apiErrorSchema = z.object({
  code: z.enum(contractErrorCodes),
  message: z.string(),
  retryable: z.boolean(),
});

/** Contract codes plus client-side ones: no network, or a response that did not match the contract. */
export type ApiErrorCode = (typeof contractErrorCodes)[number] | 'NETWORK' | 'BAD_RESPONSE';
export type ApiResult<T> = { ok: true; data: T } | { ok: false; code: ApiErrorCode; retryable: boolean; message: string };

export type ProcessTurnInput = {
  incident_revision_id: string;
  /** Generate once per spoken/typed answer and reuse it on retry (server is idempotent on it). */
  client_turn_id: string;
  question_key: string;
} & ({ audio_evidence_id: string; text?: never } | { text: string; audio_evidence_id?: never });

const NETWORK_ERROR = { ok: false, code: 'NETWORK', retryable: true, message: 'No connection. Check your signal and try again.' } as const;
const BAD_RESPONSE = { ok: false, code: 'BAD_RESPONSE', retryable: true, message: 'Unexpected reply from the server. Try again.' } as const;

async function errorFromInvoke(error: unknown): Promise<Extract<ApiResult<never>, { ok: false }>> {
  if (error instanceof FunctionsHttpError) {
    const response = error.context as Response;
    const body: unknown = await response.json().catch(() => null);
    const parsed = apiErrorSchema.safeParse(body);
    if (parsed.success) return { ok: false, ...parsed.data };
    // Gateway errors (e.g. expired JWT → 401) are not in the contract shape.
    if (response.status === 401) return { ok: false, code: 'NOT_ALLOWED', retryable: false, message: 'Sign in again to continue.' };
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