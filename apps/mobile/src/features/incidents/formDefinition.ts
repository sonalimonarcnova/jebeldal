export type FormJsonValue =
  | string
  | number
  | boolean
  | null
  | FormJsonValue[]
  | { [key: string]: FormJsonValue };

export type FormOptionDefinition = {
  value: string;
  label: string;
};

export type FormFieldValidation = {
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
};

export type FormFieldDefinition = {
  key: string;
  type: string;
  required: boolean;
  section: string | null;
  label?: unknown;
  question?: unknown;
  options: FormOptionDefinition[];
  validation?: FormFieldValidation;
  configurationError: string | null;
};

export type ParsedFormDefinition = {
  title: string | null;
  fields: FormFieldDefinition[];
  warnings: string[];
};

export type FieldValueResult =
  | { ok: true; value: FormJsonValue }
  | { ok: false; error: string };

const editableFieldTypes = new Set([
  'text',
  'long_text',
  'phone',
  'email',
  'date',
  'datetime',
  'number',
  'currency',
  'boolean',
  'enum',
  'multi_enum',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function localizedText(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  if (isRecord(value) && typeof value.en === 'string' && value.en.trim()) {
    return value.en.trim();
  }
  return null;
}

function humanizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toLocaleUpperCase('en'));
}

function validationFrom(value: unknown): FormFieldValidation | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const validation: FormFieldValidation = {};
  for (const key of ['min', 'max', 'minLength', 'maxLength'] as const) {
    const candidate = value[key];
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      validation[key] = candidate;
    }
  }
  return Object.keys(validation).length ? validation : undefined;
}

function optionsFrom(value: unknown): FormOptionDefinition[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((option) => {
    if (!isRecord(option) || typeof option.value !== 'string' || !option.value) {
      return [];
    }
    return [{
      value: option.value,
      label: localizedText(option.label) ?? option.value,
    }];
  });
}

function sectionName(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  if (!isRecord(value)) {
    return null;
  }
  return localizedText(value.label)
    ?? localizedText(value.title)
    ?? (typeof value.key === 'string' ? humanizeKey(value.key) : null);
}

function makeField(node: Record<string, unknown>, inheritedSection: string | null): FormFieldDefinition | null {
  if (typeof node.key !== 'string' || !node.key.trim() || typeof node.type !== 'string') {
    return null;
  }

  const key = node.key.trim();
  const type = node.type;
  const options = optionsFrom(node.options);
  const invalidOption = Array.isArray(node.options) && options.length !== node.options.length;
  let configurationError: string | null = null;
  if (!editableFieldTypes.has(type)) {
    configurationError = `The field type “${type}” is not supported in this MVP.`;
  } else if (
    (type === 'enum' || type === 'multi_enum')
    && (!Array.isArray(node.options) || options.length === 0 || invalidOption)
  ) {
    configurationError = 'This choice field has no usable options in its pinned definition.';
  }

  return {
    key,
    type,
    required: node.required === true,
    section: sectionName(node.section) ?? inheritedSection,
    label: node.label,
    question: node.question,
    options,
    validation: validationFrom(node.validation),
    configurationError,
  };
}

function collectFields(
  nodes: unknown,
  inheritedSection: string | null,
  fields: FormFieldDefinition[],
  warnings: string[],
): void {
  if (!Array.isArray(nodes)) {
    return;
  }

  for (const node of nodes) {
    if (!isRecord(node)) {
      warnings.push('A pinned definition entry is not an object and cannot be rendered.');
      continue;
    }

    if (
      typeof node.type === 'string'
      || (typeof node.key === 'string' && !Array.isArray(node.fields) && !Array.isArray(node.sections))
    ) {
      const field = makeField(node, inheritedSection);
      if (field) {
        fields.push(field);
      } else {
        warnings.push('A pinned field is missing a usable key or type and cannot be rendered.');
      }
      continue;
    }

    const section = sectionName(node) ?? inheritedSection;
    if (Array.isArray(node.fields)) {
      collectFields(node.fields, section, fields, warnings);
    } else {
      warnings.push('A pinned definition entry has no fields and cannot be rendered.');
    }
  }
}

export function parseFormDefinition(definition: unknown): ParsedFormDefinition {
  if (!isRecord(definition)) {
    return {
      title: null,
      fields: [],
      warnings: ['The pinned form definition is not a valid object.'],
    };
  }

  const title = localizedText(definition.label) ?? localizedText(definition.title);
  const parsedFields: FormFieldDefinition[] = [];
  const warnings: string[] = [];
  const hasSections = Array.isArray(definition.sections);
  const hasFields = Array.isArray(definition.fields);
  if (!hasSections && !hasFields) {
    return {
      title,
      fields: [],
      warnings: ['The pinned form definition contains no renderable fields.'],
    };
  }

  if (hasSections) {
    collectFields(definition.sections, null, parsedFields, warnings);
  }
  if (hasFields) {
    collectFields(definition.fields, null, parsedFields, warnings);
  }

  const fields: FormFieldDefinition[] = [];
  const seenKeys = new Set<string>();
  for (const field of parsedFields) {
    if (seenKeys.has(field.key)) {
      warnings.push(`The pinned definition repeats field key “${field.key}”; it is shown once.`);
      continue;
    }
    seenKeys.add(field.key);
    fields.push(field);
  }
  if (!fields.length && !warnings.length) {
    warnings.push('The pinned form definition contains no renderable fields.');
  }
  return { title, fields, warnings };
}

