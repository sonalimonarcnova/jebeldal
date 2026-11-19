// Swappable speech-to-text and extraction providers.
// Live: Groq Whisper + OpenAI Responses API. Mock: deterministic, no network, no keys.
// No module-level Deno access so this file can also be imported by Node-based tests.
import type { CatalogEntry } from './catalog.ts';

export type RawProposal = {
  key: string;
  value: string | string[];
  confidence: number;
  evidence_quote: string;
};

export type ExtractInput = { transcript: string; questionKey: string; catalog: CatalogEntry[] };

export interface SttProvider {
  /** `filename` must carry a provider-supported extension (e.g. "audio.m4a"); derived from audio.type if omitted. */
  transcribe(audio: Blob, lang: string, filename?: string): Promise<string>;
}

export interface ExtractProvider {
  extract(input: ExtractInput): Promise<RawProposal[]>;
}

/** mock = no network · groq = Groq STT + Groq extraction · xai = xAI STT + xAI extraction · live = Groq STT + OpenAI extraction */
export type ProviderMode = 'mock' | 'groq' | 'xai' | 'live';
export type Providers = { mode: ProviderMode; stt: SttProvider; extract: ExtractProvider };

export const PROVIDER_TIMEOUT_MS = 20_000;

/** Provider-reported error identifiers (OpenAI-style `error.type` / `error.code`), only when they look like identifiers. */
export type ProviderErrorInfo = { status?: number; type?: string; code?: string };

/** Provider failure. `code` and `info` are safe to store and log: never provider messages, transcripts or keys. */
export class ProviderError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly info: ProviderErrorInfo;
  constructor(code: string, retryable: boolean, info: ProviderErrorInfo = {}) {
    super(code);
    this.name = 'ProviderError';
    this.code = code;
    this.retryable = retryable;
    this.info = info;
  }
}

const IDENTIFIER = /^[A-Za-z0-9_.-]{1,64}$/;
const safeIdentifier = (value: unknown) => (typeof value === 'string' && IDENTIFIER.test(value) ? value : undefined);

/** Reads only `error.type` / `error.code` from an error body; the human-readable message is discarded. */
async function errorInfo(response: Response): Promise<ProviderErrorInfo> {
  const body = (await response.json().catch(() => null)) as { error?: unknown; code?: unknown; type?: unknown } | null;
  // OpenAI/Groq: { error: { type, code, message } }. Others (e.g. xAI) may put code/type at the top level and a
  // message string in `error` — the string is never read.
  const nested = typeof body?.error === 'object' && body.error !== null ? (body.error as { type?: unknown; code?: unknown }) : null;
  return {
    status: response.status,
    type: safeIdentifier(nested?.type ?? body?.type),
    code: safeIdentifier(nested?.code ?? body?.code),
  };
}

type EnvReader = (name: string) => string | undefined;

type DenoLike = { env: { get(name: string): string | undefined } };
const readEnv: EnvReader = (name) =>
  (globalThis as unknown as { Deno?: DenoLike }).Deno?.env.get(name);

// ---------------------------------------------------------------------------
// Scenario texts (docs/sprint-plan.md). B is verbatim from task C1; A and C are written to match the
// scenario descriptions in task E1 and are used by the tests and as mock inputs.
// ---------------------------------------------------------------------------
export const SCENARIO_A_TEXT =
  'I was reversing into door 4 in our yard and the trailer backed into a yellow bollard. ' +
  'The rear bumper is dented. Nobody was hurt and there were no police.';

export const SCENARIO_B_TEXT =
  'A silver sedan cut in front of me from the right lane on I-35 north near exit 235 and braked hard. ' +
  "I couldn't stop, hit the back of it at low speed and my trailer clipped the fence of the gas station. " +
  'Police came. Nobody was hurt. Front bumper is bent.';

export const SCENARIO_C_TEXT =
  "I was unloading a delivery at the customer's dock when a pallet slid off the jack and hurt my foot. " +
  'It was just my truck, and the truck is fine.';

// ---------------------------------------------------------------------------
// HTTP helper with timeout and safe error codes
// ---------------------------------------------------------------------------
async function providerFetch(stage: 'stt' | 'llm', url: string, init: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') throw new ProviderError(`${stage}_timeout`, true);
    throw new ProviderError(`${stage}_network`, true);
  }
  if (!response.ok) {
    const info = await errorInfo(response);
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    throw new ProviderError(`${stage}_http_${response.status}`, retryable, info);
  }
  return response;
}

