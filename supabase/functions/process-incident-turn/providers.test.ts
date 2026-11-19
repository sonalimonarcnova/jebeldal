// Run: deno test supabase/functions/process-incident-turn/   (or: node scripts/test-voice.mjs)
import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { getCatalog } from './catalog.ts';
import {
  buildExtractionInstructions,
  DEFAULT_GROQ_EXTRACT_MODEL,
  DEFAULT_XAI_EXTRACT_MODEL,
  GroqExtract,
  GroqStt,
  MockExtract,
  MockStt,
  OpenAiExtract,
  selectProviders,
  XAI_STT_MODEL,
  XaiExtract,
  XaiStt,
} from './providers.ts';

const envOf = (vars: Record<string, string>) => (name: string) => vars[name];

function configError(vars: Record<string, string>): string {
  try {
    selectProviders(envOf(vars));
  } catch (error) {
    return (error as { code?: string }).code ?? 'unknown';
  }
  return 'no error';
}

Deno.test('mock is the default (unset, empty, unknown or explicit mock)', () => {
  for (const vars of [{}, { PROVIDER_MODE: '' }, { PROVIDER_MODE: 'banana' }, { PROVIDER_MODE: 'mock', GROQ_API_KEY: 'k' }]) {
    const p = selectProviders(envOf(vars));
    strictEqual(p.mode, 'mock');
    ok(p.stt instanceof MockStt);
    ok(p.extract instanceof MockExtract);
  }
});

Deno.test('groq: Groq STT + Groq extraction with only GROQ_API_KEY', () => {
  const p = selectProviders(envOf({ PROVIDER_MODE: 'groq', GROQ_API_KEY: 'k' }));
  strictEqual(p.mode, 'groq');
  ok(p.stt instanceof GroqStt);
  ok(p.extract instanceof GroqExtract);
});

Deno.test('groq: mode value is case/whitespace tolerant', () => {
  strictEqual(selectProviders(envOf({ PROVIDER_MODE: ' Groq ', GROQ_API_KEY: 'k' })).mode, 'groq');
});

Deno.test('groq: missing GROQ_API_KEY is config_missing (OpenAI keys do not help)', () => {
  strictEqual(configError({ PROVIDER_MODE: 'groq' }), 'config_missing');
  strictEqual(configError({ PROVIDER_MODE: 'groq', OPENAI_API_KEY: 'o', OPENAI_MODEL: 'm' }), 'config_missing');
});

Deno.test('xai: xAI STT + xAI extraction with only XAI_API_KEY; default and override model', () => {
  const p = selectProviders(envOf({ PROVIDER_MODE: 'xai', XAI_API_KEY: 'xai-k' }));
  strictEqual(p.mode, 'xai');
  ok(p.stt instanceof XaiStt);
  ok(p.extract instanceof XaiExtract);
  strictEqual(selectProviders(envOf({ PROVIDER_MODE: 'XAI ', XAI_API_KEY: 'xai-k' })).mode, 'xai');
});

Deno.test('xai: missing or blank XAI_API_KEY is config_missing (a Groq key does not help)', () => {
  strictEqual(configError({ PROVIDER_MODE: 'xai' }), 'config_missing');
  strictEqual(configError({ PROVIDER_MODE: 'xai', XAI_API_KEY: '   ' }), 'config_missing');
  strictEqual(configError({ PROVIDER_MODE: 'xai', GROQ_API_KEY: 'gsk_k' }), 'config_missing');
});

Deno.test('live: Groq STT + OpenAI extraction; needs all three variables', () => {
  const p = selectProviders(envOf({ PROVIDER_MODE: 'live', GROQ_API_KEY: 'k', OPENAI_API_KEY: 'o', OPENAI_MODEL: 'm' }));
  strictEqual(p.mode, 'live');
  ok(p.stt instanceof GroqStt);
  ok(p.extract instanceof OpenAiExtract);
  strictEqual(configError({ PROVIDER_MODE: 'live' }), 'config_missing');
  strictEqual(configError({ PROVIDER_MODE: 'live', GROQ_API_KEY: 'k' }), 'config_missing');
  strictEqual(configError({ PROVIDER_MODE: 'live', GROQ_API_KEY: 'k', OPENAI_API_KEY: 'o' }), 'config_missing');
});

