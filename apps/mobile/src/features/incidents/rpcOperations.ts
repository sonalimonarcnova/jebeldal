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

export const persistedAnswerStates = [
  'confirmed',
  'unknown',
  'declined',
  'not_applicable',
  'pending_follow_up',
] as const;

export type PersistedAnswerState = (typeof persistedAnswerStates)[number];

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
  p_value: FormJsonValue | null;
  p_answer_state: PersistedAnswerState;
  p_source: 'manual';
  p_evidence_id: null;
};

export type SaveDetailsArgs = {
  p_incident_revision_id: string;
  p_expected_version: number;
  p_occurred_at: string | null;
  p_location: FormJsonValue | null;
};

export type CreateAnswerGroupArgs = {
  p_incident_revision_id: string;
  p_expected_version: number;
  p_form_key: string;
  p_group_key: string;
  p_position: number;
};

export type DeleteAnswerGroupArgs = {
  p_incident_revision_id: string;
  p_expected_version: number;
  p_group_instance_id: string;
};

export type CreateEvidenceArgs = {
  p_incident_revision_id: string;
  p_media_type: 'photo';
  p_size_bytes: number;
  p_description: string | null;
};

export type SubmitIncidentArgs = {
  p_incident_revision_id: string;
  p_expected_version: number;
  p_signature_reference: string;
  p_auth_method: 'biometric' | 'device_passcode';
  p_device_description: string;
};

export type CheckReadinessArgs = {
  p_incident_revision_id: string;
  p_expected_version: number;
};

export type SubmitIssue = {
  formKey: string | null;
  fieldKey: string | null;
  groupInstanceId: string | null;
  code: string;
  label: string | null;
  expectedType: string | null;
  required: boolean | null;
  answerState: string | null;
  expectedMediaType: string | null;
  requiredCount: number | null;
  uploadedCount: number | null;
  action: string | null;
  message: string | null;
  provenance: {
    source: string | null;
    confidence: number | null;
    evidenceId: string | null;
    transcriptTurnId: string | null;
  } | null;
};

export type SubmitResult =
  | {
    kind: 'submitted';
    revisionId: string;
    reportReference: string;
    status: 'submitted';
    version: number;
  }
  | {
    kind: 'blocked';
    revisionId: string;
    version: number;
    issues: SubmitIssue[];
  };

export type ReadinessResult =
  | {
    kind: 'ready';
    revisionId: string;
    version: number;
  }
  | {
    kind: 'blocked';
    revisionId: string;
    version: number;
    issues: SubmitIssue[];
  };

export type RpcCall<Args> = (args: Args) => PromiseLike<RpcResponse>;

const revisionIdSchema = z.string().uuid();
const revisionVersionSchema = z.number().int().positive();
const uuidSchema = z.string().uuid();

function operationError(operation: string, error: RpcError): Error {
  const mapped = [
    ['STALE_VERSION', 'This draft changed on the server. Your edits are preserved; reload before retrying.'],
    ['INCIDENT_NOT_DRAFT', 'This incident is no longer a draft and cannot be changed.'],
    ['NOT_ALLOWED', 'You are not allowed to edit this incident.'],
    ['AUTH_REQUIRED', 'Your session has expired. Sign in again before continuing.'],
    ['GROUP_REQUIRED', 'At least one entry is required in this section.'],
    ['VALIDATION_FAILED', 'The server rejected this request. Review the pinned form values and try again.'],
  ].find(([code]) => error.code === code || error.message.includes(code));
  return new Error(mapped?.[1] ?? `${operation} failed (${error.code ?? 'UNKNOWN'}): ${error.message}`);
}

