// Run: deno test supabase/functions/process-incident-turn/   (or: node scripts/test-voice.mjs)
import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { getCatalog } from './catalog.ts';
import { APPLY_THRESHOLD, validateProposals } from './validate.ts';

const catalog = getCatalog();
const transcript = 'A silver sedan cut in front of me. Police came. Nobody was hurt. It was foggy.';

const p = (key: string, value: string | string[], confidence: number, evidence_quote: string) => ({
  key,
  value,
  confidence,
  evidence_quote,
});

Deno.test('unknown key is rejected', () => {
  const r = validateProposals([p('favourite_colour', 'blue', 0.95, 'silver sedan')], transcript, catalog);
  strictEqual(r.applied.length, 0);
  deepStrictEqual(r.rejected.map((x) => [x.key, x.reason]), [['favourite_colour', 'unknown_key']]);
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
  deepStrictEqual(r.rejected.map((x) => [x.key, x.reason]), [['police', 'quote_not_in_transcript']]);
  deepStrictEqual(r.applied.map((x) => x.key), ['injuries']);
  strictEqual(r.applied[0].evidence_quote, 'NOBODY   was hurt');
});

Deno.test('empty quote is rejected', () => {
  const r = validateProposals([p('police', 'came', 0.95, '')], transcript, catalog);
  strictEqual(r.rejected[0].reason, 'quote_not_in_transcript');
});

Deno.test('confidence outside 0–1 or non-numeric is rejected', () => {
  const r = validateProposals(
    [p('police', 'came', 1.2, 'Police came'), p('police', 'came', -0.1, 'Police came'), { key: 'police', value: 'came', confidence: '0.9', evidence_quote: 'Police came' }],
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
    [
      p('police', 'came', 0.8, 'Police came'),
      p('injuries', 'no_one', 0.79, 'Nobody was hurt'),
      p('weather_road', ['fog'], 0.6, 'foggy'),
    ],
    transcript,
    catalog,
  );
  deepStrictEqual(r.applied.map((x) => x.key), ['police']);
  deepStrictEqual(r.suggested.map((x) => x.key), ['injuries', 'weather_road']);
});

Deno.test('enum_list proposals for one key are merged; enum accepts a one-element array', () => {
  const r = validateProposals(
    [
      p('involved', ['another_vehicle'], 0.93, 'silver sedan'),
      p('involved', 'object', 0.85, 'cut in front'),
      p('police', ['came'], 0.9, 'Police came'),
    ],
    transcript,
    catalog,
  );
  const involved = r.applied.find((x) => x.key === 'involved');
  deepStrictEqual(involved?.value, ['another_vehicle', 'object']);
  strictEqual(involved?.confidence, 0.85);
  strictEqual(involved?.evidence_quote, 'silver sedan … cut in front');
  deepStrictEqual(r.applied.find((x) => x.key === 'police')?.value, 'came');
});

Deno.test('suggested drops enum keys already applied and list values already applied', () => {
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
  deepStrictEqual(r.suggested, [p('involved', ['object'], 0.5, 'sedan')]);
});
