import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveDriverRoute } from '../src/auth/driverRoute.ts';
import { draftCacheKey } from '../src/features/incidents/draftCacheKey.ts';
import { resolveCachedDraftText } from '../src/features/incidents/draftRecovery.ts';
import {
  findFieldDefinition,
  getFieldPrompt,
  parseFormDefinition,
  validateFieldValue,
} from '../src/features/incidents/formDefinition.ts';
import { createAuthRequestTimeoutFetch } from '../src/lib/authRequestTimeoutFetch.ts';
import {
  formatLocation,
  getConfirmedTextAnswer,
  mapIncidentCards,
} from '../src/features/incidents/model.ts';
import {
  createIncidentDraftWith,
  saveIncidentAnswerWith,
} from '../src/features/incidents/rpcOperations.ts';
import { mapHomeTrip } from '../src/features/home/model.ts';

const incidentId = '10000000-0000-4000-8000-000000000001';
const revisionId = '20000000-0000-4000-8000-000000000001';
const secondIncidentId = '10000000-0000-4000-8000-000000000002';
const secondRevisionId = '20000000-0000-4000-8000-000000000002';

test('driver navigation waits for auth/profile and protects incomplete or non-driver sessions', () => {
  const profile = {
    userId: '40000000-0000-4000-8000-000000000001',
    organizationId: '50000000-0000-4000-8000-000000000001',
    role: 'driver',
    displayName: 'Fictional Driver',
    phone: '',
    employeeId: '',
    preferredLanguage: 'en',
    profileCompletedAt: null,
    vehicle: null,
    organizationName: 'Fictional Fleet',
  };
  const defaults = {
    authLoading: false,
    hasSession: true,
    profileLoading: false,
    authError: null,
    profileError: null,
    profile,
  };

  assert.equal(resolveDriverRoute({ ...defaults, authLoading: true }), 'loading');
  assert.equal(resolveDriverRoute({ ...defaults, hasSession: false }), 'sign-in');
  assert.equal(resolveDriverRoute(defaults), 'confirm-profile');
  assert.equal(
    resolveDriverRoute({ ...defaults, profile: { ...profile, role: 'manager' } }),
    'not-driver',
  );
  assert.equal(
    resolveDriverRoute({ ...defaults, profile: { ...profile, profileCompletedAt: '2026-11-19T00:00:00Z' } }),
    'home',
  );
});

test('incident cards use the active revision, confirmed summary, and triggered forms', () => {
  const cards = mapIncidentCards(
    [
      {
        id: incidentId,
        status: 'draft',
        active_revision_id: revisionId,
        created_at: '2026-11-19T00:00:00Z',
        updated_at: '2026-11-19T01:00:00Z',
      },
    ],
    [
      {
        id: revisionId,
        incident_id: incidentId,
        version: 3,
        status: 'draft',
        form_set_key: 'default',
        form_set_version: 1,
        occurred_at: null,
        location: { label: 'Fictional test yard' },
        report_reference: null,
      },
    ],
    [
      {
        incident_revision_id: revisionId,
        field_key: 'what_happened',
        value: 'Fictional training-yard event',
        answer_state: 'confirmed',
      },
    ],
    [
      {
        incident_revision_id: revisionId,
        form_key: 'auto',
        activation_status: 'triggered',
      },
      {
        incident_revision_id: revisionId,
        form_key: 'general_liability',
        activation_status: 'not_triggered',
      },
    ],
  );

  assert.equal(cards.length, 1);
  assert.equal(cards[0].activeRevisionId, revisionId);
  assert.equal(cards[0].summary, 'Fictional training-yard event');
  assert.equal(cards[0].location, 'Fictional test yard');
  assert.deepEqual(cards[0].triggeredForms, ['auto']);
  assert.equal(cards[0].revisionVersion, 3);
});

test('incident cards do not promote unknown answers or missing revisions to saved summaries', () => {
  const cards = mapIncidentCards(
    [
      {
        id: secondIncidentId,
        status: 'submitted',
        active_revision_id: secondRevisionId,
        created_at: '2026-11-18T00:00:00Z',
        updated_at: '2026-11-18T01:00:00Z',
      },
      {
        id: incidentId,
        status: 'draft',
        active_revision_id: null,
        created_at: '2026-11-17T00:00:00Z',
        updated_at: '2026-11-17T01:00:00Z',
      },
    ],
    [
      {
        id: secondRevisionId,
        incident_id: secondIncidentId,
        version: 1,
        status: 'submitted',
        form_set_key: 'default',
        form_set_version: 1,
        occurred_at: null,
        location: null,
        report_reference: 'JBL-TEST-1',
      },
    ],
    [
      {
        incident_revision_id: secondRevisionId,
        field_key: 'what_happened',
        value: 'Unconfirmed sample',
        answer_state: 'unknown',
      },
    ],
    [],
  );

  assert.equal(cards[0].summary, null);
  assert.equal(cards[0].status, 'submitted');
  assert.equal(cards[0].reportReference, 'JBL-TEST-1');
  assert.equal(cards[1].activeRevisionId, null);
  assert.equal(cards[1].revisionVersion, null);
});

