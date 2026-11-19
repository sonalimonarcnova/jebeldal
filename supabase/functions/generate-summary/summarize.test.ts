import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert/strict';
import {
  buildSummaryForm,
  mapSummaryError,
  summarize,
  validateDescriptions,
  type SummaryForm,
} from './summarize.ts';
import { DEFAULT_XAI_EXTRACT_MODEL, ProviderError } from '../process-incident-turn/providers.ts';

const form: SummaryForm = {
  form_key: 'auto',
  label: 'Automobile / Fleet Loss',
  answers: [
    { field_key: 'police', label: 'Police contacted?', value: 'Yes, they came' },
    { field_key: 'truck_damage', label: 'Truck damage', value: 'Front bumper' },
  ],
};

Deno.test('buildSummaryForm uses only confirmed answers', () => {
  const built = buildSummaryForm('auto', {
    label: 'Auto form',
    sections: [{
      fields: [
        { key: 'police', type: 'enum', label: 'Police contacted?' },
      ],
    }],
  }, [
    { form_key: 'auto', field_key: 'police', value: 'came', answer_state: 'confirmed' },
    { form_key: 'auto', field_key: 'police', value: 'no_police', answer_state: 'unknown' },
    { form_key: 'auto', field_key: 'police', value: 'came', answer_state: 'declined' },
    { form_key: 'auto', field_key: 'police', value: 'came', answer_state: 'skipped' },
  ]);
  strictEqual(built.label, 'Auto form');
  deepStrictEqual(built.answers, [
    { field_key: 'police', label: 'Police contacted?', value: 'came' },
  ]);
});

Deno.test('buildSummaryForm maps option values to readable labels', () => {
  const built = buildSummaryForm('auto', {
    label: 'Auto form',
    sections: [{
      fields: [
        {
          key: 'police',
          type: 'enum',
          label: 'Police contacted?',
          options: [{ value: 'came', label: 'Yes, they came' }],
        },
        {
          key: 'truck_damage',
          type: 'multi_enum',
          label: 'Truck damage',
          options: [
            { value: 'front_bumper', label: 'Front bumper' },
            { value: 'rear', label: 'Rear' },
          ],
        },
        { key: 'what_happened', type: 'long_text', label: 'Description of loss' },
      ],
    }],
  }, [
    { form_key: 'auto', field_key: 'police', value: 'came', answer_state: 'confirmed' },
    { form_key: 'auto', field_key: 'truck_damage', value: ['front_bumper', 'rear'], answer_state: 'confirmed' },
    { form_key: 'interview', field_key: 'what_happened', value: 'I backed into a barrier.', answer_state: 'confirmed' },
  ]);
  deepStrictEqual(built.answers, [
    { field_key: 'police', label: 'Police contacted?', value: 'Yes, they came' },
    { field_key: 'truck_damage', label: 'Truck damage', value: 'Front bumper, Rear' },
    { field_key: 'what_happened', label: 'Description of loss', value: 'I backed into a barrier.' },
  ]);
});

Deno.test('a triggered form can use confirmed answers captured under another active form', () => {
  const built = buildSummaryForm('general_liability', {
    label: 'General Liability',
    sections: [],
  }, [
    { form_key: 'auto', field_key: 'involved', value: ['object'], answer_state: 'confirmed' },
  ], [{
    form_key: 'auto',
    definition: {
      sections: [{
        fields: [{
          key: 'involved',
          type: 'multi_enum',
          label: 'What else was involved?',
          options: [{ value: 'object', label: 'A building, fence, or object' }],
        }],
      }],
    },
  }]);
  deepStrictEqual(built.answers, [{
    field_key: 'involved',
    label: 'What else was involved?',
    value: 'A building, fence, or object',
  }]);
});

Deno.test('mock summaries are deterministic and built from confirmed answers', async () => {
  const first = await summarize([form], 'mock');
  const second = await summarize([form], 'mock');
  deepStrictEqual(first, second);
  strictEqual(
    first.auto,
    'I reported Police contacted?: Yes, they came. I also reported Truck damage: Front bumper.',
  );
  ok(first.auto.length <= 600);
});

Deno.test('validateDescriptions drops unknown keys and rejects text over 600 characters', () => {
  deepStrictEqual(
    validateDescriptions({
      descriptions: { auto: ' I reported the confirmed details. ', unknown: 'discard me' },
    }, ['auto']),
    { auto: 'I reported the confirmed details.' },
  );
  throws(() => validateDescriptions({ descriptions: { auto: ' ' } }, ['auto']), ProviderError);
  strictEqual(validateDescriptions({ descriptions: { auto: 'x'.repeat(600) } }, ['auto']).auto.length, 600);
  throws(() => validateDescriptions({ descriptions: { auto: 'x'.repeat(601) } }, ['auto']), ProviderError);
  throws(() => validateDescriptions({ descriptions: { auto: '😀'.repeat(601) } }, ['auto']), ProviderError);
  throws(() => validateDescriptions({ descriptions: {} }, ['auto']), ProviderError);
});

Deno.test('provider errors map to the provider-unavailable error response', async () => {
  const response = mapSummaryError(new ProviderError('llm_http_503', true));
  ok(response);
  strictEqual(response.status, 503);
  deepStrictEqual(await response.json(), {
    code: 'PROVIDER_UNAVAILABLE',
    retryable: true,
    error_code: 'llm_http_503',
  });
  strictEqual(mapSummaryError(new Error('unexpected')), null);
});

Deno.test('xAI summary uses the configured model, temperature zero, and strict JSON output', async () => {
  const originalFetch = globalThis.fetch;
  let url = '';
  let requestHeaders: Headers | undefined;
  let requestBody: Record<string, unknown> | undefined;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    url = String(input);
    requestHeaders = new Headers(init?.headers);
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Promise.resolve(new Response(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: JSON.stringify({ descriptions: { auto: 'I reported the confirmed details.' } }) } }],
    })));
  }) as typeof fetch;
  try {
    const result = await summarize([form], 'xai', { apiKey: 'test-key', model: 'test-model' });
    deepStrictEqual(result, { auto: 'I reported the confirmed details.' });
    strictEqual(url, 'https://api.x.ai/v1/chat/completions');
    strictEqual(requestHeaders?.get('Authorization'), 'Bearer test-key');
    strictEqual(requestBody?.model, 'test-model');
    strictEqual(requestBody?.temperature, 0);
    const responseFormat = requestBody?.response_format as {
      type: string;
      json_schema: { name: string; strict: boolean };
    };
    strictEqual(responseFormat.type, 'json_schema');
    strictEqual(responseFormat.json_schema.name, 'incident_summaries');
    strictEqual(responseFormat.json_schema.strict, true);
    await summarize([form], 'xai', { apiKey: 'test-key' });
    strictEqual(requestBody?.model, DEFAULT_XAI_EXTRACT_MODEL);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
