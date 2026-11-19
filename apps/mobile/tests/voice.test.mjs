import assert from 'node:assert/strict';
import test from 'node:test';

import { mapRpcError, saveAcceptedProposalsWith } from '../src/lib/saveProposals.ts';

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
