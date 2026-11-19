// One spoken (or typed-story) answer, end to end: upload → process-incident-turn → save accepted proposals.
// Dependency-injected and free of React Native imports, so it is unit-tested in Node (tests/voice.test.mjs).
// Retrying a failed turn resumes from the failed step with the SAME client_turn_id and evidence id, so nothing
// already uploaded, processed or saved is redone or lost.

export type VoiceProposal = {
  form_key: string;
  field_key: string;
  value: string | string[] | boolean;
  confidence: number;
  evidence_quote: string;
};

export type VoiceTurnResponse = {
  turn_id: string;
  transcript: string;
  applied: VoiceProposal[];
  suggested: VoiceProposal[];
  latency_ms: { stt: number; llm: number };
  mode: string;
};

export type FieldRef = { formKey: string; fieldKey: string };

/** In-flight state kept by the screen between attempts. */
export type PendingVoiceTurn = {
  clientTurnId: string;
  question: FieldRef;
  input: { kind: 'audio'; uri: string } | { kind: 'text'; text: string };
  evidenceId?: string;
  uploaded?: boolean;
  response?: VoiceTurnResponse;
  saved?: boolean;
};

export type VoiceTurnFailure = {
  stage: 'upload' | 'process' | 'save';
  code: string;
  message: string;
  retryable: boolean;
};

export type VoiceTurnOutcome =
  | { ok: true; response: VoiceTurnResponse; saved: FieldRef[]; skippedAnswered: FieldRef[] }
  | { ok: false; failure: VoiceTurnFailure };

type Fail = { ok: false; code: string; retryable: boolean; message: string };

export type VoiceTurnDeps = {
  uploadAudio: (args: { uri: string; evidenceId?: string }) => Promise<{ evidenceId: string }>;
  /** Thrown upload errors may carry the evidence id so the retry reuses the row. */
  processTurn: (args: {
    client_turn_id: string;
    form_key: string;
    field_key: string;
    audio_evidence_id?: string;
    text?: string;
  }) => Promise<{ ok: true; data: VoiceTurnResponse } | Fail>;
  saveAccepted: (proposals: VoiceProposal[]) => Promise<{ ok: true } | (Fail & { saved: { form_key: string; field_key: string }[] })>;
  /** (form, field) pairs that already have a persisted answer in this revision (any state). */
  answeredFields: () => Set<string>;
};

export const fieldId = (formKey: string, fieldKey: string) => `${formKey}.${fieldKey}`;

/** Fields to save: applied proposals minus anything the driver already answered (never overwrite their answer). */
export function proposalsToSave(applied: VoiceProposal[], answered: Set<string>): { save: VoiceProposal[]; skipped: FieldRef[] } {
  const save: VoiceProposal[] = [];
  const skipped: FieldRef[] = [];
  for (const p of applied) {
    if (answered.has(fieldId(p.form_key, p.field_key))) skipped.push({ formKey: p.form_key, fieldKey: p.field_key });
    else save.push(p);
  }
  return { save, skipped };
}

/** Mutates `pending` as steps succeed, so a retry with the same object resumes where it stopped. */
export async function runVoiceTurn(pending: PendingVoiceTurn, deps: VoiceTurnDeps): Promise<VoiceTurnOutcome> {
  // 1. Upload (audio only, once).
  if (pending.input.kind === 'audio' && !pending.uploaded) {
    try {
      const uploaded = await deps.uploadAudio({ uri: pending.input.uri, evidenceId: pending.evidenceId });
      pending.evidenceId = uploaded.evidenceId;
      pending.uploaded = true;
    } catch (error) {
      const e = error as { code?: unknown; message?: unknown; retryable?: unknown; evidenceId?: unknown };
      if (typeof e.evidenceId === 'string') pending.evidenceId = e.evidenceId;
      return {
        ok: false,
        failure: {
          stage: 'upload',
          code: typeof e.code === 'string' ? e.code : 'UPLOAD_FAILED',
          message: typeof e.message === 'string' ? e.message : 'The recording could not be uploaded.',
          retryable: e.retryable !== false,
        },
      };
    }
  }

  // 2. Process (idempotent on client_turn_id; a retry after success just replays the stored response).
  if (!pending.response) {
    const result = await deps.processTurn({
      client_turn_id: pending.clientTurnId,
      form_key: pending.question.formKey,
      field_key: pending.question.fieldKey,
      ...(pending.input.kind === 'audio' ? { audio_evidence_id: pending.evidenceId } : { text: pending.input.text }),
    });
    if (!result.ok) return { ok: false, failure: { stage: 'process', code: result.code, message: result.message, retryable: result.retryable } };
    pending.response = result.data;
  }
  const response = pending.response;

  // 3. Save applied proposals the driver has not answered yet. Re-checked on retry, so fields saved by the
  //    previous attempt now count as answered and are not saved twice.
  const { save, skipped } = proposalsToSave(response.applied, deps.answeredFields());
  if (!pending.saved && save.length > 0) {
    const saved = await deps.saveAccepted(save);
    if (!saved.ok) return { ok: false, failure: { stage: 'save', code: saved.code, message: saved.message, retryable: saved.retryable } };
  }
  pending.saved = true;
  return { ok: true, response, saved: save.map((p) => ({ formKey: p.form_key, fieldKey: p.field_key })), skippedAnswered: skipped };
}

/** True when this question is the driver's story ("What happened?"), the same rule the server uses. */
export function isStoryQuestion(prompt: string, fieldType: string): boolean {
  return (fieldType === 'long_text' || fieldType === 'text') && /\bwhat happened\b/i.test(prompt);
}

/** Choice suggestions (enum / multi_enum / boolean) keyed by fieldId, for "from your story" pre-selection. */
export function choiceSuggestions(
  suggested: VoiceProposal[],
  fieldType: (formKey: string, fieldKey: string) => string | null,
): Map<string, VoiceProposal> {
  const out = new Map<string, VoiceProposal>();
  for (const p of suggested) {
    const type = fieldType(p.form_key, p.field_key);
    if (type === 'enum' || type === 'multi_enum' || type === 'boolean') out.set(fieldId(p.form_key, p.field_key), p);
  }
  return out;
}
