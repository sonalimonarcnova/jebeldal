// Run: deno test supabase/functions/process-incident-turn/   (or: node scripts/test-voice.mjs)
import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { stubCatalogFor } from './catalog.ts';
import { buildFormCatalog } from './form_catalog.ts';
import { APPLY_THRESHOLD, INFERRED_MAX_CONFIDENCE, validateProposals, type FieldProposal } from './validate.ts';

// Stub catalog keyed like the runtime one: "auto.<field>".
const catalog = stubCatalogFor('auto');
const transcript = 'A silver sedan cut in front of me. Police came. Nobody was hurt. It was foggy.';

const p = (field: string, value: unknown, confidence: unknown, evidence_quote: string, stated?: boolean) => ({
  key: `auto.${field}`,
  value,
  confidence,
  evidence_quote,
  ...(stated === undefined ? {} : { stated }),
});
const fields = (list: FieldProposal[]) => list.map((x) => x.field_key);

Deno.test('output uses the contract shape { form_key, field_key, value, confidence, evidence_quote }', () => {
  const r = validateProposals([p('police', 'came', 0.95, 'Police came')], transcript, catalog);
  deepStrictEqual(r.applied, [{ form_key: 'auto', field_key: 'police', value: 'came', confidence: 0.95, evidence_quote: 'Police came' }]);
});

Deno.test('unknown key is rejected, including a known field under the wrong form', () => {
  const r = validateProposals(
    [p('favourite_colour', 'blue', 0.95, 'silver sedan'), { key: 'workers_comp.police', value: 'came', confidence: 0.9, evidence_quote: 'Police came' }],
    transcript,
    catalog,
  );
  strictEqual(r.applied.length, 0);
  deepStrictEqual(r.rejected.map((x) => x.reason), ['unknown_key', 'unknown_key']);
});

Deno.test('invalid enum value is rejected (single and list)', () => {
  const r = validateProposals(
    [p('police', 'arrested_me', 0.95, 'Police came'), p('involved', ['another_vehicle', 'spaceship'], 0.95, 'silver sedan')],
    transcript,
    catalog,
  );
  strictEqual(r.applied.length, 0);
  deepStrictEqual(r.rejected.map((x) => x.reason), ['invalid_value', 'invalid_value']);
});

Deno.test('text value must be a non-empty string', () => {
  const r = validateProposals([p('witnesses', ['Luis'], 0.95, 'sedan'), p('witnesses', '  ', 0.95, 'sedan')], transcript, catalog);
  deepStrictEqual(r.rejected.map((x) => x.reason), ['invalid_value', 'invalid_value']);
});

Deno.test('evidence quote not in transcript is rejected; matching is case- and whitespace-insensitive', () => {
  const r = validateProposals(
    [p('police', 'came', 0.95, 'the officer arrived'), p('injuries', 'no_one', 0.95, 'NOBODY   was hurt')],
    transcript,
    catalog,
  );
  deepStrictEqual(r.rejected.map((x) => [x.key, x.reason]), [['auto.police', 'quote_not_in_transcript']]);
  deepStrictEqual(fields(r.applied), ['injuries']);
  strictEqual(r.applied[0].evidence_quote, 'NOBODY   was hurt');
});

Deno.test('empty quote is rejected', () => {
  strictEqual(validateProposals([p('police', 'came', 0.9, '')], transcript, catalog).rejected[0].reason, 'quote_not_in_transcript');
});

Deno.test('confidence outside 0–1 or non-numeric is rejected', () => {
  const r = validateProposals(
    [p('police', 'came', 1.2, 'Police came'), p('police', 'came', -0.1, 'Police came'), p('police', 'came', '0.9', 'Police came')],
    transcript,
    catalog,
  );
  deepStrictEqual(r.rejected.map((x) => x.reason), ['invalid_confidence', 'invalid_confidence', 'invalid_confidence']);
});