test('draft creation uses the existing RPC contract and rejects malformed revision IDs', async () => {
  let receivedArgs;
  const revision = await createIncidentDraftWith(async (args) => {
    receivedArgs = args;
    return { data: revisionId, error: null };
  });

  assert.equal(revision, revisionId);
  assert.deepEqual(receivedArgs, {
    p_form_set_key: 'default',
    p_form_set_version: 1,
    p_language: 'en',
  });

  await assert.rejects(
    createIncidentDraftWith(async () => ({ data: null, error: null })),
    /valid revision ID/,
  );
});

test('draft creation surfaces RPC failures instead of returning a fake revision', async () => {
  await assert.rejects(
    createIncidentDraftWith(async () => ({
      data: null,
      error: { code: 'NOT_ALLOWED', message: 'Driver profile required' },
    })),
    /NOT_ALLOWED.*Driver profile required/,
  );
});

test('answer save passes the expected version and returns the server version', async () => {
  const args = {
    p_incident_revision_id: revisionId,
    p_expected_version: 4,
    p_form_key: 'auto',
    p_field_key: 'what_happened',
    p_group_instance_id: null,
    p_value: 'Fictional answer',
    p_answer_state: 'confirmed',
    p_source: 'manual',
    p_evidence_id: null,
  };
  let receivedArgs;
  const version = await saveIncidentAnswerWith(async (received) => {
    receivedArgs = received;
    return { data: 5, error: null };
  }, args);

  assert.equal(version, 5);
  assert.deepEqual(receivedArgs, args);
});

test('answer save surfaces stale-version and malformed server responses', async () => {
  const args = {
    p_incident_revision_id: revisionId,
    p_expected_version: 4,
    p_form_key: 'auto',
    p_field_key: 'what_happened',
    p_group_instance_id: null,
    p_value: 'Fictional answer',
    p_answer_state: 'confirmed',
    p_source: 'manual',
    p_evidence_id: null,
  };

  await assert.rejects(
    saveIncidentAnswerWith(async () => ({
      data: null,
      error: { code: 'P0001', message: 'STALE_VERSION' },
    }), args),
    /changed on the server.*not saved/,
  );
  await assert.rejects(
    saveIncidentAnswerWith(async () => ({
      data: null,
      error: { code: 'P0001', message: 'VALIDATION_FAILED' },
    }), args),
    /server rejected this answer/i,
  );
  await assert.rejects(
    saveIncidentAnswerWith(async () => ({ data: '5', error: null }), args),
    /valid revision version/,
  );
});

test('form parsing renders only pinned fields and preserves authored English labels and sections', () => {
  const parsed = parseFormDefinition({
    sections: [{
      key: 'scene',
      label: { en: 'Scene' },
      fields: [{
        key: 'what_happened',
        type: 'long_text',
        required: true,
        label: { en: 'Describe the incident', es: 'Descripción' },
      }],
    }],
    fields: [
      { key: 'property_damaged', type: 'boolean', required: true },
      { key: 'unsupported_media', type: 'media', required: false },
    ],
  });

  assert.deepEqual(parsed.fields.map((field) => field.key), [
    'what_happened',
    'property_damaged',
    'unsupported_media',
  ]);
  assert.equal(getFieldPrompt(parsed.fields[0]), 'Describe the incident');
  assert.equal(parsed.fields[0].section, 'Scene');
  assert.equal(parsed.fields[2].configurationError, 'The field type “media” is not supported in this MVP.');
  assert.equal(parsed.fields[0].required, true);
});

test('form values follow pinned types, requiredness, options, and numeric validation', () => {
  const fields = parseFormDefinition({
    fields: [
      { key: 'confirmed', type: 'boolean', required: true },
      { key: 'amount', type: 'currency', required: true, validation: { min: 1, max: 10 } },
      {
        key: 'kind',
        type: 'enum',
        required: true,
        options: [{ value: 'authored_choice', label: { en: 'Authored choice' } }],
      },
      { key: 'missing_options', type: 'multi_enum', required: false },
    ],
  }).fields;

  assert.deepEqual(validateFieldValue(fields[0], false), { ok: true, value: false });
  assert.match(validateFieldValue(fields[0], null).error, /required/i);
  assert.deepEqual(validateFieldValue(fields[1], '2.5'), { ok: true, value: 2.5 });
  assert.match(validateFieldValue(fields[1], '20').error, /maximum/i);
  assert.deepEqual(validateFieldValue(fields[2], 'authored_choice'), { ok: true, value: 'authored_choice' });
  assert.match(validateFieldValue(fields[2], 'invented_choice').error, /pinned definition/i);
  assert.match(fields[3].configurationError, /no usable options/i);
});

