import assert from 'node:assert/strict';
import test from 'node:test';

import { mapRpcError, saveAcceptedProposalsWith } from '../src/lib/saveProposals.ts';
import { normaliseMetering, shouldLogMeterSample } from '../src/features/voice/meter.ts';
import {
  choiceSuggestions,
  isStoryQuestion,
  proposalsToSave,
  runVoiceTurn,
} from '../src/features/voice/voiceTurn.ts';

// ---------------------------------------------------------------------------
// runVoiceTurn: upload → process → save, resumable
// ---------------------------------------------------------------------------
const story = 'A silver sedan cut in front of me. Police came. Nobody was hurt.';
const applied = [
  { form_key: 'auto', field_key: 'what_happened', value: story, confidence: 1, evidence_quote: story },
  { form_key: 'auto', field_key: 'involved', value: ['another_vehicle'], confidence: 0.9, evidence_quote: 'silver sedan' },
  { form_key: 'auto', field_key: 'police', value: 'came', confidence: 0.9, evidence_quote: 'Police came' },
];
const response = { turn_id: 't1', transcript: story, applied, suggested: [], latency_ms: { stt: 900, llm: 2400 }, mode: 'xai' };

function deps({ failUpload = 0, failProcess = 0, failSave = 0, answered = [] } = {}) {
  const calls = { upload: [], process: [], save: [] };
  const answeredSet = new Set(answered);
  return {
    calls,
    answeredSet,
    uploadAudio: async (args) => {
      calls.upload.push(args);
      if (calls.upload.length <= failUpload) {
        throw Object.assign(new Error('Upload failed.'), { code: 'UPLOAD_FAILED', retryable: true, evidenceId: 'ev-1' });
      }
      return { evidenceId: 'ev-1' };
    },
    processTurn: async (args) => {
      calls.process.push(args);
      if (calls.process.length <= failProcess) return { ok: false, code: 'PROVIDER_UNAVAILABLE', retryable: true, message: 'down' };
      return { ok: true, data: response };
    },
    saveAccepted: async (proposals) => {
      calls.save.push(proposals.map((p) => p.field_key));
      if (calls.save.length <= failSave) {
        // the first proposal made it before the failure, like saveAcceptedProposals
        answeredSet.add(`${proposals[0].form_key}.${proposals[0].field_key}`);
        return { ok: false, code: 'STALE_VERSION', retryable: true, message: 'changed', saved: [proposals[0]] };
      }
      for (const p of proposals) answeredSet.add(`${p.form_key}.${p.field_key}`);
      return { ok: true };
    },
    answeredFields: () => answeredSet,
  };
}

const audioTurn = () => ({
  clientTurnId: 'mobile-1',
  question: { formKey: 'auto', fieldKey: 'what_happened' },
  input: { kind: 'audio', uri: 'file:///rec.m4a' },
});

test('voice turn: upload → process with the pinned question → save all applied', async () => {
  const d = deps();
  const outcome = await runVoiceTurn(audioTurn(), d);
  assert.equal(outcome.ok, true);
  assert.deepEqual(d.calls.process[0], { client_turn_id: 'mobile-1', form_key: 'auto', field_key: 'what_happened', audio_evidence_id: 'ev-1' });
  assert.deepEqual(d.calls.save, [['what_happened', 'involved', 'police']]);
  assert.deepEqual(outcome.saved.map((f) => f.fieldKey), ['what_happened', 'involved', 'police']);
});

test('voice turn: fields the driver already answered are never saved over', async () => {
  const d = deps({ answered: ['auto.police'] });
  const outcome = await runVoiceTurn(audioTurn(), d);
  assert.deepEqual(d.calls.save, [['what_happened', 'involved']]);
  assert.deepEqual(outcome.skippedAnswered, [{ formKey: 'auto', fieldKey: 'police' }]);
});