Deno.test('malformed items are rejected', () => {
  const r = validateProposals([null, 'police', { value: 'came' }], transcript, catalog);
  deepStrictEqual(r.rejected.map((x) => x.reason), ['malformed', 'malformed', 'malformed']);
});

Deno.test(`confidence split: >= ${APPLY_THRESHOLD} applied, below suggested`, () => {
  const r = validateProposals(
    [p('police', 'came', 0.8, 'Police came'), p('injuries', 'no_one', 0.79, 'Nobody was hurt'), p('weather_road', ['fog'], 0.6, 'foggy')],
    transcript,
    catalog,
  );
  deepStrictEqual(fields(r.applied), ['police']);
  deepStrictEqual(fields(r.suggested), ['injuries', 'weather_road']);
});

Deno.test(`inferred values (stated: false) are capped at ${INFERRED_MAX_CONFIDENCE} and only suggested`, () => {
  const r = validateProposals(
    [p('police', 'came', 0.95, 'Police came', true), p('weather_road', ['clear'], 0.9, 'It was foggy', false)],
    'Police came. It was foggy.',
    catalog,
  );
  deepStrictEqual(fields(r.applied), ['police']);
  deepStrictEqual(r.suggested.map((x) => [x.field_key, x.confidence]), [['weather_road', INFERRED_MAX_CONFIDENCE]]);
  // A low inferred confidence is not raised.
  strictEqual(validateProposals([p('police', 'came', 0.3, 'Police came', false)], transcript, catalog).suggested[0].confidence, 0.3);
});

Deno.test('enum_list proposals for one field are merged; enum accepts a one-element array', () => {
  const r = validateProposals(
    [p('involved', ['another_vehicle'], 0.93, 'silver sedan'), p('involved', 'object', 0.85, 'cut in front'), p('police', ['came'], 0.9, 'Police came')],
    transcript,
    catalog,
  );
  const involved = r.applied.find((x) => x.field_key === 'involved');
  deepStrictEqual(involved?.value, ['another_vehicle', 'object']);
  strictEqual(involved?.confidence, 0.85);
  strictEqual(involved?.evidence_quote, 'silver sedan … cut in front');
  strictEqual(r.applied.find((x) => x.field_key === 'police')?.value, 'came');
});

const story =
  'A silver sedan cut in front of me and my trailer clipped the fence of the gas station. Police came. Front bumper is bent.';

Deno.test("joined quotes ' … ' are accepted when every part is in the transcript", () => {
  const r = validateProposals(
    [
      p('other_vehicle', 'silver sedan', 0.9, 'silver sedan … cut in front of me'),
      p('witnesses', 'police', 0.9, 'Police came...Front bumper'),
      p('property_owner', 'gas station', 0.9, 'gas station … the owner was Jen'),
    ],
    story,
    catalog,
  );
  deepStrictEqual(fields(r.applied), ['other_vehicle', 'witnesses']);
  deepStrictEqual(r.rejected.map((x) => [x.key, x.reason]), [['auto.property_owner', 'quote_not_in_transcript']]);
});

Deno.test('a separator-only quote is rejected', () => {
  strictEqual(validateProposals([p('police', 'came', 0.9, ' … ')], story, catalog).rejected[0].reason, 'quote_not_in_transcript');
});

Deno.test('text value with more than 2x the words of its quote is only suggested', () => {
  const r = validateProposals(
    [
      p('property_damaged', 'fence of the gas station and bumper', 0.95, 'clipped the fence'),
      p('other_vehicle', 'a silver sedan that cut in', 0.95, 'A silver sedan'),
    ],
    story,
    catalog,
  );
  deepStrictEqual(fields(r.applied), ['other_vehicle']);
  deepStrictEqual(r.suggested.map((x) => [x.field_key, x.value]), [['property_damaged', 'fence of the gas station and bumper']]);
});

