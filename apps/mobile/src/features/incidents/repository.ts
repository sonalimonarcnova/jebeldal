import { z } from 'zod';
import { FunctionsHttpError } from '@supabase/supabase-js';

import { supabase } from '../../lib/supabase';
import {
  findFieldDefinition,
  getFieldPrompt,
  parseFormDefinition,
  type FormJsonValue,
  type ParsedFormDefinition,
} from './formDefinition';
import { mapIncidentCards, type IncidentCard } from './model';
import {
  createIncidentAnswerGroupWith,
  createIncidentDraftWith,
  createIncidentEvidenceWith,
  checkIncidentSubmissionReadinessWith,
  deleteIncidentAnswerGroupWith,
  finalizeIncidentEvidenceWith,
  persistedAnswerStates,
  saveIncidentDetailsWith,
  saveIncidentAnswerWith,
  submitIncidentWith,
  type CreateAnswerGroupArgs,
  type CreateEvidenceArgs,
  type CheckReadinessArgs,
  type DeleteAnswerGroupArgs,
  type PersistedAnswerState,
  type SaveDetailsArgs,
  type SubmitIncidentArgs,
  type SubmitResult,
} from './rpcOperations';

const incidentRowsSchema = z.array(
  z.object({
    id: z.string().uuid(),
    active_revision_id: z.string().uuid().nullable(),
  }),
);

const revisionSchema = z.object({
  id: z.string().uuid(),
  incident_id: z.string().uuid(),
  version: z.number().int().positive(),
  status: z.enum(['draft', 'submitted']),
  form_set_key: z.string(),
  form_set_version: z.number().int().positive(),
  occurred_at: z.string().nullable(),
  location: z.unknown().nullable(),
  report_reference: z.string().nullable(),
});

const revisionFormSchema = z.object({
  form_key: z.string(),
  form_version: z.number().int().positive(),
  activation_status: z.enum(['triggered', 'not_triggered']),
});

const answerGroupSchema = z.object({
  id: z.string().uuid(),
  form_key: z.string(),
  group_key: z.string(),
  position: z.number().int().nonnegative(),
});

const answerSchema = z.object({
  form_key: z.string(),
  field_key: z.string(),
  group_instance_id: z.string().uuid().nullable(),
  value: z.unknown(),
  answer_state: z.enum(persistedAnswerStates),
  source: z.string(),
  evidence_id: z.string().uuid().nullable(),
  updated_at: z.string(),
});

const incidentEvidenceSchema = z.object({
  id: z.string().uuid(),
  media_type: z.enum(['audio', 'photo', 'video']),
  object_path: z.string(),
  size_bytes: z.number().int().positive(),
  upload_status: z.enum(['pending', 'uploaded', 'failed']),
  description: z.string().nullable(),
  capture_time: z.string().nullable(),
});

export type IncidentForm = {
  formKey: string;
  version: number;
  activationStatus: 'triggered' | 'not_triggered';
  definition: ParsedFormDefinition | null;
  definitionError: string | null;
};

export type IncidentAnswer = {
  formKey: string;
  fieldKey: string;
  groupInstanceId: string | null;
  value: unknown;
  answerState: PersistedAnswerState;
  source: string;
  evidenceId: string | null;
  updatedAt: string;
};

export type IncidentAnswerGroup = {
  id: string;
  formKey: string;
  groupKey: string;
  position: number;
};

export type IncidentEvidence = {
  id: string;
  mediaType: 'audio' | 'photo' | 'video';
  objectPath: string;
  sizeBytes: number;
  uploadStatus: 'pending' | 'uploaded' | 'failed';
  description: string | null;
  capturedAt: string | null;
  signedUrl: string | null;
  previewError: string | null;
};

export type IncidentDraft = {
  revisionId: string;
  incidentId: string;
  version: number;
  status: 'draft' | 'submitted';
  occurredAt: string | null;
  location: unknown | null;
  reportReference: string | null;
  narrativeFormKey: string | null;
  fieldKey: string | null;
  fieldPrompt: string | null;
  narrative: string;
  forms: IncidentForm[];
  answers: IncidentAnswer[];
  groups: IncidentAnswerGroup[];
  evidence: IncidentEvidence[];
};

function throwQueryError(operation: string, error: { code?: string; message: string }): never {
  throw new Error(`${operation} failed (${error.code ?? 'UNKNOWN'}): ${error.message}`);
}

export async function createIncidentDraft(): Promise<string> {
  return createIncidentDraftWith(async (args) => {
    const { data, error } = await supabase.rpc('create_incident_draft', args);
    return { data, error };
  });
}