// ---------------------------------------------------------------------------
// GroqExtract request/response handling, with fetch stubbed (no network).
// ---------------------------------------------------------------------------
type Captured = { url: string; body: Record<string, unknown> };

async function withFetch(responses: Array<{ status: number; body: unknown }>, fn: (calls: Captured[]) => Promise<void>) {
  const original = globalThis.fetch;
  const calls: Captured[] = [];
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) });
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    return Promise.resolve(new Response(JSON.stringify(next.body), { status: next.status }));
  }) as typeof fetch;
  try {
    await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}

const proposals = { proposals: [{ key: 'police', value: 'came', confidence: 0.95, evidence_quote: 'Police came' }] };
const chat = (content: string) => ({ choices: [{ message: { role: 'assistant', content } }] });
const input = { transcript: 'Police came.', questionKey: 'police', catalog: getCatalog() };

Deno.test('GroqExtract: strict json_schema request, temperature 0, default model', async () => {
  await withFetch([{ status: 200, body: chat(JSON.stringify(proposals)) }], async (calls) => {
    const out = await new GroqExtract('k').extract(input);
    deepStrictEqual(out, proposals.proposals);
    strictEqual(calls.length, 1);
    strictEqual(calls[0].url, 'https://api.groq.com/openai/v1/chat/completions');
    strictEqual(calls[0].body.model, DEFAULT_GROQ_EXTRACT_MODEL);
    strictEqual(calls[0].body.temperature, 0);
    const format = calls[0].body.response_format as { type: string; json_schema: { name: string; strict: boolean } };
    strictEqual(format.type, 'json_schema');
    strictEqual(format.json_schema.name, 'proposals');
    strictEqual(format.json_schema.strict, true);
  });
});

Deno.test('GroqExtract: HTTP 400 on json_schema falls back to json_object with the schema in the prompt', async () => {
  await withFetch(
    [
      { status: 400, body: { error: { message: 'response_format json_schema not supported' } } },
      { status: 200, body: chat(JSON.stringify(proposals)) },
    ],
    async (calls) => {
      const extractor = new GroqExtract('k', 'some/model');
      deepStrictEqual(await extractor.extract(input), proposals.proposals);
      strictEqual(calls.length, 2);
      strictEqual((calls[1].body.response_format as { type: string }).type, 'json_object');
      const system = (calls[1].body.messages as Array<{ role: string; content: string }>)[0].content;
      ok(system.includes('JSON Schema'));
      // The fallback is remembered: the next turn goes straight to json_object.
      await extractor.extract(input);
      strictEqual(calls.length, 3);
      strictEqual((calls[2].body.response_format as { type: string }).type, 'json_object');
    },
  );
});

Deno.test('GroqExtract: reasoning_effort "low" only for gpt-oss models', async () => {
  await withFetch([{ status: 200, body: chat(JSON.stringify(proposals)) }], async (calls) => {
    await new GroqExtract('k').extract(input);
    await new GroqExtract('k', 'openai/gpt-oss-20b').extract(input);
    await new GroqExtract('k', 'qwen/qwen3.8-27b').extract(input);
    deepStrictEqual(calls.map((c) => c.body.reasoning_effort), ['low', 'low', undefined]);
  });
});

Deno.test('GroqExtract: 400 with reasoning_effort retries without it and keeps json_schema; then json_object', async () => {
  await withFetch(
    [
      { status: 400, body: {} },
      { status: 200, body: chat(JSON.stringify(proposals)) },
    ],
    async (calls) => {
      const extractor = new GroqExtract('k');
      deepStrictEqual(await extractor.extract(input), proposals.proposals);
      deepStrictEqual(
        calls.map((c) => [c.body.reasoning_effort, (c.body.response_format as { type: string }).type]),
        [['low', 'json_schema'], [undefined, 'json_schema']],
      );
    },
  );
  await withFetch(
    [
      { status: 400, body: {} },
      { status: 400, body: {} },
      { status: 200, body: chat(JSON.stringify(proposals)) },
    ],
    async (calls) => {
      deepStrictEqual(await new GroqExtract('k').extract(input), proposals.proposals);
      deepStrictEqual(
        calls.map((c) => [c.body.reasoning_effort, (c.body.response_format as { type: string }).type]),
        [['low', 'json_schema'], [undefined, 'json_schema'], [undefined, 'json_object']],
      );
    },
  );
  await withFetch([{ status: 400, body: {} }], async (calls) => {
    const error = await new GroqExtract('k').extract(input).catch((e) => e);
    strictEqual(error.code, 'llm_http_400');
    strictEqual(calls.length, 3); // gives up after the json_object attempt
  });
});

