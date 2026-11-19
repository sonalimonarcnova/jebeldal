// Run: node scripts/test-voice.mjs   (or deno test supabase/functions/process-incident-turn/)
// Uses the REAL interview graph and form definitions from supabase/seed.sql (same loader as
// supabase/tests/interview-graph-seed.test.mjs).
import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { CatalogEntry } from './catalog.ts';
import { findQuestion, withQuestionFirst } from './form_catalog.ts';
import { buildInterviewCatalog, type InterviewGraph } from './interview_catalog.ts';
import { MockExtract, SCENARIO_A_TEXT, SCENARIO_B_TEXT, SCENARIO_C_TEXT } from './providers.ts';
import { validateProposals } from './validate.ts';

const seed = readFileSync(new URL('../../seed.sql', import.meta.url), 'utf8');
const graph = JSON.parse(seed.match(/\$interview_graph\$\s*([\s\S]*?)\s*\$interview_graph\$/u)?.[1] ?? 'null') as InterviewGraph;
const definition = (tag: string) => JSON.parse(seed.match(new RegExp(`\\$${tag}\\$\\s*([\\s\\S]*?)\\s*\\$${tag}\\$::jsonb`, 'u'))?.[1] ?? 'null');
const auto = { form_key: 'auto', definition: definition('auto') };
const gl = { form_key: 'general_liability', definition: definition('gl') };
const wc = { form_key: 'workers_comp', definition: definition('wc') };

const graphKeys = new Set((graph.nodes as Array<{ key: string }>).map((n) => n.key));
const byKey = (catalog: CatalogEntry[]) => Object.fromEntries(catalog.map((e) => [e.key, e]));

Deno.test('seed loads: 38-node graph and three definitions', () => {
  strictEqual(graph.nodes.length, 38);
  ok(auto.definition && gl.definition && wc.definition);
});

Deno.test('auto only: graph nodes pinned to auto scalar fields, nothing from untriggered forms, prompt-sized', () => {
  const { catalog } = buildInterviewCatalog(graph, [auto]);
  ok(catalog.length >= 15 && catalog.length <= 38, `catalog size ${catalog.length}`);
  ok(catalog.every((e) => e.formKey === 'auto'));
  ok(catalog.every((e) => graphKeys.has(e.fieldKey as string)), 'every entry is an interview graph node');
  const keys = catalog.map((e) => e.key);
  for (const k of ['auto.what_happened', 'auto.involved', 'auto.injuries', 'auto.police', 'auto.truck_damage', 'auto.police_report_no']) {
    ok(keys.includes(k), `${k} present`);
  }
  ok(!keys.some((k) => k.endsWith('.place_type')), 'GL-only node not offered while GL is not triggered');
});

Deno.test('entries use the interview question, the form label and the exact definition option values', () => {
  const e = byKey(buildInterviewCatalog(graph, [auto]).catalog);
  strictEqual(e['auto.involved'].prompt, 'What else was involved?');
  deepStrictEqual(e['auto.involved'].options, ['another_vehicle', 'object', 'delivery_claim', 'just_my_truck']);
  strictEqual(e['auto.involved'].extractType, 'enum_list');
  ok(e['auto.truck_damage'].options?.includes('none'), 'truck_damage uses "none", not "no_damage"');
  deepStrictEqual(e['auto.drivable'].options, ['yes_i_can_drive_it', 'needs_tow']);
  ok(e['auto.seatbelt'].description.includes('Seatbelt in use?'), 'form label is passed to the model');
  strictEqual(e['auto.what_happened'].maxLength, 4000);
});

Deno.test('story field: exactly one narrative entry, found from the graph (no hard-coded key)', () => {
  const r = buildInterviewCatalog(graph, [auto]);
  strictEqual(r.storyKey, 'auto.what_happened');
  deepStrictEqual(r.catalog.filter((e) => e.narrative).map((e) => e.key), ['auto.what_happened']);

  // Renaming the key keeps the behaviour: it comes from the question text.
  const renamed: InterviewGraph = { ...graph, nodes: [{ key: 'tell_us', prompt: 'What happened?', sequence: 1, forms_source: 'Auto', options: [] }] };
  const def = { fields: [{ key: 'tell_us', type: 'long_text', question: 'What happened?' }] };
  strictEqual(buildInterviewCatalog(renamed, [{ form_key: 'auto', definition: def }]).storyKey, 'auto.tell_us');
});

