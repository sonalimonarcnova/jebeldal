// Builds the extraction catalog from the revision's triggered forms and their form_definitions.
// Pure: callers fetch the rows (incident_revision_forms + form_definitions) and pass them in.
import { stubCatalogFor, type CatalogEntry } from './catalog.ts';

export type TriggeredForm = { form_key: string; form_version: number };
export type FormDefinitionRow = { form_key: string; version: number; definition: unknown };

/** Field types the voice pipeline can propose values for. Others are skipped and reported. */
const SUPPORTED_TYPES = new Set(['text', 'long_text', 'phone', 'email', 'boolean', 'enum', 'multi_enum']);

/**
 * The story field is exempt from the "value longer than its evidence" check and always stores the full transcript
 * when it is the current question. Definitions may mark it with `narrative: true`; until Eng B's definitions do,
 * the `what_happened` key is treated as narrative. TODO(B): add `narrative: true` to the story field definition.
 */
const LEGACY_NARRATIVE_KEYS = new Set(['what_happened']);

type FieldNode = {
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

export type CatalogBuildResult = {
  catalog: CatalogEntry[];
  /** form keys whose definitions had no usable fields, so the stub catalog was used */
  fallbackForms: string[];
  /** fields skipped because their type is not supported (e.g. number, address, media, repeated groups) */
  skipped: Array<{ form_key: string; field_key: string; type: string }>;
};

const humanise = (key: string) => key.replace(/[_.-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** Flattens fields/sections like private.definition_fields(); children of repeated groups are not walked. */
function walk(node: unknown, out: FieldNode[]) {
  if (typeof node !== 'object' || node === null) return;
  const n = node as FieldNode;
  const isContainer = Array.isArray(n.fields) || Array.isArray(n.sections);
  if (n.type === 'repeated_group') {
    // Group answers need a group_instance_id; not supported by voice yet. Report it, don't walk its children.
    if (typeof n.key === 'string') out.push(n);
    return;
  }
  if (typeof n.key === 'string' && n.type !== undefined && !isContainer) out.push(n);
  for (const child of [n.fields, n.sections]) {
    if (Array.isArray(child)) for (const c of child) walk(c, out);
  }
}

function optionValues(options: unknown): { values: string[]; labels: string[] } {
  const values: string[] = [];
  const labels: string[] = [];
  if (!Array.isArray(options)) return { values, labels };
  for (const o of options) {
    const value = typeof o === 'string' ? o : str((o as { value?: unknown })?.value);
    if (!value) continue;
    values.push(value);
    const label = typeof o === 'object' && o !== null ? str((o as { label?: unknown }).label) : undefined;
    labels.push(label && label !== value ? `${value} = ${label}` : value);
  }
  return { values, labels };
}

function toEntry(formKey: string, field: FieldNode): CatalogEntry | null {
  const fieldKey = field.key as string;
  const type = String(field.type);
  const prompt = str(field.question) ?? str(field.prompt) ?? str(field.label) ?? humanise(fieldKey);
  const given = str(field.description) ?? str(field.help);
  const base = {
    key: `${formKey}.${fieldKey}`,
    formKey,
    fieldKey,
    prompt,
    required: field.required === true,
  };

  if (type === 'boolean') {
    return {
      ...base,
      ui: 'single',
      extractType: 'enum',
      valueKind: 'boolean',
      options: ['true', 'false'],
      description:
        given ??
        `Yes/no: "true" only if the driver explicitly says this applies (${humanise(fieldKey).toLowerCase()}), ` +
          '"false" only if they explicitly say it does not.',
    };
  }
  if (type === 'enum' || type === 'multi_enum') {
    const { values, labels } = optionValues(field.options);
    if (values.length === 0) return null; // nothing the model could choose from
    return {
      ...base,
      ui: type === 'enum' ? 'single' : 'multi',
      extractType: type === 'enum' ? 'enum' : 'enum_list',
      valueKind: type === 'enum' ? 'enum' : 'multi_enum',
      options: values,
      description: `${given ?? prompt} Options: ${labels.join('; ')}.`,
    };
  }
  // text, long_text, phone, email
  const maxLength = Number((field.validation as { maxLength?: unknown } | undefined)?.maxLength);
  const narrative = field.narrative === true || LEGACY_NARRATIVE_KEYS.has(fieldKey);
  return {
    ...base,
    ui: 'voice_open',
    extractType: 'text',
    valueKind: 'text',
    description: given ?? (narrative ? "The driver's own account of the incident, in their words." : `${prompt}, as stated.`),
    ...(Number.isFinite(maxLength) && maxLength > 0 ? { maxLength } : {}),
    ...(narrative ? { narrative: true as const } : {}),
  };
}

export function buildFormCatalog(triggered: TriggeredForm[], definitions: FormDefinitionRow[]): CatalogBuildResult {
  const catalog: CatalogEntry[] = [];
  const fallbackForms: string[] = [];
  const skipped: CatalogBuildResult['skipped'] = [];

  for (const form of triggered) {
    const row = definitions.find((d) => d.form_key === form.form_key && d.version === form.form_version);
    const nodes: FieldNode[] = [];
    walk(row?.definition, nodes);

    const entries: CatalogEntry[] = [];
    for (const node of nodes) {
      const type = String(node.type);
      if (!SUPPORTED_TYPES.has(type)) {
        skipped.push({ form_key: form.form_key, field_key: node.key as string, type });
        continue;
      }
      const entry = toEntry(form.form_key, node);
      if (entry) entries.push(entry);
      else skipped.push({ form_key: form.form_key, field_key: node.key as string, type });
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

/** Resolves the request's question_key ("form.field" or a bare field key) to a catalog entry. */
export function findQuestion(catalog: CatalogEntry[], questionKey: string): CatalogEntry | undefined {
  return (
    catalog.find((e) => e.key === questionKey) ??
    catalog.find((e) => e.fieldKey === questionKey && e.formKey === 'auto') ??
    catalog.find((e) => e.fieldKey === questionKey)
  );
}
