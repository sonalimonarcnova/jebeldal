// Field-definition → extraction-catalog mapping, shared by the interview-graph catalog (interview_catalog.ts, primary)
// and the definitions-only catalog below (fallback when a form set has no interview graph).
// Pure: callers fetch the rows and pass them in.
import { stubCatalogFor, type CatalogEntry } from './catalog.ts';

export type TriggeredForm = { form_key: string; form_version: number };
export type FormDefinitionRow = { form_key: string; version: number; definition: unknown };

/** Field types the voice pipeline can propose values for. Others are skipped and reported. */
export const SUPPORTED_TYPES = new Set(['text', 'long_text', 'phone', 'email', 'boolean', 'enum', 'multi_enum']);

/** The driver's story is recognised by its question/label, never by a hard-coded key. */
const STORY_TEXT = /\bwhat happened\b/i;

export type FieldNode = {
  key?: unknown;
  type?: unknown;
  required?: unknown;
  label?: unknown;
  question?: unknown;
  prompt?: unknown;
  description?: unknown;
  help?: unknown;
  options?: unknown;
  validation?: unknown;
  narrative?: unknown;
  fields?: unknown;
  sections?: unknown;
};

export type SkippedField = { form_key: string; field_key: string; type: string };

export type CatalogBuildResult = {
  catalog: CatalogEntry[];
  /** form keys whose definitions had no usable fields, so the stub catalog was used */
  fallbackForms: string[];
  /** fields skipped because their type is not supported (e.g. number, address, media, repeated groups) */
  skipped: SkippedField[];
};