export async function saveIncidentFieldAnswer(
  draft: IncidentDraft,
  formKey: string,
  fieldKey: string,
  value: FormJsonValue | null,
  expectedVersion: number,
  answerState: PersistedAnswerState = 'confirmed',
  groupInstanceId: string | null = null,
): Promise<number> {
  return saveIncidentAnswerWith(
    async (args) => {
      const { data, error } = await supabase.rpc('save_incident_answer', args);
      return { data, error };
    },
    {
      p_incident_revision_id: draft.revisionId,
      p_expected_version: expectedVersion,
      p_form_key: formKey,
      p_field_key: fieldKey,
      p_group_instance_id: groupInstanceId,
      p_value: value,
      p_answer_state: answerState,
      p_source: 'manual',
      p_evidence_id: null,
    },
  );
}

export async function saveIncidentDetails(
  draft: IncidentDraft,
  occurredAt: string | null,
  location: FormJsonValue | null,
): Promise<number> {
  const args: SaveDetailsArgs = {
    p_incident_revision_id: draft.revisionId,
    p_expected_version: draft.version,
    p_occurred_at: occurredAt,
    p_location: location,
  };
  return saveIncidentDetailsWith(async (received) => {
    const { data, error } = await supabase.rpc('save_incident_details', received);
    return { data, error };
  }, args);
}

export async function createIncidentAnswerGroup(
  draft: IncidentDraft,
  formKey: string,
  groupKey: string,
  position: number,
): Promise<string> {
  const args: CreateAnswerGroupArgs = {
    p_incident_revision_id: draft.revisionId,
    p_expected_version: draft.version,
    p_form_key: formKey,
    p_group_key: groupKey,
    p_position: position,
  };
  return createIncidentAnswerGroupWith(async (received) => {
    const { data, error } = await supabase.rpc('create_incident_answer_group', received);
    return { data, error };
  }, args);
}

export async function deleteIncidentAnswerGroup(
  draft: IncidentDraft,
  groupInstanceId: string,
): Promise<number> {
  const args: DeleteAnswerGroupArgs = {
    p_incident_revision_id: draft.revisionId,
    p_expected_version: draft.version,
    p_group_instance_id: groupInstanceId,
  };
  return deleteIncidentAnswerGroupWith(async (received) => {
    const { data, error } = await supabase.rpc('delete_incident_answer_group', received);
    return { data, error };
  }, args);
}

export async function createIncidentEvidence(
  draft: IncidentDraft,
  sizeBytes: number,
  description: string | null,
) {
  const args: CreateEvidenceArgs = {
    p_incident_revision_id: draft.revisionId,
    p_media_type: 'photo',
    p_size_bytes: sizeBytes,
    p_description: description,
  };
  return createIncidentEvidenceWith(async (received) => {
    const { data, error } = await supabase.rpc('create_incident_evidence', received);
    return { data, error };
  }, args);
}

export async function uploadIncidentEvidenceFile(
  objectPath: string,
  blob: Blob,
  contentType: string,
): Promise<void> {
  const { error } = await supabase.storage
    .from('incident-evidence')
    .upload(objectPath, blob, { contentType, upsert: true });
  if (error) {
    throw new Error(`Photo upload failed: ${error.message}`);
  }
}

export async function finalizeIncidentEvidence(evidenceId: string) {
  return finalizeIncidentEvidenceWith(async (received) => {
    const { data, error } = await supabase.rpc('finalize_incident_evidence', received);
    return { data, error };
  }, evidenceId);
}

export async function submitIncident(args: SubmitIncidentArgs): Promise<SubmitResult> {
  return submitIncidentWith(async (received) => {
    const { data, error } = await supabase.functions.invoke('submit-incident', {
      body: {
        incident_revision_id: received.p_incident_revision_id,
        expected_version: received.p_expected_version,
        signature_reference: received.p_signature_reference,
        auth_method: received.p_auth_method,
        device_description: received.p_device_description,
      },
    });
    if (!error) return { data, error: null };
    if (error instanceof FunctionsHttpError) {
      let payload: unknown;
      try {
        payload = await error.context.json();
      } catch {
        throw new Error('The submit function returned an unreadable error response.');
      }
      const parsed = z.object({
        code: z.string(),
      }).passthrough().safeParse(payload);
      if (!parsed.success) {
        throw new Error('The submit function returned an invalid error response.');
      }
      if (parsed.data.code === 'VALIDATION_FAILED') {
        return { data: payload, error: null };
      }
      return {
        data: null,
        error: { code: parsed.data.code, message: parsed.data.code },
      };
    }
    return {
      data: null,
      error: { code: 'FUNCTION_INVOCATION_FAILED', message: error.message },
    };
  }, args);
}