// ---------------------------------------------------------------------------
// Live providers
// ---------------------------------------------------------------------------
const AUDIO_EXTENSIONS: Record<string, string> = {
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
};

export class GroqStt implements SttProvider {
  private readonly apiKey: string;
  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async transcribe(audio: Blob, lang: string, filename?: string): Promise<string> {
    const name = filename ?? `audio.${AUDIO_EXTENSIONS[audio.type] ?? 'm4a'}`;
    const form = new FormData();
    form.append('file', audio, name);
    form.append('model', 'whisper-large-v3-turbo');
    form.append('language', lang);
    form.append('response_format', 'json');
    form.append('temperature', '0');

    const response = await providerFetch('stt', 'https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });
    const data: unknown = await response.json().catch(() => null);
    const text = (data as { text?: unknown } | null)?.text;
    if (typeof text !== 'string') throw new ProviderError('stt_bad_output', true);
    return text.trim();
  }
}

export const XAI_STT_MODEL = 'grok-voice-transcribe-2.0';
/** Languages for which xAI supports `format=true` (inverse text normalisation: "two thirty five" → "235"). */
const XAI_FORMAT_LANGUAGES = new Set(['ar', 'de', 'en', 'es', 'fr', 'ja', 'pt', 'ru', 'sv', 'vi', 'zh']);

/**
 * xAI speech-to-text (POST https://api.x.ai/v1/stt, multipart). Option fields go BEFORE `file`: the docs say
 * `file` must be the last field and fields after it may be ignored. Container formats (m4a/mp4/wav…) are
 * auto-detected, so `audio_format` / `sample_rate` are not sent.
 */
export class XaiStt implements SttProvider {
  private readonly apiKey: string;
  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async transcribe(audio: Blob, lang: string, filename?: string): Promise<string> {
    const name = filename ?? `audio.${AUDIO_EXTENSIONS[audio.type] ?? 'm4a'}`;
    const form = new FormData();
    form.append('model', XAI_STT_MODEL);
    form.append('language', lang);
    if (XAI_FORMAT_LANGUAGES.has(lang)) form.append('format', 'true'); // requires language
    form.append('file', audio, name); // must be last

    const response = await providerFetch('stt', 'https://api.x.ai/v1/stt', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });
    const data: unknown = await response.json().catch(() => null);
    const text = (data as { text?: unknown } | null)?.text;
    if (typeof text !== 'string') throw new ProviderError('stt_bad_output', true);
    return text.trim();
  }
}

function extractionSchema(catalog: CatalogEntry[]) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['proposals'],
    properties: {
      proposals: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['key', 'value', 'confidence', 'evidence_quote'],
          properties: {
            key: { type: 'string', enum: catalog.map((q) => q.key) },
            value: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
            confidence: { type: 'number' },
            evidence_quote: { type: 'string' },
          },
        },
      },
    },
  };
}

export function buildExtractionInstructions(questionKey: string, catalog: CatalogEntry[]): string {
  const questions = catalog
    .map((q) => {
      const allowed =
        q.extractType === 'text'
          ? 'free text (string)'
          : q.extractType === 'enum'
            ? `one of: ${q.options?.join(', ')} (string)`
            : `a list of: ${q.options?.join(', ')} (array of strings)`;
      return `- ${q.key}: "${q.prompt}" — ${q.description} Value: ${allowed}.`;
    })
    .join('\n');

  return [
    'You extract answers for a truck driver incident report from what the driver said.',
    `The current question is "${questionKey}" — answer it first if the transcript answers it.`,
    'Also extract any other question below that the transcript clearly answers.',
    'Rules:',
    '- Never guess or infer beyond what was said. If something is not stated, leave it out.',
    '- evidence_quote must be copied verbatim from the transcript (a short exact substring).',
    "- A value must be fully supported by its evidence_quote. If it needs two separate parts of the transcript, use those quotes joined with ' … '.",
    "- property_damaged and property_owner are ONLY third-party property (fences, buildings, poles, other people's goods) — never the driver's own truck or trailer. Damage to the driver's truck goes only to truck_damage.",
    '- For enum questions use only the allowed values; for list questions return an array of allowed values.',
    '- confidence is between 0 and 1: 0.9+ when stated explicitly, lower when implied.',
    '- Return an empty proposals array if nothing applies.',
    'Questions:',
    questions,
  ].join('\n');
}