Deno.test('provider errors keep only identifier-like error.type / error.code, never the message', async () => {
  await withFetch(
    [{ status: 400, body: { error: { message: 'secret-ish provider text', type: 'invalid_request_error', code: 'has spaces!' } } }],
    async () => {
      const error = await new GroqExtract('k', 'some/model').extract(input).catch((e) => e);
      strictEqual(error.code, 'llm_http_400');
      deepStrictEqual(error.info, { status: 400, type: 'invalid_request_error', code: undefined });
      strictEqual(JSON.stringify(error.info).includes('secret-ish'), false);
    },
  );
});

Deno.test('GroqStt sends the given filename, model, language and response_format', async () => {
  const original = globalThis.fetch;
  let form: FormData | null = null;
  globalThis.fetch = ((_url: string, init?: RequestInit) => {
    form = init?.body as FormData;
    return Promise.resolve(new Response(JSON.stringify({ text: ' hello ' }), { status: 200 }));
  }) as typeof fetch;
  try {
    const text = await new GroqStt('k').transcribe(new Blob([new Uint8Array(4)], { type: 'audio/mp4' }), 'en', 'audio.m4a');
    strictEqual(text, 'hello');
    const sent = form as unknown as FormData;
    strictEqual((sent.get('file') as File).name, 'audio.m4a');
    strictEqual((sent.get('file') as File).type, 'audio/mp4');
    strictEqual(sent.get('model'), 'whisper-large-v3-turbo');
    strictEqual(sent.get('language'), 'en');
    strictEqual(sent.get('response_format'), 'json');
  } finally {
    globalThis.fetch = original;
  }
});

type SentRequest = { url: string; headers: Headers; body: BodyInit | null | undefined };

async function captureOne(responseBody: unknown, status: number, fn: () => Promise<unknown>): Promise<{ sent: SentRequest; result: unknown }> {
  const original = globalThis.fetch;
  let sent: SentRequest | null = null;
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    sent = { url: String(url), headers: new Headers(init?.headers), body: init?.body };
    return Promise.resolve(new Response(JSON.stringify(responseBody), { status }));
  }) as typeof fetch;
  try {
    const result = await fn().catch((e) => e);
    return { sent: sent as unknown as SentRequest, result };
  } finally {
    globalThis.fetch = original;
  }
}

Deno.test('XaiStt: POST /v1/stt, bearer auth, option fields before file, file last with filename + type', async () => {
  const audio = new Blob([new Uint8Array(8)], { type: 'audio/mp4' });
  const { sent, result } = await captureOne({ text: ' Police came. ', language: 'en', duration: 1.2 }, 200, () =>
    new XaiStt('xai-k').transcribe(audio, 'en', 'audio.m4a'),
  );
  strictEqual(result, 'Police came.');
  strictEqual(sent.url, 'https://api.x.ai/v1/stt');
  strictEqual(sent.headers.get('authorization'), 'Bearer xai-k');
  const form = sent.body as FormData;
  deepStrictEqual([...form.keys()], ['model', 'language', 'format', 'file']);
  strictEqual(form.get('model'), XAI_STT_MODEL);
  strictEqual(form.get('language'), 'en');
  strictEqual(form.get('format'), 'true');
  strictEqual((form.get('file') as File).name, 'audio.m4a');
  strictEqual((form.get('file') as File).type, 'audio/mp4');
});