export async function checkIncidentSubmissionReadiness(
  draft: IncidentDraft,
) {
  const args: CheckReadinessArgs = {
    p_incident_revision_id: draft.revisionId,
    p_expected_version: draft.version,
  };
  return checkIncidentSubmissionReadinessWith(async (received) => {
    const { data, error } = await supabase.rpc('check_incident_submission_readiness', received);
    return { data, error };
  }, args);
}

export async function loadIncidentCards(): Promise<IncidentCard[]> {
  const { data: rawIncidents, error: incidentsError } = await supabase
    .from('incidents')
    .select('id,status,active_revision_id,created_at,updated_at')
    .order('updated_at', { ascending: false })
    .limit(100);

  if (incidentsError) {
    throwQueryError('Loading incidents', incidentsError);
  }

  const parsedIncidents = incidentRowsSchema.safeParse(rawIncidents);
  if (!parsedIncidents.success) {
    throw new Error('The incidents response does not match the expected schema.');
  }

  const revisionIds = [
    ...new Set(
      parsedIncidents.data
        .map((incident) => incident.active_revision_id)
        .filter((id): id is string => id !== null),
    ),
  ];
  if (revisionIds.length === 0) {
    return mapIncidentCards(rawIncidents, [], [], []);
  }

  const [revisionsResponse, answersResponse, formsResponse] = await Promise.all([
    supabase
      .from('incident_revisions')
      .select(
        'id,incident_id,version,status,form_set_key,form_set_version,occurred_at,location,report_reference',
      )
      .in('id', revisionIds),
    supabase
      .from('incident_answers')
      .select('incident_revision_id,field_key,value,answer_state')
      .in('incident_revision_id', revisionIds)
      .eq('form_key', 'auto')
      .eq('field_key', 'what_happened')
      .is('group_instance_id', null),
    supabase
      .from('incident_revision_forms')
      .select('incident_revision_id,form_key,activation_status')
      .in('incident_revision_id', revisionIds),
  ]);

  if (revisionsResponse.error) {
    throwQueryError('Loading incident revisions', revisionsResponse.error);
  }
  if (answersResponse.error) {
    throwQueryError('Loading incident summaries', answersResponse.error);
  }
  if (formsResponse.error) {
    throwQueryError('Loading incident form status', formsResponse.error);
  }

  return mapIncidentCards(
    rawIncidents,
    revisionsResponse.data,
    answersResponse.data,
    formsResponse.data,
  );
}