test('voice turn: upload failure keeps the evidence id; retry reuses it and the client_turn_id', async () => {
  const d = deps({ failUpload: 1 });
  const pending = audioTurn();
  const first = await runVoiceTurn(pending, d);
  assert.equal(first.ok, false);
  assert.equal(first.failure.stage, 'upload');
  assert.equal(pending.evidenceId, 'ev-1');
  const second = await runVoiceTurn(pending, d);
  assert.equal(second.ok, true);
  assert.equal(d.calls.upload[1].evidenceId, 'ev-1');
  assert.equal(d.calls.process[0].client_turn_id, 'mobile-1');
});

test('voice turn: process failure retries without re-uploading, same client_turn_id', async () => {
  const d = deps({ failProcess: 1 });
  const pending = audioTurn();
  assert.equal((await runVoiceTurn(pending, d)).failure.stage, 'process');
  assert.equal((await runVoiceTurn(pending, d)).ok, true);
  assert.equal(d.calls.upload.length, 1);
  assert.deepEqual(d.calls.process.map((c) => c.client_turn_id), ['mobile-1', 'mobile-1']);
});

test('voice turn: save failure retries only the unsaved fields (no reprocessing, no double save)', async () => {
  const d = deps({ failSave: 1 });
  const pending = audioTurn();
  const first = await runVoiceTurn(pending, d);
  assert.equal(first.failure.stage, 'save');
  const second = await runVoiceTurn(pending, d);
  assert.equal(second.ok, true);
  assert.equal(d.calls.process.length, 1);
  assert.deepEqual(d.calls.save, [['what_happened', 'involved', 'police'], ['involved', 'police']]);
});

test('typed story: text turn, no upload', async () => {
  const d = deps();
  const outcome = await runVoiceTurn({ clientTurnId: 'mobile-2', question: { formKey: 'auto', fieldKey: 'what_happened' }, input: { kind: 'text', text: story } }, d);
  assert.equal(outcome.ok, true);
  assert.equal(d.calls.upload.length, 0);
  assert.equal(d.calls.process[0].text, story);
  assert.equal(d.calls.process[0].audio_evidence_id, undefined);
});

test('proposalsToSave splits answered fields out', () => {
  const r = proposalsToSave(applied, new Set(['auto.what_happened']));
  assert.deepEqual(r.save.map((p) => p.field_key), ['involved', 'police']);
  assert.deepEqual(r.skipped, [{ formKey: 'auto', fieldKey: 'what_happened' }]);
});

test('isStoryQuestion: "What happened?" text questions only', () => {
  assert.equal(isStoryQuestion('What happened?', 'long_text'), true);
  assert.equal(isStoryQuestion('Tell us what happened', 'text'), true);
  assert.equal(isStoryQuestion('What happened?', 'enum'), false);
  assert.equal(isStoryQuestion('Where is the truck being towed?', 'text'), false);
});

test('choiceSuggestions keeps only enum / multi_enum / boolean fields', () => {
  const types = { 'auto.drivable': 'enum', 'auto.weather_road': 'multi_enum', 'auto.other_vehicle': 'text', 'auto.seatbelt': 'boolean' };
  const s = choiceSuggestions(
    Object.keys(types).map((id) => ({ form_key: 'auto', field_key: id.split('.')[1], value: 'x', confidence: 0.6, evidence_quote: 'x' })),
    (formKey, fieldKey) => types[`${formKey}.${fieldKey}`] ?? null,
  );
  assert.deepEqual([...s.keys()].sort(), ['auto.drivable', 'auto.seatbelt', 'auto.weather_road']);
});

test('metering: -60..0 dB → 0..1; silence / missing → 0; dev log samples', () => {
  assert.equal(normaliseMetering(0), 1);
  assert.equal(normaliseMetering(-30), 0.5);
  assert.equal(normaliseMetering(-60), 0);
  assert.equal(normaliseMetering(-160), 0); // Android silence (maxAmplitude 0)
  assert.equal(normaliseMetering(undefined), 0);
  assert.equal(normaliseMetering(Number.NaN), 0);
  assert.equal(normaliseMetering(3), 1);
  assert.deepEqual([0, 4, 5, 25, 26, 50].map(shouldLogMeterSample), [true, true, false, true, false, true]);
});

