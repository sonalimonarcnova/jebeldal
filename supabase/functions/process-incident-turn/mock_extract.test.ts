// Run: deno test supabase/functions/process-incident-turn/   (or: node scripts/test-voice.mjs)
import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { getCatalog } from './catalog.ts';
import {
  MockExtract,
  MockStt,
  SCENARIO_A_TEXT,
  SCENARIO_B_TEXT,
  SCENARIO_C_TEXT,
} from './providers.ts';
import { validateProposals } from './validate.ts';

const catalog = getCatalog();

async function run(transcript: string, questionKey = 'what_happened') {
  const raw = await new MockExtract().extract({ transcript, questionKey, catalog });
  const result = validateProposals(raw, transcript, catalog);
  const values = Object.fromEntries(result.applied.map((p) => [p.key, p.value]));
  return { raw, result, values };
}

Deno.test('every mock proposal passes validation (quotes are exact substrings)', async () => {
  for (const text of [SCENARIO_A_TEXT, SCENARIO_B_TEXT, SCENARIO_C_TEXT]) {
    const { result } = await run(text);
    deepStrictEqual(result.rejected, []);
    strictEqual(result.suggested.length, 0);
  }
});

Deno.test('Scenario B: sedan + fence, police came, nobody hurt, front bumper', async () => {
  const { values } = await run(SCENARIO_B_TEXT);
  deepStrictEqual(Object.keys(values).sort(), ['injuries', 'involved', 'police', 'truck_damage', 'what_happened']);
  deepStrictEqual(values.involved, ['another_vehicle', 'object']);
  strictEqual(values.police, 'came');
  strictEqual(values.injuries, 'no_one');
  deepStrictEqual(values.truck_damage, ['front_bumper']);
  strictEqual(values.what_happened, SCENARIO_B_TEXT);
});

Deno.test('Scenario A: bollard while reversing in our yard, no injury, no police', async () => {
  const { values } = await run(SCENARIO_A_TEXT);
  deepStrictEqual(values.involved, ['object']);
  strictEqual(values.place_type, 'our_yard');
  deepStrictEqual(values.truck_damage, ['rear']);
  strictEqual(values.injuries, 'no_one');
  strictEqual(values.police, 'no_police');
});

Deno.test('Scenario C: pallet on foot at customer dock, just my truck, driver hurt', async () => {
  const { values } = await run(SCENARIO_C_TEXT);
  deepStrictEqual(values.involved, ['just_my_truck']);
  strictEqual(values.injuries, 'me');
  strictEqual(values.place_type, 'customer_site');
  strictEqual(values.trip, 'dispatched_load');
  deepStrictEqual(values.truck_damage, ['no_damage']);
});

Deno.test('what_happened is only proposed when it is the current question', async () => {
  const { values } = await run('Police came.', 'police');
  deepStrictEqual(Object.keys(values), ['police']);
});

Deno.test('weather, tow and evidence quote keep the transcript casing', async () => {
  const text = 'It was Foggy and raining, the truck had to be towed.';
  const { result, values } = await run(text, 'weather_road');
  deepStrictEqual(values.weather_road, ['rain', 'fog']);
  strictEqual(values.drivable, 'needs_tow');
  strictEqual(result.applied.find((p) => p.key === 'weather_road')?.evidence_quote, 'Foggy … raining');
});

Deno.test('MockStt returns MOCK_TRANSCRIPT or Scenario B', async () => {
  const audio = new Blob([]);
  strictEqual(await new MockStt(() => undefined).transcribe(audio, 'en'), SCENARIO_B_TEXT);
  strictEqual(await new MockStt((k) => (k === 'MOCK_TRANSCRIPT' ? 'hello' : undefined)).transcribe(audio, 'en'), 'hello');
});