export async function loadIncidentDraft(revisionId: string): Promise<IncidentDraft> {
  const revisionResponse = await supabase
    .from('incident_revisions')
    .select(
      'id,incident_id,version,status,form_set_key,form_set_version,occurred_at,location,report_reference',
    )
    .eq('id', revisionId)
    .maybeSingle();

  if (revisionResponse.error) {
    throwQueryError('Loading incident draft', revisionResponse.error);
  }
  const parsedRevision = revisionSchema.safeParse(revisionResponse.data);
  if (!parsedRevision.success) {
    throw new Error('This incident draft is unavailable to the signed-in driver.');
  }
  const revision = parsedRevision.data;

  const formsResponse = await supabase
    .from('incident_revision_forms')
    .select('form_key,form_version,activation_status')
    .eq('incident_revision_id', revision.id)
    .order('form_key');

  if (formsResponse.error) {
    throwQueryError('Loading pinned incident forms', formsResponse.error);
  }
  const parsedForms = z.array(revisionFormSchema).safeParse(formsResponse.data);
  if (!parsedForms.success) {
    throw new Error('The pinned incident form list does not match the expected schema.');
  }

  const [forms, answers, groups, evidence] = await Promise.all([
    Promise.all(parsedForms.data.map(async (form): Promise<IncidentForm> => {
      const definitionResponse = await supabase
        .from('form_definitions')
        .select('definition')
        .eq('form_key', form.form_key)
        .eq('version', form.form_version)
        .maybeSingle();

      if (definitionResponse.error) {
        throwQueryError(`Loading pinned ${form.form_key} form definition`, definitionResponse.error);
      }
      if (!definitionResponse.data) {
        return {
          formKey: form.form_key,
          version: form.form_version,
          activationStatus: form.activation_status,
          definition: null,
          definitionError: 'The pinned form definition could not be found.',
        };
      }

      return {
        formKey: form.form_key,
        version: form.form_version,
        activationStatus: form.activation_status,
        definition: parseFormDefinition(definitionResponse.data.definition),
        definitionError: null,
      };
    })),
    (async (): Promise<IncidentAnswer[]> => {
      const answersResponse = await supabase
        .from('incident_answers')
        .select('form_key,field_key,group_instance_id,value,answer_state,source,evidence_id,updated_at')
        .eq('incident_revision_id', revision.id);

      if (answersResponse.error) {
        throwQueryError('Loading saved incident answers', answersResponse.error);
      }
      const parsedAnswers = z.array(answerSchema).safeParse(answersResponse.data);
      if (!parsedAnswers.success) {
        throw new Error('The saved incident answers do not match the expected schema.');
      }
      return parsedAnswers.data.map((answer) => ({
        formKey: answer.form_key,
        fieldKey: answer.field_key,
        groupInstanceId: answer.group_instance_id,
        value: answer.value,
        answerState: answer.answer_state,
        source: answer.source,
        evidenceId: answer.evidence_id,
        updatedAt: answer.updated_at,
      })).sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
    })(),
    (async (): Promise<IncidentAnswerGroup[]> => {
      const groupsResponse = await supabase
        .from('incident_answer_groups')
        .select('id,form_key,group_key,position')
        .eq('incident_revision_id', revision.id)
        .order('form_key')
        .order('group_key')
        .order('position');
      if (groupsResponse.error) {
        throwQueryError('Loading repeated answer groups', groupsResponse.error);
      }
      const parsedGroups = z.array(answerGroupSchema).safeParse(groupsResponse.data);
      if (!parsedGroups.success) {
        throw new Error('The saved repeated answer groups do not match the expected schema.');
      }
      return parsedGroups.data.map((group) => ({
        id: group.id,
        formKey: group.form_key,
        groupKey: group.group_key,
        position: group.position,
      }));
    })(),
    (async (): Promise<IncidentEvidence[]> => {
      const evidenceResponse = await supabase
        .from('evidence')
        .select('id,media_type,object_path,size_bytes,upload_status,description,capture_time')
        .eq('incident_revision_id', revision.id)
        .order('created_at');
      if (evidenceResponse.error) {
        throwQueryError('Loading incident evidence', evidenceResponse.error);
      }
      const parsedEvidence = z.array(incidentEvidenceSchema).safeParse(evidenceResponse.data);
      if (!parsedEvidence.success) {
        throw new Error('The incident evidence list does not match the expected schema.');
      }
      return Promise.all(parsedEvidence.data.map(async (item) => {
        let signedUrl: string | null = null;
        let previewError: string | null = null;
        if (item.upload_status === 'uploaded') {
          const signedResponse = await supabase.storage
            .from('incident-evidence')
            .createSignedUrl(item.object_path, 3600);
          if (signedResponse.error) {
            previewError = `Could not load private photo preview (${signedResponse.error.statusCode ?? 'UNKNOWN'}): ${signedResponse.error.message}`;
          } else {
            signedUrl = signedResponse.data.signedUrl;
          }
        }
        return {
          id: item.id,
          mediaType: item.media_type,
          objectPath: item.object_path,
          sizeBytes: item.size_bytes,
          uploadStatus: item.upload_status,
          description: item.description,
          capturedAt: item.capture_time,
          signedUrl,
          previewError,
        };
      }));
    })(),
  ]);

  const autoForm = forms.find((form) => form.formKey === 'auto');
  const narrativeField = autoForm?.definition?.fields.find((field) => field.key === 'what_happened');
  const narrativeAnswer = answers.find(
    (answer) => answer.formKey === 'auto'
      && answer.fieldKey === 'what_happened'
      && answer.answerState === 'confirmed'
      && typeof answer.value === 'string',
  );

  return {
    revisionId: revision.id,
    incidentId: revision.incident_id,
    version: revision.version,
    status: revision.status,
    occurredAt: revision.occurred_at,
    location: revision.location,
    reportReference: revision.report_reference,
    narrativeFormKey: narrativeField ? 'auto' : null,
    fieldKey: narrativeField?.key ?? null,
    fieldPrompt: narrativeField ? getFieldPrompt(narrativeField) : null,
    narrative: typeof narrativeAnswer?.value === 'string' ? narrativeAnswer.value : '',
    forms,
    answers,
    groups,
    evidence,
  };
}
