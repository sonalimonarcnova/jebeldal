// Run: deno test supabase/functions/process-incident-turn/   (or: node scripts/test-voice.mjs)
import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { buildFormCatalog, findQuestion } from './form_catalog.ts';

const defs = [
  {
    form_key: 'auto',
    version: 1,
    definition: {
      sections: [
        {
          key: 'scene',
          type: 'section',
          fields: [
            { key: 'what_happened', type: 'long_text', required: true, question: 'What happened?' },
            { key: 'police', type: 'boolean', required: true, label: 'Did the police come?' },
            { key: 'weather', type: 'multi_enum', options: [{ value: 'rain', label: 'Rain' }, { value: 'fog' }] },
            { key: 'place', type: 'enum', options: ['yard', 'road'] },
            { key: 'speed_mph', type: 'number' },
            { key: 'witness', type: 'repeated_group', fields: [{ key: 'witness_name', type: 'text' }] },
          ],
        },
      ],
    },
  },
  { form_key: 'auto', version: 2, definition: { fields: [{ key: 'v2_only', type: 'text' }] } },
  { form_key: 'general_liability', version: 1, definition: { fields: [] } },
];

Deno.test('fields come from the triggered form version, walking sections, with composite keys', () => {
  const { catalog } = buildFormCatalog([{ form_key: 'auto', form_version: 1 }], defs);
  deepStrictEqual(catalog.map((e) => e.key), ['auto.what_happened', 'auto.police', 'auto.weather', 'auto.place']);
  ok(catalog.every((e) => e.formKey === 'auto'));
});

Deno.test('type mapping: boolean → enum [true,false]; enum / multi_enum → option values; long_text → text', () => {
  const { catalog } = buildFormCatalog([{ form_key: 'auto', form_version: 1 }], defs);
  const by = Object.fromEntries(catalog.map((e) => [e.fieldKey, e]));
  deepStrictEqual([by.police.extractType, by.police.valueKind, by.police.options], ['enum', 'boolean', ['true', 'false']]);
  strictEqual(by.police.prompt, 'Did the police come?');
  strictEqual(by.police.required, true);
  deepStrictEqual([by.weather.extractType, by.weather.options], ['enum_list', ['rain', 'fog']]);
  ok(by.weather.description.includes('rain = Rain'));
  deepStrictEqual([by.place.extractType, by.place.options], ['enum', ['yard', 'road']]);
  deepStrictEqual([by.what_happened.extractType, by.what_happened.narrative], ['text', true]);
});

Deno.test('unsupported types and repeated groups (with their children) are skipped and reported', () => {
  const { skipped } = buildFormCatalog([{ form_key: 'auto', form_version: 1 }], defs);
  deepStrictEqual(skipped, [
    { form_key: 'auto', field_key: 'witness', type: 'repeated_group' },
    { form_key: 'auto', field_key: 'speed_mph', type: 'number' },
  ]);
});

Deno.test('a triggered form with no usable fields falls back to the stub catalog under that form key', () => {
  const r = buildFormCatalog(
    [
      { form_key: 'auto', form_version: 1 },
      { form_key: 'general_liability', form_version: 1 },
    ],
    defs,
  );
  deepStrictEqual(r.fallbackForms, ['general_liability']);
  ok(r.catalog.some((e) => e.key === 'general_liability.what_happened'));
  ok(r.catalog.some((e) => e.key === 'auto.police'));
});

Deno.test('a triggered form with no definition row also falls back', () => {
  strictEqual(buildFormCatalog([{ form_key: 'workers_comp', form_version: 1 }], defs).fallbackForms[0], 'workers_comp');
});

Deno.test('findQuestion accepts "form.field" or a bare field key (auto preferred)', () => {
  const { catalog } = buildFormCatalog(
    [
      { form_key: 'general_liability', form_version: 1 },
      { form_key: 'auto', form_version: 1 },
    ],
    defs,
  );
  strictEqual(findQuestion(catalog, 'auto.police')?.key, 'auto.police');
  strictEqual(findQuestion(catalog, 'what_happened')?.key, 'auto.what_happened');
  strictEqual(findQuestion(catalog, 'nope'), undefined);
});