test('answer save preserves JSON boolean, numeric, and array values in the RPC contract', async () => {
  const args = {
    p_incident_revision_id: revisionId,
    p_expected_version: 6,
    p_form_key: 'auto',
    p_field_key: 'multi_choice',
    p_group_instance_id: null,
    p_value: ['authored_one', 'authored_two'],
    p_answer_state: 'confirmed',
    p_source: 'manual',
    p_evidence_id: null,
  };
  let receivedArgs;
  const version = await saveIncidentAnswerWith(async (received) => {
    receivedArgs = received;
    return { data: 7, error: null };
  }, args);

  assert.equal(version, 7);
  assert.deepEqual(receivedArgs.p_value, ['authored_one', 'authored_two']);
  assert.equal(typeof receivedArgs.p_value, 'object');
});

test('pinned form field lookup traverses nested fields and uses authored prompt text', () => {
  const definition = {
    sections: [
      {
        key: 'scene',
        fields: [
          {
            key: 'what_happened',
            type: 'long_text',
            question: { en: 'Describe the fictional incident.' },
          },
        ],
      },
    ],
  };
  const field = findFieldDefinition(definition, 'what_happened');

  assert.ok(field);
  assert.equal(field.type, 'long_text');
  assert.equal(getFieldPrompt(field), 'Describe the fictional incident.');
  assert.equal(findFieldDefinition(definition, 'unknown_field'), null);
});

test('draft cache keys are isolated by user, revision, and field', () => {
  assert.notEqual(
    draftCacheKey('driver-one', revisionId, 'what_happened'),
    draftCacheKey('driver-two', revisionId, 'what_happened'),
  );
  assert.notEqual(
    draftCacheKey('driver-one', revisionId, 'what_happened'),
    draftCacheKey('driver-one', secondRevisionId, 'what_happened'),
  );
});

test('draft recovery keeps both copies visible when the cached revision is stale', () => {
  const cachedDraft = {
    text: 'Unsynced local incident narrative',
    expectedVersion: 2,
    updatedAt: '2026-11-19T00:00:00Z',
  };
  const serverDraft = {
    narrative: 'Saved server incident narrative',
    version: 3,
  };

  assert.deepEqual(resolveCachedDraftText(cachedDraft, serverDraft), {
    kind: 'conflict',
    conflict: {
      localText: cachedDraft.text,
      serverText: serverDraft.narrative,
      expectedVersion: 2,
      currentVersion: 3,
    },
  });
  assert.deepEqual(resolveCachedDraftText(cachedDraft, { ...serverDraft, version: 2 }), {
    kind: 'restore',
    text: cachedDraft.text,
    dirty: true,
  });
});

test('only confirmed text answers and known location labels are displayed', () => {
  assert.equal(getConfirmedTextAnswer('Saved narrative', 'confirmed'), 'Saved narrative');
  assert.equal(getConfirmedTextAnswer('Unknown narrative', 'unknown'), '');
  assert.equal(formatLocation({ address: 'Fictional test yard' }), 'Fictional test yard');
  assert.equal(formatLocation({ latitude: 30, longitude: -97 }), null);
});

test('Home maps seeded trip data and handles optional route fields', () => {
  assert.equal(mapHomeTrip(null), null);
  const trip = mapHomeTrip({
    id: '30000000-0000-4000-8000-000000000001',
    started_at: '2026-11-18T14:00:00Z',
    route: { origin: 'Fictional origin', destination: 'Fictional destination' },
    purpose: 'fictional demo delivery',
    vehicle_id: null,
    dvir_summary: { status: 'fictional demo data' },
  });

  assert.equal(trip?.origin, 'Fictional origin');
  assert.equal(trip?.destination, 'Fictional destination');
  assert.equal(trip?.preTripStatus, 'fictional demo data');

  const sparseTrip = mapHomeTrip({
    id: '30000000-0000-4000-8000-000000000002',
    started_at: null,
    route: {},
    purpose: null,
    vehicle_id: null,
    dvir_summary: null,
  });
  assert.equal(sparseTrip?.origin, null);
  assert.equal(sparseTrip?.destination, null);
});

test('password sign-in aborts a stalled request and returns an actionable timeout', async () => {
  const timedFetch = createAuthRequestTimeoutFetch(
    (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('Request aborted')), {
          once: true,
        });
      }),
    5,
  );

  await assert.rejects(
    timedFetch('https://demo.supabase.co/auth/v1/token?grant_type=password'),
    /Sign-in timed out\. Check your connection and try again\./,
  );
});

test('password sign-in timeout does not affect other Supabase requests', async () => {
  const response = new Response('{}');
  const timedFetch = createAuthRequestTimeoutFetch(async () => response, 5);

  assert.equal(await timedFetch('https://demo.supabase.co/rest/v1/profiles'), response);
});