/** Fake client: a revision at `version`; save_incident_answer follows Eng B's optimistic-version rules. */
function fakeClient({ version = 7, staleOnce = false, failOn = null } = {}) {
  const calls = [];
  let current = version;
  let staled = false;
  return {
    calls,
    get version() {
      return current;
    },
    bump() {
      current += 1;
    },
    from: (table) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            calls.push({ read: table });
            return { data: { version: current }, error: null };
          },
        }),
      }),
    }),
    rpc: async (fn, args) => {
      calls.push({ fn, expected: args.p_expected_version, field: args.p_field_key, source: args.p_source, value: args.p_value });
      if (staleOnce && !staled) {
        staled = true;
        current += 1; // someone else (e.g. begin_incident_turn) bumped the version
      }
      if (args.p_field_key === failOn) return { data: null, error: { code: 'P0001', message: 'VALIDATION_FAILED' } };
      if (args.p_expected_version !== current) return { data: null, error: { code: 'P0001', message: 'STALE_VERSION' } };
      current += 1;
      return { data: current, error: null };
    },
  };
}

const proposals = [
  { form_key: 'auto', field_key: 'police', value: true },
  { form_key: 'auto', field_key: 'injuries', value: false },
  { form_key: 'auto', field_key: 'what_happened', value: 'A sedan cut in.' },
];

test('saves sequentially, reading the version once and threading the returned version', async () => {
  const client = fakeClient({ version: 7 });
  const result = await saveAcceptedProposalsWith(client, 'rev-1', proposals);
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.saved.map((f) => f.field_key), ['police', 'injuries', 'what_happened']);
  assert.equal(result.data.version, 10);
  const saves = client.calls.filter((c) => c.fn);
  assert.deepEqual(saves.map((c) => c.expected), [7, 8, 9]);
  assert.ok(saves.every((c) => c.source === 'driver_confirmed'));
  assert.deepEqual(saves.map((c) => c.value), [true, false, 'A sedan cut in.']);
  assert.equal(client.calls.filter((c) => c.read).length, 1);
});

test('STALE_VERSION is retried once after re-reading the version', async () => {
  const client = fakeClient({ version: 3, staleOnce: true });
  const result = await saveAcceptedProposalsWith(client, 'rev-1', proposals.slice(0, 1));
  assert.equal(result.ok, true);
  assert.deepEqual(client.calls.filter((c) => c.fn).map((c) => c.expected), [3, 4]);
  assert.equal(client.calls.filter((c) => c.read).length, 2);
});

test('a failure stops the loop and reports what was saved and what failed', async () => {
  const client = fakeClient({ failOn: 'injuries' });
  const result = await saveAcceptedProposalsWith(client, 'rev-1', proposals);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'VALIDATION_FAILED');
  assert.equal(result.retryable, false);
  assert.deepEqual(result.saved, [{ form_key: 'auto', field_key: 'police' }]);
  assert.deepEqual(result.failed, { form_key: 'auto', field_key: 'injuries' });
  assert.equal(client.calls.filter((c) => c.fn).length, 2);
});

test('RPC errors map to { code, retryable }', () => {
  assert.deepEqual(
    [mapRpcError({ code: 'P0001', message: 'STALE_VERSION' }).code, mapRpcError({ code: 'P0001', message: 'STALE_VERSION' }).retryable],
    ['STALE_VERSION', true],
  );
  assert.equal(mapRpcError({ code: 'P0001', message: 'INCIDENT_NOT_DRAFT' }).retryable, false);
  assert.equal(mapRpcError({ code: 'P0001', message: 'FORM_DEFINITION_MISSING' }).code, 'FORM_DEFINITION_MISSING');
  assert.equal(mapRpcError({ code: 'P0001', message: 'something new' }).code, 'UNKNOWN');
  assert.equal(mapRpcError({ code: '42501', message: 'permission denied' }).code, 'UNKNOWN');
  assert.deepEqual([mapRpcError({ message: 'TypeError: Network request failed' }).code, mapRpcError({}).retryable], ['NETWORK', true]);
});
