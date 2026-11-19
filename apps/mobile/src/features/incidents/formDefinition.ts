export type FormFieldDefinition = {
  key: string;
  type: string;
  required: boolean;
  label?: unknown;
  question?: unknown;
  validation?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fieldFromNode(node: unknown): FormFieldDefinition | null {
  if (!isRecord(node) || typeof node.key !== 'string' || typeof node.type !== 'string') {
    return null;
  }

  return {
    key: node.key,
    type: node.type,
    required: node.required === true,
    label: node.label,
    question: node.question,
    validation: node.validation,
  };
}

function findInNodes(nodes: unknown, fieldKey: string): FormFieldDefinition | null {
  if (!Array.isArray(nodes)) {
    return null;
  }

  for (const node of nodes) {
    const candidate = fieldFromNode(node);
    if (candidate?.key === fieldKey) {
      return candidate;
    }
    if (!isRecord(node)) {
      continue;
    }

    const nested = findInNodes(node.fields, fieldKey) ?? findInNodes(node.sections, fieldKey);
    if (nested) {
      return nested;
    }
  }

  return null;
}

export function findFieldDefinition(
  definition: unknown,
  fieldKey: string,
): FormFieldDefinition | null {
  if (!isRecord(definition)) {
    return null;
  }

  return findInNodes(definition.fields, fieldKey) ?? findInNodes(definition.sections, fieldKey);
}

export function getFieldPrompt(field: FormFieldDefinition): string {
  const question = localizedText(field.question);
  if (question) {
    return question;
  }
  const label = localizedText(field.label);
  if (label) {
    return label;
  }
  if (field.key === 'what_happened') {
    return 'What happened?';
  }
  return field.key;
}

function localizedText(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  if (isRecord(value)) {
    const english = value.en;
    if (typeof english === 'string' && english.trim()) {
      return english.trim();
    }
  }
  return null;
}
