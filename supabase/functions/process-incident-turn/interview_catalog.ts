// Extraction catalog from the interview graph (form_sets.definition.interview_graph) — the primary catalog.
// Only graph nodes that the team's own prepareInterviewGraph() pins to a scalar field of a TRIGGERED form are
// included (~20–30 entries instead of ~160 definition fields), so the prompt stays small and fast and the catalog
// matches what select-next-question asks. Pure: callers pass the graph and the triggered forms' definitions.
// @ts-ignore: plain ES module shared with select-next-question (no type declarations)
import { prepareInterviewGraph } from '../_shared/interview.mjs';
import type { CatalogEntry } from './catalog.ts';
import { fieldEntry, groupFieldKeys, isStoryField, walkDefinition, type SkippedField } from './form_catalog.ts';

export type InterviewGraph = { nodes: unknown[]; conditions?: unknown[]; form_key_map?: Record<string, string> };
export type TriggeredDefinition = { form_key: string; definition: unknown };

type PreparedNode = { key: string; prompt?: unknown; sequence?: unknown; form_key: string | null };

export type InterviewCatalogResult = {
  catalog: CatalogEntry[];
  /** pinned nodes whose field cannot be proposed (unsupported type, container, no options) */
  skipped: SkippedField[];
  /** node keys that only exist inside repeated groups of a triggered form (need a group_instance_id) */
  groupFields: string[];
  /** the story field's catalog key, if the graph has one */
  storyKey: string | null;
};

export function isInterviewGraph(value: unknown): value is InterviewGraph {
  return typeof value === 'object' && value !== null && Array.isArray((value as { nodes?: unknown }).nodes);
}

export function buildInterviewCatalog(graph: InterviewGraph, triggered: TriggeredDefinition[]): InterviewCatalogResult {
  const prepared = prepareInterviewGraph({ conditions: [], ...graph }, triggered, {}) as { nodes: PreparedNode[] };
  const nodes = [...prepared.nodes].sort((a, b) => Number(a.sequence ?? 0) - Number(b.sequence ?? 0));
  const scalarsByForm = new Map(triggered.map((f) => [f.form_key, walkDefinition(f.definition).scalars]));
  const groupKeys = new Set(triggered.flatMap((f) => [...groupFieldKeys(f.definition)]));

  const catalog: CatalogEntry[] = [];
  const skipped: SkippedField[] = [];
  const groupFields: string[] = [];
  let storyKey: string | null = null;

  for (const node of nodes) {
    if (!node.form_key) {
      if (groupKeys.has(node.key)) groupFields.push(node.key);
      continue; // not in a triggered form (or ambiguous): not askable now
    }
    const field = scalarsByForm.get(node.form_key)?.find((f) => f.key === node.key);
    if (!field) {
      skipped.push({ form_key: node.form_key, field_key: node.key, type: 'not_a_scalar_field' });
      continue;
    }
    const prompt = typeof node.prompt === 'string' && node.prompt.trim() ? node.prompt.trim() : undefined;
    // The story field: a definition's narrative flag, else the graph's first "what happened" node with a text field.
    const story = storyKey === null && isStoryField(field, prompt);
    const entry = fieldEntry(node.form_key, field, { prompt, narrative: story });
    if (!entry) {
      skipped.push({ form_key: node.form_key, field_key: node.key, type: String(field.type) });
      continue;
    }
    if (story) storyKey = entry.key;
    catalog.push(entry);
  }
  return { catalog, skipped, groupFields, storyKey };
}
