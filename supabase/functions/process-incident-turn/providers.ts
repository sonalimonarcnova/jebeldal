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
  transcribe(audio: Blob, lang: string): Promise<string>;
}

export interface ExtractProvider {
  extract(input: ExtractInput): Promise<RawProposal[]>;
}

export type ProviderMode = 'mock' | 'live';
export type Providers = { mode: ProviderMode; stt: SttProvider; extract: ExtractProvider };

export const PROVIDER_TIMEOUT_MS = 20_000;

/** Provider failure. `code` is safe to store and log: it never contains provider text or keys. */
export class ProviderError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  constructor(code: string, retryable: boolean) {
    super(code);
    this.name = 'ProviderError';
    this.code = code;
    this.retryable = retryable;
  }
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
    await response.body?.cancel();
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    throw new ProviderError(`${stage}_http_${response.status}`, retryable);
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

  async transcribe(audio: Blob, lang: string): Promise<string> {
    const ext = AUDIO_EXTENSIONS[audio.type] ?? 'm4a';
    const form = new FormData();
    form.append('file', audio, `turn.${ext}`);
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
    const text = responseOutputText(data);
    if (text === null) throw new ProviderError('llm_bad_output', true);
    try {
      const parsed = JSON.parse(text) as { proposals?: unknown };
      return Array.isArray(parsed.proposals) ? (parsed.proposals as RawProposal[]) : [];
    } catch {
      throw new ProviderError('llm_bad_output', true);
    }
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

  transcribe(_audio: Blob, _lang: string): Promise<string> {
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
let cached: Providers | null = null;

/**
 * PROVIDER_MODE=live → Groq + OpenAI (GROQ_API_KEY, OPENAI_API_KEY and OPENAI_MODEL required; missing keys
 * throw `config_missing` rather than silently falling back to mock). Anything else → mock.
 */
export function getProviders(env: EnvReader = readEnv): Providers {
  if (cached) return cached;

  if (env('PROVIDER_MODE') === 'live') {
    const groqKey = env('GROQ_API_KEY');
    const openAiKey = env('OPENAI_API_KEY');
    const model = env('OPENAI_MODEL');
    if (!groqKey || !openAiKey || !model) {
      console.error(JSON.stringify({ fn: 'process-incident-turn', event: 'provider_config_missing', mode: 'live' }));
      throw new ProviderError('config_missing', false);
    }
    cached = { mode: 'live', stt: new GroqStt(groqKey), extract: new OpenAiExtract(openAiKey, model) };
  } else {
    cached = { mode: 'mock', stt: new MockStt(env), extract: new MockExtract() };
  }

  console.log(JSON.stringify({ fn: 'process-incident-turn', event: 'provider_mode', mode: cached.mode }));
  return cached;
}