function parseSubmitResult(value: unknown): SubmitResult {
  const result = z.object({
    status: z.string().optional(),
    code: z.string().optional(),
    incident_revision_id: revisionIdSchema.optional(),
    report_reference: z.string().optional(),
    version: revisionVersionSchema.optional(),
    issues: z.array(z.object({
      form_key: z.string().nullable().optional(),
      field_key: z.string().nullable().optional(),
      group_instance_id: z.string().uuid().nullable().optional(),
      code: z.string(),
      label: z.string().nullable().optional(),
      expected_type: z.string().nullable().optional(),
      required: z.boolean().nullable().optional(),
      answer_state: z.string().nullable().optional(),
      expected_media_type: z.string().nullable().optional(),
      required_count: z.number().int().nullable().optional(),
      uploaded_count: z.number().int().nullable().optional(),
      action: z.string().nullable().optional(),
      message: z.string().nullable().optional(),
      provenance: z.object({
        source: z.string().nullable().optional(),
        confidence: z.number().nullable().optional(),
        evidence_id: z.string().uuid().nullable().optional(),
        transcript_turn_id: z.string().uuid().nullable().optional(),
      }).nullable().optional(),
    })).optional(),
  }).safeParse(value);
  if (!result.success) {
    throw new Error('The submit response did not match the incident submission contract.');
  }

  if (result.data.code === 'VALIDATION_FAILED') {
    if (!result.data.incident_revision_id || !result.data.version) {
      throw new Error('The blocked submit response is missing its incident revision or version.');
    }
    return {
      kind: 'blocked',
      revisionId: result.data.incident_revision_id,
      version: result.data.version,
      issues: (result.data.issues ?? []).map((issue) => ({
        formKey: issue.form_key ?? null,
        fieldKey: issue.field_key ?? null,
        groupInstanceId: issue.group_instance_id ?? null,
        code: issue.code,
        label: issue.label ?? null,
        expectedType: issue.expected_type ?? null,
        required: issue.required ?? null,
        answerState: issue.answer_state ?? null,
        expectedMediaType: issue.expected_media_type ?? null,
        requiredCount: issue.required_count ?? null,
        uploadedCount: issue.uploaded_count ?? null,
        action: issue.action ?? null,
        message: issue.message ?? null,
        provenance: issue.provenance
          ? {
            source: issue.provenance.source ?? null,
            confidence: issue.provenance.confidence ?? null,
            evidenceId: issue.provenance.evidence_id ?? null,
            transcriptTurnId: issue.provenance.transcript_turn_id ?? null,
          }
          : null,
      })),
    };
  }
  if (
    result.data.status !== 'submitted'
    || !result.data.incident_revision_id
    || !result.data.report_reference
    || !result.data.version
  ) {
    throw new Error('The submit response did not confirm a submitted report.');
  }
  return {
    kind: 'submitted',
    revisionId: result.data.incident_revision_id,
    reportReference: result.data.report_reference,
    status: 'submitted',
    version: result.data.version,
  };
}

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
  if (args.p_answer_state !== 'confirmed' && args.p_value !== null) {
    throw new Error('A non-confirmed answer state cannot include an answer value.');
  }
  const { data, error } = await rpc(args);
  if (error) {
    const message = error.message.includes('FORM_DEFINITION_MISSING')
      ? 'The pinned form definition is unavailable, so this answer was not saved.'
      : operationError('Could not save incident answer', error).message;
    throw new Error(message);
  }

  const parsed = revisionVersionSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error('Saving an incident answer did not return a valid revision version.');
  }
  return parsed.data;
}

export async function saveIncidentDetailsWith(
  rpc: RpcCall<SaveDetailsArgs>,
  args: SaveDetailsArgs,
): Promise<number> {
  const { data, error } = await rpc(args);
  if (error) throw operationError('Could not save incident details', error);
  const parsed = revisionVersionSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error('Saving incident details did not return a valid revision version.');
  }
  return parsed.data;
}

export async function createIncidentAnswerGroupWith(
  rpc: RpcCall<CreateAnswerGroupArgs>,
  args: CreateAnswerGroupArgs,
): Promise<string> {
  const { data, error } = await rpc(args);
  if (error) throw operationError('Could not create a repeated answer group', error);
  const parsed = uuidSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error('Creating a repeated answer group did not return a valid group ID.');
  }
  return parsed.data;
}

