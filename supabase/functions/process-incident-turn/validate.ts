// Pure validation of extraction proposals. No I/O, no runtime-specific APIs.
import type { CatalogEntry } from './catalog.ts';

export const APPLY_THRESHOLD = 0.8;

/** A validated proposal. `value` is a string for text/enum keys and a string[] for enum_list keys. */
export type Proposal = {
  key: string;
  value: string | string[];
  confidence: number;
  evidence_quote: string;
};

export type RejectReason =
  | 'malformed'
  | 'unknown_key'
  | 'invalid_value'
  | 'invalid_confidence'
  | 'quote_not_in_transcript';

export type Rejected = { key: string | null; reason: RejectReason; proposal: unknown };

export type ValidationResult = {
  /** confidence ≥ APPLY_THRESHOLD, one entry per key */
  applied: Proposal[];
  /** valid but below threshold, one entry per key; enum/text keys already applied are dropped */
  suggested: Proposal[];
  rejected: Rejected[];
};

const QUOTE_JOINER = ' … ';

function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Returns the normalised value for the entry, or null if it is not allowed. */
function normaliseValue(entry: CatalogEntry, value: unknown): string | string[] | null {
  if (entry.extractType === 'text') {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  const options = entry.options ?? [];
  if (entry.extractType === 'enum') {
    // A one-element array is accepted for single-choice keys (the LLM schema allows string | string[]).
    const single = Array.isArray(value) && value.length === 1 ? value[0] : value;
    return typeof single === 'string' && options.includes(single) ? single : null;
  }

  // enum_list: a bare string is treated as a one-element list.
  const list = typeof value === 'string' ? [value] : value;
  if (!Array.isArray(list) || list.length === 0) return null;
  const unique: string[] = [];
  for (const item of list) {
    if (typeof item !== 'string' || !options.includes(item)) return null;
    if (!unique.includes(item)) unique.push(item);
  }
  return unique;
}

function validateOne(
  raw: unknown,
  normalisedTranscript: string,
  byKey: Map<string, CatalogEntry>,
): Proposal | Rejected {
  if (!isRecord(raw) || typeof raw.key !== 'string') {
    return { key: null, reason: 'malformed', proposal: raw };
  }
  const key = raw.key;
  const entry = byKey.get(key);
  if (!entry) return { key, reason: 'unknown_key', proposal: raw };

  const value = normaliseValue(entry, raw.value);
  if (value === null) return { key, reason: 'invalid_value', proposal: raw };

  const confidence = raw.confidence;
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return { key, reason: 'invalid_confidence', proposal: raw };
  }

  const quote = typeof raw.evidence_quote === 'string' ? raw.evidence_quote.trim() : '';
  if (quote.length === 0 || !normalisedTranscript.includes(normalise(quote))) {
    return { key, reason: 'quote_not_in_transcript', proposal: raw };
  }

  return { key, value, confidence, evidence_quote: quote };
}

/**
 * Collapses several proposals for the same key into one.
 * enum_list: union of values (catalog option order), lowest confidence, quotes joined with " … ".
 * text / enum: the highest-confidence proposal wins.
 */
function mergeByKey(proposals: Proposal[], byKey: Map<string, CatalogEntry>): Proposal[] {
  const merged = new Map<string, Proposal>();
  for (const p of proposals) {
    const current = merged.get(p.key);
    if (!current) {
      merged.set(p.key, { ...p, value: Array.isArray(p.value) ? [...p.value] : p.value });
      continue;
    }
    const entry = byKey.get(p.key);
    if (entry?.extractType === 'enum_list' && Array.isArray(current.value) && Array.isArray(p.value)) {
      const options = entry.options ?? [];
      const union = new Set([...current.value, ...p.value]);
      const quotes = current.evidence_quote.split(QUOTE_JOINER);
      if (!quotes.includes(p.evidence_quote)) quotes.push(p.evidence_quote);
      merged.set(p.key, {
        key: p.key,
        value: options.filter((o) => union.has(o)),
        confidence: Math.min(current.confidence, p.confidence),
        evidence_quote: quotes.join(QUOTE_JOINER),
      });
    } else if (p.confidence > current.confidence) {
      merged.set(p.key, p);
    }
  }
  return [...merged.values()];
}

export function validateProposals(
  raw: readonly unknown[],
  transcript: string,
  catalog: readonly CatalogEntry[],
): ValidationResult {
  const byKey = new Map(catalog.map((entry) => [entry.key, entry]));
  const normalisedTranscript = normalise(transcript);

  const high: Proposal[] = [];
  const low: Proposal[] = [];
  const rejected: Rejected[] = [];

  for (const item of Array.isArray(raw) ? raw : []) {
    const result = validateOne(item, normalisedTranscript, byKey);
    if ('reason' in result) rejected.push(result);
    else if (result.confidence >= APPLY_THRESHOLD) high.push(result);
    else low.push(result);
  }

  const applied = mergeByKey(high, byKey);
  const appliedByKey = new Map(applied.map((p) => [p.key, p]));
  const suggested: Proposal[] = [];
  for (const p of mergeByKey(low, byKey)) {
    const done = appliedByKey.get(p.key);
    if (!done) {
      suggested.push(p);
    } else if (Array.isArray(p.value) && Array.isArray(done.value)) {
      // enum_list: only suggest values that were not already applied.
      const doneValues = done.value;
      const rest = p.value.filter((v) => !doneValues.includes(v));
      if (rest.length > 0) suggested.push({ ...p, value: rest });
    }
  }

  return { applied, suggested, rejected };
}