export class OpenAiExtract implements ExtractProvider {
  private readonly apiKey: string;
  private readonly model: string;
  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async extract({ transcript, questionKey, catalog }: ExtractInput): Promise<RawProposal[]> {
    const response = await providerFetch('llm', 'https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        store: false,
        instructions: buildExtractionInstructions(questionKey, catalog),
        input: `Transcript:\n"""${transcript}"""`,
        text: {
          format: { type: 'json_schema', name: 'incident_proposals', strict: true, schema: extractionSchema(catalog) },
        },
      }),
    });

    const data: unknown = await response.json().catch(() => null);
    return parseProposalsJson(responseOutputText(data));
  }
}

export const DEFAULT_GROQ_EXTRACT_MODEL = 'openai/gpt-oss-120b';
/** Chosen by benchmark on 2026-11-19 (fastest Grok text model that honours strict json_schema). */
export const DEFAULT_XAI_EXTRACT_MODEL = 'grok-4.20-0309-non-reasoning';

type ChatResponseFormat =
  | { type: 'json_schema'; json_schema: { name: string; strict: true; schema: unknown } }
  | { type: 'json_object' };

/**
 * Extraction via an OpenAI-compatible Chat Completions endpoint (Groq, xAI). Same prompt builder and schema as
 * OpenAiExtract, so validateProposals and the response contract are identical across modes.
 * Optionally sends reasoning_effort "low" (latency). On HTTP 400 the request is degraded one step at a
 * time — first without reasoning_effort, then json_object with the schema spelled out in the system prompt —
 * and each downgrade is remembered for later calls.
 */
class ChatCompletionsExtract implements ExtractProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly endpoint: string;
  private readonly provider: string;
  private jsonSchemaSupported = true;
  private reasoningEffortSupported: boolean;
  constructor(opts: { apiKey: string; model: string; endpoint: string; provider: string; reasoningEffortLow: boolean }) {
    this.apiKey = opts.apiKey;
    this.model = opts.model;
    this.endpoint = opts.endpoint;
    this.provider = opts.provider;
    this.reasoningEffortSupported = opts.reasoningEffortLow;
  }

  async extract({ transcript, questionKey, catalog }: ExtractInput): Promise<RawProposal[]> {
    const instructions = buildExtractionInstructions(questionKey, catalog);
    const schema = extractionSchema(catalog);

    // At most three attempts: full request → without reasoning_effort → json_object.
    for (;;) {
      const useSchema = this.jsonSchemaSupported;
      const useReasoning = this.reasoningEffortSupported;
      const system = useSchema
        ? instructions
        : `${instructions}\nRespond with a single JSON object matching this JSON Schema:\n${JSON.stringify(schema)}`;
      const format: ChatResponseFormat = useSchema
        ? { type: 'json_schema', json_schema: { name: 'proposals', strict: true, schema } }
        : { type: 'json_object' };
      try {
        return await this.call(system, transcript, format, useReasoning);
      } catch (error) {
        if (!(error instanceof ProviderError) || error.code !== 'llm_http_400') throw error;
        if (useReasoning) {
          this.reasoningEffortSupported = false;
          this.logFallback('reasoning_effort');
        } else if (useSchema) {
          this.jsonSchemaSupported = false;
          this.logFallback('json_schema');
        } else {
          throw error;
        }
      }
    }
  }

  private logFallback(dropped: 'reasoning_effort' | 'json_schema') {
    console.log(
      JSON.stringify({ fn: 'process-incident-turn', event: 'extract_request_fallback', provider: this.provider, dropped, model: this.model }),
    );
  }

  private async call(
    system: string,
    transcript: string,
    responseFormat: ChatResponseFormat,
    reasoningLow: boolean,
  ): Promise<RawProposal[]> {
    const response = await providerFetch('llm', this.endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        ...(reasoningLow ? { reasoning_effort: 'low' } : {}),
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `Transcript:\n"""${transcript}"""` },
        ],
        response_format: responseFormat,
      }),
    });
    const data: unknown = await response.json().catch(() => null);
    return parseProposalsJson(chatContent(data));
  }
}

/** Groq chat completions; gpt-oss models get reasoning_effort "low". */
export class GroqExtract extends ChatCompletionsExtract {
  constructor(apiKey: string, model: string = DEFAULT_GROQ_EXTRACT_MODEL) {
    super({
      apiKey,
      model,
      endpoint: 'https://api.groq.com/openai/v1/chat/completions',
      provider: 'groq',
      reasoningEffortLow: model.startsWith('openai/gpt-oss'),
    });
  }
}