Deno.test('joined quote counts the words of all parts', () => {
  const r = validateProposals([p('property_damaged', 'fence of the gas station', 0.95, 'clipped the fence … gas station')], story, catalog);
  deepStrictEqual(fields(r.applied), ['property_damaged']);
});

Deno.test('narrative questions and enums are exempt from the length check', () => {
  const r = validateProposals(
    [p('what_happened', story, 0.95, 'A silver sedan'), p('involved', ['another_vehicle', 'object'], 0.95, 'sedan … fence')],
    story,
    catalog,
  );
  deepStrictEqual(fields(r.applied), ['what_happened', 'involved']);
});

Deno.test('suggested drops enum fields already applied and list values already applied', () => {
  const r = validateProposals(
    [
      p('police', 'came', 0.9, 'Police came'),
      p('police', 'on_the_way', 0.5, 'Police came'),
      p('involved', ['another_vehicle'], 0.9, 'silver sedan'),
      p('involved', ['another_vehicle', 'object'], 0.5, 'sedan'),
    ],
    transcript,
    catalog,
  );
  deepStrictEqual(r.suggested, [{ form_key: 'auto', field_key: 'involved', value: ['object'], confidence: 0.5, evidence_quote: 'sedan' }]);
});

// --- runtime catalog from form definitions -------------------------------------------------------------
const formCatalog = buildFormCatalog(
  [{ form_key: 'auto', form_version: 1 }],
  [
    {
      form_key: 'auto',
      version: 1,
      definition: {
        fields: [
          { key: 'what_happened', type: 'long_text', required: true },
          { key: 'police', type: 'boolean', required: true },
          { key: 'plate', type: 'text', validation: { maxLength: 8 } },
          { key: 'weather', type: 'multi_enum', options: [{ value: 'rain', label: 'Rain' }, { value: 'fog', label: 'Fog' }] },
        ],
      },
    },
  ],
).catalog;

Deno.test('boolean fields: "true"/"false" (or JSON booleans) become real booleans; anything else is rejected', () => {
  const r = validateProposals(
    [
      { key: 'auto.police', value: 'true', confidence: 0.95, evidence_quote: 'Police came' },
      { key: 'auto.police', value: 'yes', confidence: 0.95, evidence_quote: 'Police came' },
    ],
    transcript,
    formCatalog,
  );
  deepStrictEqual(r.applied, [{ form_key: 'auto', field_key: 'police', value: true, confidence: 0.95, evidence_quote: 'Police came' }]);
  deepStrictEqual(r.rejected.map((x) => x.reason), ['invalid_value']);
  const json = validateProposals([{ key: 'auto.police', value: false, confidence: 0.9, evidence_quote: 'Police came' }], transcript, formCatalog);
  strictEqual(json.applied[0].value, false);
});

Deno.test('text maxLength from the field validation is enforced', () => {
  const t = 'The plate was TX8KLM221 and also ABC123.';
  const r = validateProposals(
    [
      { key: 'auto.plate', value: 'TX8KLM221', confidence: 0.95, evidence_quote: 'TX8KLM221' },
      { key: 'auto.plate', value: 'ABC123', confidence: 0.9, evidence_quote: 'ABC123' },
    ],
    t,
    formCatalog,
  );
  deepStrictEqual(r.rejected.map((x) => x.reason), ['invalid_value']);
  deepStrictEqual(r.applied.map((x) => x.value), ['ABC123']);
});

Deno.test('multi_enum values must be option values', () => {
  const r = validateProposals(
    [
      { key: 'auto.weather', value: ['fog'], confidence: 0.9, evidence_quote: 'foggy' },
      { key: 'auto.weather', value: ['Fog'], confidence: 0.9, evidence_quote: 'foggy' },
    ],
    transcript,
    formCatalog,
  );
  deepStrictEqual(r.applied.map((x) => x.value), [['fog']]);
  deepStrictEqual(r.rejected.map((x) => x.reason), ['invalid_value']);
});