Deno.test('GL triggered: GL nodes appear with GL option values; a GL section heading is skipped, not offered', () => {
  const r = buildInterviewCatalog(graph, [auto, gl]);
  const e = byKey(r.catalog);
  deepStrictEqual(e['general_liability.place_type'].options, ['customer_s_site', 'our_yard_or_terminal', 'public_road', 'job_site']);
  ok(e['general_liability.property_owner'], 'property_owner offered under GL');
  ok(!e['general_liability.property_damaged'] && !e['auto.property_damaged'], 'property_damaged is a GL section, not a field');
  ok(r.skipped.some((s) => s.form_key === 'general_liability' && s.field_key === 'property_damaged'));
});

Deno.test('repeated-group-only nodes are reported, never offered', () => {
  const groupGraph: InterviewGraph = {
    nodes: [
      { key: 'what_happened', prompt: 'What happened?', sequence: 1, forms_source: 'Auto', options: [] },
      { key: 'witness_name', prompt: 'Who saw it?', sequence: 2, forms_source: 'Auto', options: [] },
    ],
    form_key_map: { Auto: 'auto' },
  };
  const def = {
    sections: [
      {
        key: 's',
        fields: [
          { key: 'what_happened', type: 'long_text', question: 'What happened?' },
          { key: 'witnesses', type: 'repeated_group', fields: [{ key: 'witness_name', type: 'text' }] },
        ],
      },
    ],
  };
  const r = buildInterviewCatalog(groupGraph, [{ form_key: 'auto', definition: def }]);
  deepStrictEqual(r.catalog.map((c) => c.key), ['auto.what_happened']);
  deepStrictEqual(r.groupFields, ['witness_name']);
});

Deno.test('current question: (form_key, field_key) resolves and is listed first', () => {
  const { catalog } = buildInterviewCatalog(graph, [auto, gl]);
  const question = findQuestion(catalog, undefined, 'general_liability', 'place_type');
  strictEqual(question?.key, 'general_liability.place_type');
  strictEqual(withQuestionFirst(catalog, question)[0].key, 'general_liability.place_type');
  strictEqual(findQuestion(catalog, 'what_happened')?.key, 'auto.what_happened');
  strictEqual(findQuestion(catalog, undefined, 'auto', 'not_a_field'), undefined);
});

async function extract(text: string, forms = [auto], questionKey = 'auto.what_happened') {
  const { catalog } = buildInterviewCatalog(graph, forms);
  const raw = await new MockExtract().extract({ transcript: text, questionKey, catalog });
  const r = validateProposals(raw, text, catalog);
  return { r, values: Object.fromEntries(r.applied.map((p) => [`${p.form_key}.${p.field_key}`, p.value])) };
}

Deno.test('Scenario B on the seeded auto form: real form/field keys and option values', async () => {
  const { r, values } = await extract(SCENARIO_B_TEXT);
  deepStrictEqual(r.rejected, []);
  deepStrictEqual(values['auto.involved'], ['another_vehicle', 'object']);
  strictEqual(values['auto.police'], 'came');
  strictEqual(values['auto.injuries'], 'no_one');
  deepStrictEqual(values['auto.truck_damage'], ['front_bumper']);
  strictEqual(values['auto.what_happened'], SCENARIO_B_TEXT);
});

Deno.test('Scenarios A and C use the definitions\' own values (our_yard_or_terminal, customer_s_site, none)', async () => {
  const a = await extract(SCENARIO_A_TEXT, [auto, gl]);
  strictEqual(a.values['general_liability.place_type'], 'our_yard_or_terminal');
  deepStrictEqual(a.values['auto.truck_damage'], ['rear']);
  const c = await extract(SCENARIO_C_TEXT, [auto, gl]);
  strictEqual(c.values['general_liability.place_type'], 'customer_s_site');
  deepStrictEqual(c.values['auto.truck_damage'], ['none']);
  strictEqual(c.values['auto.injuries'], 'me');
});
