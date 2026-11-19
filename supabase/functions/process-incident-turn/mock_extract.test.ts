// Run: deno test supabase/functions/process-incident-turn/   (or: node scripts/test-voice.mjs)
import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { stubCatalogFor, type CatalogEntry } from './catalog.ts';
import { buildFormCatalog } from './form_catalog.ts';
import { MockExtract, MockStt, SCENARIO_A_TEXT, SCENARIO_B_TEXT, SCENARIO_C_TEXT } from './providers.ts';
import { validateProposals } from './validate.ts';

const stub = stubCatalogFor('auto');

// The seeded placeholder `auto` form (supabase/seed.sql).
const seededAuto = buildFormCatalog(
  [{ form_key: 'auto', form_version: 1 }],
  [
    {
      form_key: 'auto',
      version: 1,
      definition: {
        fields: [
          { key: 'what_happened', type: 'long_text', required: true, question: 'What happened?' },
          { key: 'property_damaged', type: 'boolean', required: true },
          { key: 'delivery_work', type: 'boolean', required: true },
          { key: 'injuries', type: 'boolean', required: true },
          { key: 'other_vehicle', type: 'boolean', required: true },
          { key: 'police', type: 'boolean', required: true },
        ],
      },
    },
  ],
).catalog;

async function run(transcript: string, catalog: CatalogEntry[], questionKey = 'auto.what_happened') {
  const raw = await new MockExtract().extract({ transcript, questionKey, catalog });
  const result = validateProposals(raw, transcript, catalog);
  const values = Object.fromEntries(result.applied.map((p) => [p.field_key, p.value]));
  return { raw, result, values };
}

Deno.test('every mock proposal passes validation (quotes are exact substrings), on both catalogs', async () => {
  for (const catalog of [stub, seededAuto]) {
    for (const text of [SCENARIO_A_TEXT, SCENARIO_B_TEXT, SCENARIO_C_TEXT]) {
      const { result } = await run(text, catalog);
      deepStrictEqual(result.rejected, []);
      strictEqual(result.suggested.length, 0);
    }
  }
});

Deno.test('seeded auto form, Scenario B: story + other vehicle + property + police + nobody hurt', async () => {
  const { values, result } = await run(SCENARIO_B_TEXT, seededAuto);
  deepStrictEqual(values, {
    what_happened: SCENARIO_B_TEXT,
    other_vehicle: true,
    property_damaged: true,
    injuries: false,
    police: true,
  });
  strictEqual(result.applied.every((p) => p.form_key === 'auto'), true);
});

Deno.test('seeded auto form, Scenario A: property damage, no injury, no police', async () => {
  const { values } = await run(SCENARIO_A_TEXT, seededAuto);
  deepStrictEqual(values, { what_happened: SCENARIO_A_TEXT, property_damaged: true, injuries: false, police: false });
});

Deno.test('seeded auto form, Scenario C: delivery work, driver hurt, no other vehicle', async () => {
  const { values } = await run(SCENARIO_C_TEXT, seededAuto);
  deepStrictEqual(values, { what_happened: SCENARIO_C_TEXT, delivery_work: true, injuries: true, other_vehicle: false });
});

Deno.test('stub catalog, Scenario B: sedan + fence, police came, nobody hurt, front bumper', async () => {
  const { values } = await run(SCENARIO_B_TEXT, stub);
  deepStrictEqual(Object.keys(values).sort(), ['injuries', 'involved', 'police', 'truck_damage', 'what_happened']);
  deepStrictEqual(values.involved, ['another_vehicle', 'object']);
  strictEqual(values.police, 'came');
  strictEqual(values.injuries, 'no_one');
  deepStrictEqual(values.truck_damage, ['front_bumper']);
});

Deno.test('stub catalog, Scenario A: bollard while reversing in our yard, no injury, no police', async () => {
  const { values } = await run(SCENARIO_A_TEXT, stub);
  deepStrictEqual(values.involved, ['object']);
  strictEqual(values.place_type, 'our_yard');
  deepStrictEqual(values.truck_damage, ['rear']);
  strictEqual(values.injuries, 'no_one');
  strictEqual(values.police, 'no_police');
});

Deno.test('stub catalog, Scenario C: pallet on foot at customer dock, just my truck, driver hurt', async () => {
  const { values } = await run(SCENARIO_C_TEXT, stub);
  deepStrictEqual(values.involved, ['just_my_truck']);
  strictEqual(values.injuries, 'me');
  strictEqual(values.place_type, 'customer_site');
  strictEqual(values.trip, 'dispatched_load');
  deepStrictEqual(values.truck_damage, ['no_damage']);
});

Deno.test('the story is only proposed when it is the current question (bare or composite key)', async () => {
  deepStrictEqual(Object.keys((await run('Police came.', seededAuto, 'auto.police')).values), ['police']);
  deepStrictEqual(Object.keys((await run('Police came.', seededAuto, 'what_happened')).values).sort(), ['police', 'what_happened']);
});

Deno.test('weather, tow and evidence quote keep the transcript casing', async () => {
  const text = 'It was Foggy and raining, the truck had to be towed.';
  const { result, values } = await run(text, stub, 'auto.weather_road');
  deepStrictEqual(values.weather_road, ['rain', 'fog']);
  strictEqual(values.drivable, 'needs_tow');
  strictEqual(result.applied.find((p) => p.field_key === 'weather_road')?.evidence_quote, 'Foggy … raining');
});

Deno.test('MockStt returns MOCK_TRANSCRIPT or Scenario B', async () => {
  const audio = new Blob([]);
  strictEqual(await new MockStt(() => undefined).transcribe(audio, 'en'), SCENARIO_B_TEXT);
  strictEqual(await new MockStt((k) => (k === 'MOCK_TRANSCRIPT' ? 'hello' : undefined)).transcribe(audio, 'en'), 'hello');
});