export async function deleteIncidentAnswerGroupWith(
  rpc: RpcCall<DeleteAnswerGroupArgs>,
  args: DeleteAnswerGroupArgs,
): Promise<number> {
  const { data, error } = await rpc(args);
  if (error) throw operationError('Could not remove a repeated answer group', error);
  const parsed = revisionVersionSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error('Removing a repeated answer group did not return a valid revision version.');
  }
  return parsed.data;
}

export async function createIncidentEvidenceWith(
  rpc: RpcCall<{ p_incident_revision_id: string; p_media_type: 'photo'; p_size_bytes: number; p_description: string | null }>,
  args: CreateEvidenceArgs,
): Promise<{ evidenceId: string; objectPath: string; revisionVersion: number }> {
  const { data, error } = await rpc(args);
  if (error) throw operationError('Could not prepare incident photo upload', error);
  const parsed = z.object({
    evidence_id: uuidSchema,
    object_path: z.string().min(1),
    upload_status: z.enum(['pending', 'failed', 'uploaded']),
    revision_version: revisionVersionSchema,
  }).safeParse(data);
  if (!parsed.success) {
    throw new Error('Preparing a photo upload did not return a valid evidence record.');
  }
  return {
    evidenceId: parsed.data.evidence_id,
    objectPath: parsed.data.object_path,
    revisionVersion: parsed.data.revision_version,
  };
}

export async function finalizeIncidentEvidenceWith(
  rpc: RpcCall<{ p_evidence_id: string }>,
  evidenceId: string,
): Promise<{ uploadStatus: 'uploaded' | 'failed'; revisionVersion: number }> {
  const { data, error } = await rpc({ p_evidence_id: evidenceId });
  if (error) throw operationError('Could not finish incident photo upload', error);
  const parsed = z.object({
    upload_status: z.enum(['uploaded', 'failed']),
    revision_version: revisionVersionSchema,
  }).safeParse(data);
  if (!parsed.success) {
    throw new Error('Finishing a photo upload did not return a valid evidence status.');
  }
  return {
    uploadStatus: parsed.data.upload_status,
    revisionVersion: parsed.data.revision_version,
  };
}

export async function submitIncidentWith(
  rpc: RpcCall<SubmitIncidentArgs>,
  args: SubmitIncidentArgs,
): Promise<SubmitResult> {
  const { data, error } = await rpc(args);
  if (error) {
    if (error.message.includes('STALE_VERSION')) {
      throw new Error('This draft changed on the server. Reload the server version, preserve your edits, then confirm again.');
    }
    if (error.message.includes('SIGNATURE_REFERENCE_REUSED')) {
      throw new Error('The saved submission confirmation no longer matches this retry. Reload the report before continuing.');
    }
    throw operationError('Could not submit incident', error);
  }
  return parseSubmitResult(data);
}

export async function checkIncidentSubmissionReadinessWith(
  rpc: RpcCall<CheckReadinessArgs>,
  args: CheckReadinessArgs,
): Promise<ReadinessResult> {
  const { data, error } = await rpc(args);
  if (error) throw operationError('Could not check incident readiness', error);

  const ready = z.object({
    status: z.literal('ready'),
    incident_revision_id: revisionIdSchema,
    version: revisionVersionSchema,
  }).safeParse(data);
  if (ready.success) {
    return {
      kind: 'ready',
      revisionId: ready.data.incident_revision_id,
      version: ready.data.version,
    };
  }

  const blocked = parseSubmitResult(data);
  if (
    blocked.kind !== 'blocked'
    || !uuidSchema.safeParse(blocked.revisionId).success
  ) {
    throw new Error('The readiness response did not match the incident readiness contract.');
  }
  return {
    kind: 'blocked',
    revisionId: blocked.revisionId,
    version: blocked.version,
    issues: blocked.issues,
  };
}
