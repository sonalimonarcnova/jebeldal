import { z } from 'zod';

import { supabase } from '../../lib/supabase';
import { findFieldDefinition, getFieldPrompt } from './formDefinition';
import { mapIncidentCards, type IncidentCard } from './model';
import {
  createIncidentDraftWith,
  saveIncidentAnswerWith,
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

const answerSchema = z.object({
  value: z.unknown(),
  answer_state: z.enum(['confirmed', 'unknown', 'declined', 'not_applicable', 'pending_follow_up']),
});

export type IncidentDraft = {
  revisionId: string;
  incidentId: string;
  version: number;
  status: 'draft' | 'submitted';
  formKey: string;
  formVersion: number;
  fieldKey: string;
  fieldPrompt: string;
  narrative: string;
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

export async function saveIncidentTextAnswer(
  draft: IncidentDraft,
  expectedVersion: number,
  text: string,
): Promise<number> {
  return saveIncidentAnswerWith(
    async (args) => {
      const { data, error } = await supabase.rpc('save_incident_answer', args);
      return { data, error };
    },
    {
      p_incident_revision_id: draft.revisionId,
      p_expected_version: expectedVersion,
      p_form_key: draft.formKey,
      p_field_key: draft.fieldKey,
      p_group_instance_id: null,
      p_value: text,
      p_answer_state: 'confirmed',
      p_source: 'manual',
      p_evidence_id: null,
    },
  );
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

  const formResponse = await supabase
    .from('incident_revision_forms')
    .select('form_key,form_version,activation_status')
    .eq('incident_revision_id', revision.id)
    .eq('form_key', 'auto')
    .maybeSingle();

  if (formResponse.error) {
    throwQueryError('Loading pinned incident form', formResponse.error);
  }
  const parsedForm = revisionFormSchema.safeParse(formResponse.data);
  if (!parsedForm.success) {
    throw new Error('The pinned Auto form is unavailable for this incident.');
  }
  const form = parsedForm.data;

  const definitionResponse = await supabase
    .from('form_definitions')
    .select('definition')
    .eq('form_key', form.form_key)
    .eq('version', form.form_version)
    .maybeSingle();

  if (definitionResponse.error) {
    throwQueryError('Loading pinned form definition', definitionResponse.error);
  }
  if (!definitionResponse.data) {
    throw new Error('The pinned Auto form definition could not be found.');
  }

  const field = findFieldDefinition(definitionResponse.data.definition, 'what_happened');
  if (!field || !['text', 'long_text'].includes(field.type)) {
    throw new Error('The pinned Auto form does not define a supported incident narrative field.');
  }

  const answerResponse = await supabase
    .from('incident_answers')
    .select('value,answer_state')
    .eq('incident_revision_id', revision.id)
    .eq('form_key', form.form_key)
    .eq('field_key', field.key)
    .is('group_instance_id', null)
    .maybeSingle();

  if (answerResponse.error) {
    throwQueryError('Loading saved incident answer', answerResponse.error);
  }
  const parsedAnswer = answerSchema.safeParse(answerResponse.data);
  if (answerResponse.data && !parsedAnswer.success) {
    throw new Error('The saved incident answer has an invalid format.');
  }

  return {
    revisionId: revision.id,
    incidentId: revision.incident_id,
    version: revision.version,
    status: revision.status,
    formKey: form.form_key,
    formVersion: form.form_version,
    fieldKey: field.key,
    fieldPrompt: getFieldPrompt(field),
    narrative: parsedAnswer.success && typeof parsedAnswer.data.value === 'string'
      ? parsedAnswer.data.value
      : '',
  };
}
