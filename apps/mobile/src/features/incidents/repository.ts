import { z } from 'zod';

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
  form_key: z.string(),
  field_key: z.string(),
  value: z.unknown(),
  answer_state: z.enum(['confirmed', 'unknown', 'declined', 'not_applicable', 'pending_follow_up']),
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
  value: unknown;
  answerState: 'confirmed' | 'unknown' | 'declined' | 'not_applicable' | 'pending_follow_up';
};

export type IncidentDraft = {
  revisionId: string;
  incidentId: string;
  version: number;
  status: 'draft' | 'submitted';
  narrativeFormKey: string | null;
  fieldKey: string | null;
  fieldPrompt: string | null;
  narrative: string;
  forms: IncidentForm[];
  answers: IncidentAnswer[];
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
  value: FormJsonValue,
  expectedVersion: number,
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
      p_group_instance_id: null,
      p_value: value,
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

  const [forms, answers] = await Promise.all([
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
        .select('form_key,field_key,value,answer_state')
        .eq('incident_revision_id', revision.id)
        .is('group_instance_id', null);

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
        value: answer.value,
        answerState: answer.answer_state,
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
    narrativeFormKey: narrativeField ? 'auto' : null,
    fieldKey: narrativeField?.key ?? null,
    fieldPrompt: narrativeField ? getFieldPrompt(narrativeField) : null,
    narrative: typeof narrativeAnswer?.value === 'string' ? narrativeAnswer.value : '',
    forms,
    answers,
  };
}