/** xAI (Grok) chat completions. No reasoning_effort: the default model is a non-reasoning variant. */
export class XaiExtract extends ChatCompletionsExtract {
  constructor(apiKey: string, model: string = DEFAULT_XAI_EXTRACT_MODEL) {
    super({ apiKey, model, endpoint: 'https://api.x.ai/v1/chat/completions', provider: 'xai', reasoningEffortLow: false });
  }
}

/** First choice's message content from a Chat Completions payload. */
function chatContent(data: unknown): string | null {
  const choices = (data as { choices?: unknown } | null)?.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const message = (choices[0] as { message?: { content?: unknown; refusal?: unknown } }).message;
  if (typeof message?.refusal === 'string' && message.refusal) throw new ProviderError('llm_refusal', false);
  return typeof message?.content === 'string' ? message.content : null;
}

/** Parses `{ "proposals": [...] }`; validation of each item happens later in validateProposals. */
function parseProposalsJson(text: string | null): RawProposal[] {
  if (text === null) throw new ProviderError('llm_bad_output', true);
  try {
    const parsed = JSON.parse(text) as { proposals?: unknown };
    return Array.isArray(parsed.proposals) ? (parsed.proposals as RawProposal[]) : [];
  } catch {
    throw new ProviderError('llm_bad_output', true);
  }
}

