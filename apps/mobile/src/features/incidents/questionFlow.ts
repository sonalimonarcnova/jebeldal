import type { FormFieldDefinition, FormOptionDefinition } from './formDefinition';

export type InterviewQuestion = {
  formKey: string | null;
  fieldKey: string;
  prompt: string;
  options: FormOptionDefinition[];
  selectionSource: string | null;
};

export type NextQuestionResult =
  | { kind: 'question'; question: InterviewQuestion }
  | { kind: 'complete' };

export type ProcessedTurn = {
  turnId: string;
  status: 'received' | 'processing' | 'completed';
};

export type QuestionFlowRequest = Record<string, unknown>;
export type QuestionFlowInvoker = (
  functionName: 'select-next-question' | 'process-incident-turn',
  body: QuestionFlowRequest,
) => Promise<{ data: unknown; error: { message: string } | null }>;

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseOptions(value: unknown): FormOptionDefinition[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error('The question-flow response contains invalid options.');
  }

  return value.map((option) => {
    if (typeof option === 'string' && option.trim()) {
      return { value: option, label: option };
    }
    if (!isRecord(option) || typeof option.value !== 'string' || !option.value.trim()) {
      throw new Error('The question-flow response contains an invalid option.');
    }
    const label = typeof option.label === 'string'
      ? option.label
      : isRecord(option.label) && typeof option.label.en === 'string'
        ? option.label.en
        : option.value;
    return { value: option.value, label };
  });
}

export function parseNextQuestionResponse(value: unknown): NextQuestionResult {
  if (!isRecord(value)) {
    throw new Error('The question-flow response is not a valid object.');
  }
  if (value.status === 'interview_complete' || value.interview_complete === true) {
    return { kind: 'complete' };
  }

  const candidate = isRecord(value.selected_question)
    ? value.selected_question
    : isRecord(value.next_question)
      ? value.next_question
      : isRecord(value.question)
        ? value.question
        : null;
  if (!candidate) {
    throw new Error('The question-flow response does not contain a selected question.');
  }

  const formKey = nonEmptyString(candidate.form_key);
  const fieldKey = nonEmptyString(candidate.field_key) ?? nonEmptyString(candidate.key);
  const prompt = nonEmptyString(candidate.prompt) ?? nonEmptyString(candidate.question_prompt);
  if (!fieldKey || !prompt) {
    throw new Error('The selected question is missing its key or authored prompt.');
  }

  const selectionSource = nonEmptyString(value.selection_source)
    ?? nonEmptyString(candidate.selection_source);
  return {
    kind: 'question',
    question: {
      formKey,
      fieldKey,
      prompt,
      options: parseOptions(candidate.options),
      selectionSource,
    },
  };
}

export function parseProcessedTurnResponse(value: unknown): ProcessedTurn {
  if (!isRecord(value)) {
    throw new Error('The turn-processing response is not a valid object.');
  }
  const turnId = nonEmptyString(value.turn_id);
  const status = value.status;
  if (!turnId || !['received', 'processing', 'completed'].includes(String(status))) {
    const message = nonEmptyString(value.message);
    throw new Error(message ?? 'The turn-processing response did not confirm an accepted turn.');
  }
  return {
    turnId,
    status: status as ProcessedTurn['status'],
  };
}

export async function selectNextQuestionWith(
  invoke: QuestionFlowInvoker,
  revisionId: string,
): Promise<NextQuestionResult> {
  const { data, error } = await invoke('select-next-question', {
    incident_revision_id: revisionId,
  });
  if (error) {
    throw new Error(error.message || 'Question selection is unavailable.');
  }
  return parseNextQuestionResponse(data);
}

export async function processIncidentTextTurnWith(
  invoke: QuestionFlowInvoker,
  input: { revisionId: string; clientTurnId: string; text: string },
): Promise<ProcessedTurn> {
  const text = input.text.trim();
  if (!text) {
    throw new Error('Enter an answer before submitting this turn.');
  }
  const { data, error } = await invoke('process-incident-turn', {
    incident_revision_id: input.revisionId,
    client_turn_id: input.clientTurnId,
    text,
  });
  if (error) {
    throw new Error(error.message || 'Turn processing is unavailable.');
  }
  return parseProcessedTurnResponse(data);
}

export function findPinnedQuestionField(
  question: InterviewQuestion,
  forms: readonly {
    formKey: string;
    definition: { fields: FormFieldDefinition[] } | null;
  }[],
): FormFieldDefinition | null {
  return findPinnedQuestionMapping(question, forms)?.field ?? null;
}

export function findPinnedQuestionMapping(
  question: InterviewQuestion,
  forms: readonly {
    formKey: string;
    definition: { fields: FormFieldDefinition[] } | null;
  }[],
): { formKey: string; field: FormFieldDefinition } | null {
  const candidates = question.formKey
    ? forms.filter((form) => form.formKey === question.formKey)
    : forms;
  const matches = candidates.flatMap((form) => {
    const field = form.definition?.fields.find((candidate) => candidate.key === question.fieldKey);
    return field ? [{ formKey: form.formKey, field }] : [];
  });
  return matches.length === 1 ? matches[0] : null;
}

export function questionAnswerText(field: FormFieldDefinition, value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => {
      const option = field.options.find((candidate) => candidate.value === item);
      return option?.label ?? String(item);
    }).join('; ');
  }
  if (field.type === 'boolean' && typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  if (field.type === 'enum' && typeof value === 'string') {
    return field.options.find((option) => option.value === value)?.label ?? value;
  }
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

export function createClientTurnId(): string {
  return `mobile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