Deno.test('XaiStt: format=true only for languages that support it', async () => {
  const audio = new Blob([new Uint8Array(8)], { type: 'audio/mp4' });
  const { sent } = await captureOne({ text: 'hola' }, 200, () => new XaiStt('xai-k').transcribe(audio, 'hi', 'audio.m4a'));
  deepStrictEqual([...(sent.body as FormData).keys()], ['model', 'language', 'file']);
});

Deno.test('XaiStt: 401 / 429 / 503 map to safe codes; message text is never kept', async () => {
  const audio = new Blob([new Uint8Array(8)], { type: 'audio/mp4' });
  const cases: Array<[number, string, boolean]> = [
    [401, 'stt_http_401', false],
    [403, 'stt_http_403', false],
    [429, 'stt_http_429', true],
    [503, 'stt_http_503', true],
  ];
  for (const [status, code, retryable] of cases) {
    const { result } = await captureOne({ code: 'Incorrect API key provided', error: 'secret-ish detail' }, status, () =>
      new XaiStt('xai-k').transcribe(audio, 'en', 'audio.m4a'),
    );
    const error = result as { code: string; retryable: boolean; info: Record<string, unknown> };
    strictEqual(error.code, code);
    strictEqual(error.retryable, retryable);
    // A sentence-like "code" is not an identifier, so it is dropped too.
    deepStrictEqual(error.info, { status, type: undefined, code: undefined });
  }
});

Deno.test('XaiExtract: chat completions at api.x.ai, default model, strict json_schema, temperature 0, no reasoning_effort', async () => {
  const { sent, result } = await captureOne(chat(JSON.stringify(proposals)), 200, () => new XaiExtract('xai-k').extract(input));
  deepStrictEqual(result, proposals.proposals);
  strictEqual(sent.url, 'https://api.x.ai/v1/chat/completions');
  strictEqual(sent.headers.get('authorization'), 'Bearer xai-k');
  strictEqual(sent.headers.get('content-type'), 'application/json');
  const body = JSON.parse(String(sent.body));
  strictEqual(body.model, DEFAULT_XAI_EXTRACT_MODEL);
  strictEqual(body.temperature, 0);
  strictEqual(body.reasoning_effort, undefined);
  strictEqual(body.response_format.type, 'json_schema');
  strictEqual(body.response_format.json_schema.strict, true);
});

Deno.test('XaiExtract: json_schema rejected (400) falls back to json_object and remembers it', async () => {
  await withFetch(
    [
      { status: 400, body: { code: 'invalid_argument', error: 'response_format not supported' } },
      { status: 200, body: chat(JSON.stringify(proposals)) },
    ],
    async (calls) => {
      const extractor = new XaiExtract('xai-k', 'grok-x');
      deepStrictEqual(await extractor.extract(input), proposals.proposals);
      await extractor.extract(input);
      deepStrictEqual(
        calls.map((c) => [c.body.model, (c.body.response_format as { type: string }).type]),
        [['grok-x', 'json_schema'], ['grok-x', 'json_object'], ['grok-x', 'json_object']],
      );
    },
  );
});

Deno.test('extraction prompt carries the third-party property and evidence rules', () => {
  const prompt = buildExtractionInstructions('what_happened', getCatalog());
  ok(prompt.includes('fully supported by its evidence_quote'));
  ok(prompt.includes("joined with ' … '"));
  ok(prompt.includes("never the driver's own truck or trailer"));
  ok(/property_damaged: .*Never the driver's own truck or trailer/.test(prompt));
});

Deno.test('GroqExtract: non-JSON content is llm_bad_output; 5xx is retryable llm_http_503', async () => {
  await withFetch([{ status: 200, body: chat('not json') }], async () => {
    const error = await new GroqExtract('k').extract(input).catch((e) => e);
    strictEqual(error.code, 'llm_bad_output');
  });
  await withFetch([{ status: 503, body: {} }], async (calls) => {
    const error = await new GroqExtract('k').extract(input).catch((e) => e);
    strictEqual(error.code, 'llm_http_503');
    strictEqual(error.retryable, true);
    strictEqual(calls.length, 1); // only 400 triggers the json_object fallback
  });
});
