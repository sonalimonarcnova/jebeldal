import { z } from 'zod';

import type { FormJsonValue } from './formDefinition';

export type RpcError = {
  code?: string;
  message: string;
};

export type RpcResponse = {
  data: unknown;
  error: RpcError | null;
};

export type CreateDraftArgs = {
  p_form_set_key: string;
  p_form_set_version: number;
  p_language: 'en';
};

export type SaveAnswerArgs = {
  p_incident_revision_id: string;
  p_expected_version: number;
  p_form_key: string;
  p_field_key: string;
  p_group_instance_id: string | null;
  p_value: FormJsonValue;
  p_answer_state: 'confirmed';
  p_source: 'manual';
  p_evidence_id: null;
};

export type RpcCall<Args> = (args: Args) => PromiseLike<RpcResponse>;

const revisionIdSchema = z.string().uuid();
const revisionVersionSchema = z.number().int().positive();

export async function createIncidentDraftWith(
  rpc: RpcCall<CreateDraftArgs>,
): Promise<string> {
  const { data, error } = await rpc({
    p_form_set_key: 'default',
    p_form_set_version: 1,
    p_language: 'en',
  });
  if (error) {
    throw new Error(`Could not create incident draft (${error.code ?? 'UNKNOWN'}): ${error.message}`);
  }

  const parsed = revisionIdSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error('Draft creation did not return a valid revision ID.');
  }
  return parsed.data;
}

export async function saveIncidentAnswerWith(
  rpc: RpcCall<SaveAnswerArgs>,
  args: SaveAnswerArgs,
): Promise<number> {
  const { data, error } = await rpc(args);
  if (error) {
    const knownError = [
      ['STALE_VERSION', 'This draft changed on the server. Your answer was not saved; reload the server version before saving again.'],
      ['INCIDENT_NOT_DRAFT', 'This incident is no longer a draft, so its answers cannot be changed.'],
      ['FORM_DEFINITION_MISSING', 'The pinned form definition is unavailable, so this answer was not saved.'],
      ['VALIDATION_FAILED', 'The server rejected this answer. Check its type and pinned form options, then try again.'],
      ['NOT_ALLOWED', 'You are not allowed to edit this incident.'],
      ['AUTH_REQUIRED', 'Your session has expired. Sign in again before saving this answer.'],
    ] as const;
    const mapped = knownError.find(([code]) => error.message.includes(code));
    throw new Error(mapped?.[1] ?? `Could not save incident answer (${error.code ?? 'UNKNOWN'}): ${error.message}`);
  }

  const parsed = revisionVersionSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error('Saving an incident answer did not return a valid revision version.');
  }
  return parsed.data;
}