function findInNodes(
  nodes: unknown,
  fieldKey: string,
  inheritedSection: string | null = null,
): FormFieldDefinition | null {
  if (!Array.isArray(nodes)) {
    return null;
  }

  for (const node of nodes) {
    if (!isRecord(node)) {
      continue;
    }
    const candidate = makeField(node, inheritedSection);
    if (candidate?.key === fieldKey) {
      return candidate;
    }
    if (!candidate) {
      const nested = findInNodes(
        node.fields,
        fieldKey,
        sectionName(node) ?? inheritedSection,
      );
      if (nested) {
        return nested;
      }
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
  return findInNodes(definition.sections, fieldKey) ?? findInNodes(definition.fields, fieldKey);
}

export function getFieldPrompt(field: FormFieldDefinition): string {
  return localizedText(field.question)
    ?? localizedText(field.label)
    ?? (field.key === 'what_happened' ? 'What happened?' : humanizeKey(field.key) || field.key);
}

export function formFieldId(formKey: string, fieldKey: string): string {
  return JSON.stringify([formKey, fieldKey]);
}

export function initialFieldValue(field: FormFieldDefinition, value: unknown): unknown {
  if (value !== null && value !== undefined) {
    return value;
  }
  if (field.type === 'boolean') {
    return null;
  }
  if (field.type === 'multi_enum') {
    return [];
  }
  return '';
}

export function validateFieldValue(field: FormFieldDefinition, input: unknown): FieldValueResult {
  if (field.configurationError) {
    return { ok: false, error: field.configurationError };
  }

  const isEmptyString = typeof input === 'string' && input.trim().length === 0;
  const isEmptyArray = Array.isArray(input) && input.length === 0;
  const empty = input === null || input === undefined || isEmptyString || isEmptyArray;
  if (field.required && empty) {
    return { ok: false, error: `${getFieldPrompt(field)} is required.` };
  }
  if (empty) {
    return { ok: true, value: null };
  }

  if (['text', 'long_text', 'phone', 'email', 'date', 'datetime'].includes(field.type)) {
    if (typeof input !== 'string') {
      return { ok: false, error: `${getFieldPrompt(field)} must be text.` };
    }
    const validation = field.validation;
    if (validation?.minLength !== undefined && input.length < validation.minLength) {
      return { ok: false, error: `${getFieldPrompt(field)} is shorter than allowed.` };
    }
    if (validation?.maxLength !== undefined && input.length > validation.maxLength) {
      return { ok: false, error: `${getFieldPrompt(field)} is longer than allowed.` };
    }
    return { ok: true, value: input };
  }

  if (field.type === 'number' || field.type === 'currency') {
    const number = typeof input === 'number'
      ? input
      : typeof input === 'string' && input.trim()
        ? Number(input)
        : Number.NaN;
    if (!Number.isFinite(number)) {
      return { ok: false, error: `${getFieldPrompt(field)} must be a valid number.` };
    }
    if (field.validation?.min !== undefined && number < field.validation.min) {
      return { ok: false, error: `${getFieldPrompt(field)} is below the allowed minimum.` };
    }
    if (field.validation?.max !== undefined && number > field.validation.max) {
      return { ok: false, error: `${getFieldPrompt(field)} is above the allowed maximum.` };
    }
    return { ok: true, value: number };
  }

  if (field.type === 'boolean') {
    return typeof input === 'boolean'
      ? { ok: true, value: input }
      : { ok: false, error: `${getFieldPrompt(field)} must be answered Yes or No.` };
  }

  if (field.type === 'enum') {
    return typeof input === 'string' && field.options.some((option) => option.value === input)
      ? { ok: true, value: input }
      : { ok: false, error: `${getFieldPrompt(field)} must use an option from the pinned definition.` };
  }

  if (field.type === 'multi_enum') {
    return Array.isArray(input)
      && input.every((value) => typeof value === 'string'
        && field.options.some((option) => option.value === value))
      ? { ok: true, value: input as string[] }
      : { ok: false, error: `${getFieldPrompt(field)} contains an option outside the pinned definition.` };
  }

  return { ok: false, error: `The field type “${field.type}” is not supported in this MVP.` };
}