/** Pulls the first output_text from a Responses API payload (raw REST has no `output_text` shortcut). */
function responseOutputText(data: unknown): string | null {
  const output = (data as { output?: unknown } | null)?.output;
  if (!Array.isArray(output)) return null;
  for (const item of output) {
    const content = (item as { type?: string; content?: unknown }).content;
    if ((item as { type?: string }).type !== 'message' || !Array.isArray(content)) continue;
    for (const part of content) {
      const p = part as { type?: string; text?: unknown };
      if (p.type === 'refusal') throw new ProviderError('llm_refusal', false);
      if (p.type === 'output_text' && typeof p.text === 'string') return p.text;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Mock providers
// ---------------------------------------------------------------------------
export class MockStt implements SttProvider {
  private readonly env: EnvReader;
  constructor(env: EnvReader = readEnv) {
    this.env = env;
  }

  transcribe(_audio: Blob, _lang: string, _filename?: string): Promise<string> {
    return Promise.resolve(this.env('MOCK_TRANSCRIPT') || SCENARIO_B_TEXT);
  }
}

type MockRule = { key: string; value: string; pattern: RegExp };

// Deterministic keyword rules. Patterns are case-insensitive; the matched substring is the evidence quote.
export const MOCK_RULES: readonly MockRule[] = [
  { key: 'involved', value: 'another_vehicle', pattern: /\b(?:sedan|car|suv|pickup|minivan)\b/i },
  { key: 'involved', value: 'another_vehicle', pattern: /\btruck cut\b/i },
  { key: 'involved', value: 'object', pattern: /\b(?:fence|bollard|pole|wall|gate)\b/i },
  { key: 'involved', value: 'just_my_truck', pattern: /\bjust my truck\b/i },
  { key: 'trip', value: 'dispatched_load', pattern: /\b(?:dispatched|delivery)\b/i },
  { key: 'weather_road', value: 'fog', pattern: /\bfog(?:gy)?\b/i },
  { key: 'weather_road', value: 'rain', pattern: /\brain(?:ing|y)?\b/i },
  { key: 'weather_road', value: 'ice_snow', pattern: /\b(?:snow(?:ing|y)?|icy)\b/i },
  { key: 'weather_road', value: 'clear', pattern: /\bclear\b/i },
  { key: 'place_type', value: 'our_yard', pattern: /\bour yard\b/i },
  { key: 'place_type', value: 'customer_site', pattern: /\bcustomer'?s? (?:dock|site)\b/i },
  { key: 'injuries', value: 'no_one', pattern: /\b(?:nobody|no one|no-one)\s+(?:was\s+|got\s+)?(?:hurt|injured)\b/i },
  { key: 'injuries', value: 'me', pattern: /\b(?:hurt|injured) my\b/i },
  { key: 'truck_damage', value: 'front_bumper', pattern: /\bfront bumper\b/i },
  { key: 'truck_damage', value: 'rear', pattern: /\b(?:rear bumper|revers(?:ing|ed))\b/i },
  { key: 'truck_damage', value: 'no_damage', pattern: /\btruck is fine\b/i },
  { key: 'drivable', value: 'needs_tow', pattern: /\btow(?:ed|ing)?\b/i },
  { key: 'police', value: 'came', pattern: /\bpolice (?:came|showed up|arrived)\b/i },
  { key: 'police', value: 'no_police', pattern: /\bno police\b/i },
];

export const MOCK_CONFIDENCE = 0.9;

export class MockExtract implements ExtractProvider {
  extract({ transcript, questionKey, catalog }: ExtractInput): Promise<RawProposal[]> {
    const known = new Set(catalog.map((q) => q.key));
    const proposals: RawProposal[] = [];
    const seen = new Set<string>();

    if (questionKey === 'what_happened' && known.has('what_happened') && transcript.trim()) {
      proposals.push({
        key: 'what_happened',
        value: transcript.trim(),
        confidence: MOCK_CONFIDENCE,
        evidence_quote: transcript.trim(),
      });
    }

    for (const rule of MOCK_RULES) {
      const id = `${rule.key}:${rule.value}`;
      if (!known.has(rule.key) || seen.has(id)) continue;
      const match = rule.pattern.exec(transcript);
      if (!match) continue;
      seen.add(id);
      const entry = catalog.find((q) => q.key === rule.key);
      proposals.push({
        key: rule.key,
        value: entry?.extractType === 'enum_list' ? [rule.value] : rule.value,
        confidence: MOCK_CONFIDENCE,
        evidence_quote: transcript.slice(match.index, match.index + match[0].length),
      });
    }
    return Promise.resolve(proposals);
  }
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------
function configMissing(mode: ProviderMode): never {
  console.error(JSON.stringify({ fn: 'process-incident-turn', event: 'provider_config_missing', mode }));
  throw new ProviderError('config_missing', false);
}

/**
 * Pure selection from env (no caching, no mode log):
 * - PROVIDER_MODE=xai  → XaiStt + XaiExtract; needs XAI_API_KEY (XAI_EXTRACT_MODEL optional).
 * - PROVIDER_MODE=groq → GroqStt + GroqExtract; needs GROQ_API_KEY (GROQ_EXTRACT_MODEL optional).
 * - PROVIDER_MODE=live → GroqStt + OpenAiExtract; needs GROQ_API_KEY, OPENAI_API_KEY, OPENAI_MODEL.
 * - anything else → mock.
 * Missing keys throw `config_missing` rather than silently falling back to mock.
 */
export function selectProviders(env: EnvReader = readEnv): Providers {
  const mode = env('PROVIDER_MODE')?.trim().toLowerCase();
  if (mode === 'xai') {
    const xaiKey = env('XAI_API_KEY')?.trim();
    if (!xaiKey) configMissing('xai');
    const model = env('XAI_EXTRACT_MODEL')?.trim() || DEFAULT_XAI_EXTRACT_MODEL;
    return { mode: 'xai', stt: new XaiStt(xaiKey), extract: new XaiExtract(xaiKey, model) };
  }
  if (mode === 'groq') {
    const groqKey = env('GROQ_API_KEY');
    if (!groqKey) configMissing('groq');
    const model = env('GROQ_EXTRACT_MODEL')?.trim() || DEFAULT_GROQ_EXTRACT_MODEL;
    return { mode: 'groq', stt: new GroqStt(groqKey), extract: new GroqExtract(groqKey, model) };
  }
  if (mode === 'live') {
    const groqKey = env('GROQ_API_KEY');
    const openAiKey = env('OPENAI_API_KEY');
    const model = env('OPENAI_MODEL');
    if (!groqKey || !openAiKey || !model) configMissing('live');
    return { mode: 'live', stt: new GroqStt(groqKey), extract: new OpenAiExtract(openAiKey, model) };
  }
  return { mode: 'mock', stt: new MockStt(env), extract: new MockExtract() };
}

let cached: Providers | null = null;

/** Process-wide providers, selected once from the function's env; logs the mode on first use. */
export function getProviders(): Providers {
  if (cached) return cached;
  cached = selectProviders();
  console.log(JSON.stringify({ fn: 'process-incident-turn', event: 'provider_mode', mode: cached.mode }));
  return cached;
}