export const humanise = (key: string) => key.replace(/[_.-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/** A string, or the English text of a localized { en: "…" } label. */
export function text(v: unknown): string | undefined {
  if (typeof v === 'string') return v.trim() || undefined;
  if (typeof v === 'object' && v !== null) return text((v as { en?: unknown }).en);
  return undefined;
}

/** True when a text-like field reads as the driver's story ("What happened?"). */
export function isStoryField(field: FieldNode, prompt?: string): boolean {
  if (field.narrative === true) return true;
  const type = String(field.type);
  if (type !== 'text' && type !== 'long_text') return false;
  return [prompt, text(field.question), text(field.label)].some((t) => t !== undefined && STORY_TEXT.test(t));
}

/**
 * Scalar fields of a definition, like private.definition_fields(): walks fields/sections; containers are not fields;
 * repeated groups are reported in `groups` and their children are not walked (they need a group_instance_id).
 */
export function walkDefinition(definition: unknown): { scalars: FieldNode[]; groups: FieldNode[] } {
  const scalars: FieldNode[] = [];
  const groups: FieldNode[] = [];
  const visit = (node: unknown) => {
    if (typeof node !== 'object' || node === null || Array.isArray(node)) return;
    const n = node as FieldNode;
    if (n.type === 'repeated_group') {
      groups.push(n);
      return;
    }
    const isContainer = Array.isArray(n.fields) || Array.isArray(n.sections);
    if (typeof n.key === 'string' && n.type !== undefined && !isContainer) scalars.push(n);
    for (const child of [n.fields, n.sections]) if (Array.isArray(child)) child.forEach(visit);
  };
  visit(definition);
  return { scalars, groups };
}

/** Keys of all fields nested inside repeated groups (for logging what voice cannot fill yet). */
export function groupFieldKeys(definition: unknown): Set<string> {
  const keys = new Set<string>();
  for (const group of walkDefinition(definition).groups) {
    const inner = (node: unknown) => {
      if (typeof node !== 'object' || node === null) return;
      const n = node as FieldNode;
      if (typeof n.key === 'string') keys.add(n.key);
      for (const child of [n.fields, n.sections]) if (Array.isArray(child)) child.forEach(inner);
    };
    for (const child of [group.fields, group.sections]) if (Array.isArray(child)) child.forEach(inner);
  }
  return keys;
}

function optionValues(options: unknown): { values: string[]; labels: string[] } {
  const values: string[] = [];
  const labels: string[] = [];
  if (!Array.isArray(options)) return { values, labels };
  for (const o of options) {
    const value = typeof o === 'string' ? o.trim() : text((o as { value?: unknown })?.value);
    if (!value) continue;
    values.push(value);
    const label = typeof o === 'object' && o !== null ? text((o as { label?: unknown }).label) : undefined;
    labels.push(label && label !== value ? `${value} = ${label}` : value);
  }
  return { values, labels };
}

/**
 * One catalog entry for a scalar field, or null if the field cannot be proposed (unsupported type, no options).
 * `prompt` (e.g. the interview question) and `narrative` override what the definition says.
 */
export function fieldEntry(
  formKey: string,
  field: FieldNode,
  overrides: { prompt?: string; narrative?: boolean } = {},
): CatalogEntry | null {
  const fieldKey = field.key as string;
  const type = String(field.type);
  if (!SUPPORTED_TYPES.has(type)) return null;

  const label = text(field.label);
  const prompt = overrides.prompt ?? text(field.question) ?? text(field.prompt) ?? label ?? humanise(fieldKey);
  // The form label often names the field differently from the question ("Seatbelt in use?"): give the model both.
  const given = text(field.description) ?? text(field.help) ?? (label && label !== prompt ? `Form field: ${label}.` : undefined);
  const base = { key: `${formKey}.${fieldKey}`, formKey, fieldKey, prompt, required: field.required === true };

  if (type === 'boolean') {
    return {
      ...base,
      ui: 'single',
      extractType: 'enum',
      valueKind: 'boolean',
      options: ['true', 'false'],
      description:
        (given ? `${given} ` : '') +
        `Yes/no: "true" only if the driver explicitly says this applies, "false" only if they explicitly say it does not.`,
    };
  }
  if (type === 'enum' || type === 'multi_enum') {
    const { values, labels } = optionValues(field.options);
    if (values.length === 0) return null;
    return {
      ...base,
      ui: type === 'enum' ? 'single' : 'multi',
      extractType: type === 'enum' ? 'enum' : 'enum_list',
      valueKind: type === 'enum' ? 'enum' : 'multi_enum',
      options: values,
      description: `${given ? `${given} ` : ''}Options (value = meaning): ${labels.join('; ')}.`,
    };
  }
  const maxLength = Number((field.validation as { maxLength?: unknown } | undefined)?.maxLength);
  const narrative = overrides.narrative ?? isStoryField(field, prompt);
  return {
    ...base,
    ui: 'voice_open',
    extractType: 'text',
    valueKind: 'text',
    description: given ?? (narrative ? "The driver's own account of the incident, in their words." : `${prompt} — as stated.`),
    ...(Number.isFinite(maxLength) && maxLength > 0 ? { maxLength } : {}),
    ...(narrative ? { narrative: true as const } : {}),
  };
}

/**
 * Fallback catalog when the form set has no interview graph: every supported scalar field of each triggered form.
 * Only the first story-looking field is narrative. A form with no usable fields falls back to the stub catalog.
 */
export function buildFormCatalog(triggered: TriggeredForm[], definitions: FormDefinitionRow[]): CatalogBuildResult {
  const catalog: CatalogEntry[] = [];
  const fallbackForms: string[] = [];
  const skipped: SkippedField[] = [];
  let storyAssigned = false;

  for (const form of triggered) {
    const row = definitions.find((d) => d.form_key === form.form_key && d.version === form.form_version);
    const { scalars, groups } = walkDefinition(row?.definition);
    for (const g of groups) skipped.push({ form_key: form.form_key, field_key: String(g.key), type: 'repeated_group' });

    const entries: CatalogEntry[] = [];
    for (const field of scalars) {
      const story = !storyAssigned && isStoryField(field);
      const entry = fieldEntry(form.form_key, field, { narrative: story });
      if (!entry) {
        skipped.push({ form_key: form.form_key, field_key: field.key as string, type: String(field.type) });
        continue;
      }
      if (story) storyAssigned = true;
      entries.push(entry);
    }

    if (entries.length === 0) {
      fallbackForms.push(form.form_key);
      catalog.push(...stubCatalogFor(form.form_key));
    } else {
      catalog.push(...entries);
    }
  }
  return { catalog, fallbackForms, skipped };
}

/**
 * Resolves the current question: an explicit (form_key, field_key) pair first, then question_key as
 * "form.field" or a bare field key (auto preferred). Undefined if it is not in the catalog.
 */
export function findQuestion(
  catalog: CatalogEntry[],
  questionKey?: string,
  formKey?: string,
  fieldKey?: string,
): CatalogEntry | undefined {
  if (formKey && fieldKey) {
    const exact = catalog.find((e) => e.formKey === formKey && e.fieldKey === fieldKey);
    if (exact) return exact;
  }
  const key = questionKey ?? fieldKey;
  if (!key) return undefined;
  return (
    catalog.find((e) => e.key === key) ??
    catalog.find((e) => e.fieldKey === key && e.formKey === 'auto') ??
    catalog.find((e) => e.fieldKey === key)
  );
}

/** The current question's entry first (the prompt lists fields in catalog order). */
export function withQuestionFirst(catalog: CatalogEntry[], question: CatalogEntry | undefined): CatalogEntry[] {
  if (!question) return catalog;
  return [question, ...catalog.filter((e) => e.key !== question.key)];
}
