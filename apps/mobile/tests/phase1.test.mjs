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
import {
  createClientTurnId,
  findPinnedQuestionMapping,
  findPinnedQuestionField,
  parseNextQuestionResponse,
  parseProcessedTurnResponse,
  processIncidentTextTurnWith,
  questionAnswerText,
  selectNextQuestionWith,
} from '../src/features/incidents/questionFlow.ts';
import { createAuthRequestTimeoutFetch } from '../src/lib/authRequestTimeoutFetch.ts';
import {
  formatLocation,
  getConfirmedTextAnswer,
  mapIncidentCards,
} from '../src/features/incidents/model.ts';
import {
  createIncidentAnswerGroupWith,
  createIncidentDraftWith,
  createIncidentEvidenceWith,
  checkIncidentSubmissionReadinessWith,
  deleteIncidentAnswerGroupWith,
  finalizeIncidentEvidenceWith,
  saveIncidentDetailsWith,
  saveIncidentAnswerWith,
  submitIncidentWith,
} from '../src/features/incidents/rpcOperations.ts';
import { createSignatureReference } from '../src/features/incidents/submissionCache.ts';
import {
  resolveCachedDraftEdits,
} from '../src/features/incidents/draftEditCache.ts';
import { mapHomeTrip } from '../src/features/home/model.ts';
import {
  countUploadedCategories,
  mapDriverFiles,
  setupDocumentCategories,
  walkaroundPhotoCategories,
} from '../src/features/files/model.ts';

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

test('driver file categories count only successfully uploaded setup items', () => {
  const files = mapDriverFiles([
    {
      id: '10000000-0000-4000-8000-000000000001',
      category: 'cdl_front',
      object_path: 'org/user/file-one',
      media_type: 'document',
      size_bytes: 1200,
      captured_at: null,
      upload_status: 'uploaded',
      created_at: '2026-11-19T10:00:00Z',
    },
    {
      id: '10000000-0000-4000-8000-000000000002',
      category: 'cdl_front',
      object_path: 'org/user/file-two',
      media_type: 'document',
      size_bytes: 1200,
      captured_at: null,
      upload_status: 'failed',
      created_at: '2026-11-19T10:01:00Z',
    },
    {
      id: '10000000-0000-4000-8000-000000000003',
      category: 'walkaround_front',
      object_path: 'org/user/photo-one',
      media_type: 'image',
      size_bytes: 1200,
      captured_at: '2026-11-19T10:02:00Z',
      upload_status: 'uploaded',
      created_at: '2026-11-19T10:02:00Z',
    },
  ]);

  assert.equal(countUploadedCategories(files, setupDocumentCategories), 1);
  assert.equal(countUploadedCategories(files, walkaroundPhotoCategories), 1);
  assert.throws(() => mapDriverFiles([{ category: 'unknown' }]), /invalid/i);
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
    /changed on the server.*edits are preserved/,
  );
  await assert.rejects(
    saveIncidentAnswerWith(async () => ({
      data: null,
      error: { code: 'P0001', message: 'VALIDATION_FAILED' },
    }), args),
    /server rejected/i,
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

test('form parsing preserves repeated-group contracts and fields with identical keys in distinct groups', () => {
  const parsed = parseFormDefinition({
    sections: [{
      key: 'claimants',
      label: 'Claimants',
      fields: [
        {
          key: 'claimants',
          type: 'repeated_group',
          required: true,
          label: 'People involved',
          fields: [
            { key: 'name', type: 'text', required: true, label: 'Name' },
            { key: 'phone', type: 'phone', required: false, label: 'Phone' },
          ],
        },
        {
          key: 'witnesses',
          type: 'repeated_group',
          fields: [{ key: 'name', type: 'text', required: true, label: 'Witness name' }],
        },
      ],
    }],
  });

  assert.deepEqual(parsed.groups.map((group) => [group.key, group.label, group.required]), [
    ['claimants', 'People involved', true],
    ['witnesses', 'Witnesses', false],
  ]);
  assert.deepEqual(
    parsed.fields.map((field) => [field.key, field.groupKey]),
    [['name', 'claimants'], ['phone', 'claimants'], ['name', 'witnesses']],
  );
  assert.equal(findFieldDefinition({
    sections: [{
      key: 'claimants',
      type: 'repeated_group',
      fields: [{ key: 'name', type: 'text' }],
    }],
  }, 'name')?.groupKey, 'claimants');
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

test('date, date-time, email, and multi-select values reject malformed or duplicate input', () => {
  const fields = parseFormDefinition({
    fields: [
      { key: 'incident_date', type: 'date', required: true },
      { key: 'reported_at', type: 'datetime', required: true },
      { key: 'contact_email', type: 'email', required: false },
      {
        key: 'conditions',
        type: 'multi_enum',
        required: false,
        options: [
          { value: 'rain', label: { en: 'Rain' } },
          { value: 'dark', label: { en: 'Dark' } },
        ],
      },
    ],
  }).fields;

  assert.deepEqual(validateFieldValue(fields[0], '2026-02-28'), { ok: true, value: '2026-02-28' });
  assert.match(validateFieldValue(fields[0], '2026-02-31').error, /valid date/i);
  assert.deepEqual(
    validateFieldValue(fields[1], '2026-11-19T12:09:00.000Z'),
    { ok: true, value: '2026-11-19T12:09:00.000Z' },
  );
  assert.match(validateFieldValue(fields[1], '2026-11-19T27:09').error, /valid date and time/i);
  assert.deepEqual(validateFieldValue(fields[2], 'driver@example.com'), {
    ok: true,
    value: 'driver@example.com',
  });
  assert.match(validateFieldValue(fields[2], 'not-an-email').error, /valid email/i);
  assert.deepEqual(validateFieldValue(fields[3], ['rain', 'dark']), {
    ok: true,
    value: ['rain', 'dark'],
  });
  assert.match(validateFieldValue(fields[3], ['rain', 'rain']).error, /duplicate/i);
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

test('non-confirmed answer states persist as valueless versioned saves', async () => {
  const args = {
    p_incident_revision_id: revisionId,
    p_expected_version: 8,
    p_form_key: 'auto',
    p_field_key: 'injuries',
    p_group_instance_id: null,
    p_value: null,
    p_answer_state: 'pending_follow_up',
    p_source: 'manual',
    p_evidence_id: null,
  };
  let receivedArgs;
  const version = await saveIncidentAnswerWith(async (received) => {
    receivedArgs = received;
    return { data: 9, error: null };
  }, args);

  assert.equal(version, 9);
  assert.deepEqual(receivedArgs, args);
  await assert.rejects(
    saveIncidentAnswerWith(async () => ({ data: 9, error: null }), {
      ...args,
      p_value: 'unconfirmed text',
    }),
    /cannot include an answer value/,
  );
});

test('detail and repeated-group operations use the existing versioned RPC contracts', async () => {
  const detailsArgs = {
    p_incident_revision_id: revisionId,
    p_expected_version: 11,
    p_occurred_at: '2026-11-19T10:00:00.000Z',
    p_location: { label: 'Fictional test yard' },
  };
  let receivedDetails;
  assert.equal(await saveIncidentDetailsWith(async (args) => {
    receivedDetails = args;
    return { data: 12, error: null };
  }, detailsArgs), 12);
  assert.deepEqual(receivedDetails, detailsArgs);

  const groupArgs = {
    p_incident_revision_id: revisionId,
    p_expected_version: 12,
    p_form_key: 'general_liability',
    p_group_key: 'witnesses',
    p_position: 0,
  };
  let receivedGroup;
  assert.equal(await createIncidentAnswerGroupWith(async (args) => {
    receivedGroup = args;
    return { data: '30000000-0000-4000-8000-000000000001', error: null };
  }, groupArgs), '30000000-0000-4000-8000-000000000001');
  assert.deepEqual(receivedGroup, groupArgs);

  const deleteArgs = {
    p_incident_revision_id: revisionId,
    p_expected_version: 13,
    p_group_instance_id: '30000000-0000-4000-8000-000000000001',
  };
  let receivedDelete;
  assert.equal(await deleteIncidentAnswerGroupWith(async (args) => {
    receivedDelete = args;
    return { data: 14, error: null };
  }, deleteArgs), 14);
  assert.deepEqual(receivedDelete, deleteArgs);
});

test('photo evidence preparation and finalization preserve retry states', async () => {
  const createArgs = {
    p_incident_revision_id: revisionId,
    p_media_type: 'photo',
    p_size_bytes: 4096,
    p_description: 'Fictional scene photo',
  };
  let received;
  const prepared = await createIncidentEvidenceWith(async (args) => {
    received = args;
    return {
      data: {
        evidence_id: '30000000-0000-4000-8000-000000000002',
        object_path: 'org/revision/evidence',
        upload_status: 'pending',
        revision_version: 13,
      },
      error: null,
    };
  }, createArgs);
  assert.deepEqual(received, createArgs);
  assert.deepEqual(prepared, {
    evidenceId: '30000000-0000-4000-8000-000000000002',
    objectPath: 'org/revision/evidence',
    revisionVersion: 13,
  });

  assert.deepEqual(await finalizeIncidentEvidenceWith(async (args) => {
    assert.deepEqual(args, { p_evidence_id: prepared.evidenceId });
    return {
      data: { upload_status: 'failed', revision_version: 14, code: 'EVIDENCE_INVALID' },
      error: null,
    };
  }, prepared.evidenceId), { uploadStatus: 'failed', revisionVersion: 14 });

  assert.deepEqual(await finalizeIncidentEvidenceWith(async () => ({
    data: {
      evidence_id: prepared.evidenceId,
      upload_status: 'uploaded',
      revision_version: 14,
      idempotent: true,
    },
    error: null,
  }), prepared.evidenceId), { uploadStatus: 'uploaded', revisionVersion: 14 });
});

test('submission uses a stable confirmation reference for retry and surfaces server blockers', async () => {
  const args = {
    p_incident_revision_id: revisionId,
    p_expected_version: 15,
    p_signature_reference: '30000000-0000-4000-8000-000000000003',
    p_auth_method: 'biometric',
    p_device_description: 'ios 18 device',
  };
  const calls = [];
  const submitted = {
    status: 'submitted',
    incident_revision_id: revisionId,
    report_reference: 'JBL-TEST-1',
    version: 16,
  };
  const rpc = async (received) => {
    calls.push(received);
    return { data: submitted, error: null };
  };
  assert.deepEqual(await submitIncidentWith(rpc, args), {
    kind: 'submitted',
    revisionId,
    reportReference: 'JBL-TEST-1',
    status: 'submitted',
    version: 16,
  });
  assert.deepEqual(await submitIncidentWith(rpc, args), {
    kind: 'submitted',
    revisionId,
    reportReference: 'JBL-TEST-1',
    status: 'submitted',
    version: 16,
  });
  assert.deepEqual(calls, [args, args]);

  const blocked = await submitIncidentWith(async () => ({
    data: {
      code: 'VALIDATION_FAILED',
      incident_revision_id: revisionId,
      version: 15,
      issues: [{
        form_key: 'auto',
        field_key: 'injuries',
        group_instance_id: null,
        code: 'REQUIRED_FIELD_MISSING',
        label: 'Driver injured?',
        expected_type: 'enum',
        required: true,
        answer_state: 'unknown',
        action: 'answer_field',
        message: 'Complete this required field before submitting.',
        provenance: {
          source: 'manual',
          confidence: 1,
          evidence_id: null,
          transcript_turn_id: null,
        },
      }],
    },
    error: null,
  }), args);
  assert.deepEqual(blocked, {
    kind: 'blocked',
    revisionId,
    version: 15,
    issues: [{
      formKey: 'auto',
      fieldKey: 'injuries',
      groupInstanceId: null,
      code: 'REQUIRED_FIELD_MISSING',
      label: 'Driver injured?',
      expectedType: 'enum',
      required: true,
      answerState: 'unknown',
      expectedMediaType: null,
      requiredCount: null,
      uploadedCount: null,
      action: 'answer_field',
      message: 'Complete this required field before submitting.',
      provenance: {
        source: 'manual',
        confidence: 1,
        evidenceId: null,
        transcriptTurnId: null,
      },
    }],
  });

  const missingPhoto = await submitIncidentWith(async () => ({
    data: {
      code: 'VALIDATION_FAILED',
      incident_revision_id: revisionId,
      version: 15,
      issues: [{
        form_key: 'auto',
        field_key: '_evidence',
        group_instance_id: null,
        code: 'REQUIRED_EVIDENCE_MISSING',
        label: 'Incident photo',
        expected_media_type: 'photo',
        required_count: 2,
        uploaded_count: 0,
        action: 'capture_or_upload_evidence',
        message: 'Upload the required evidence before submitting.',
      }],
    },
    error: null,
  }), args);
  assert.equal(missingPhoto.kind, 'blocked');
  assert.equal(missingPhoto.issues[0].expectedMediaType, 'photo');
  assert.equal(missingPhoto.issues[0].requiredCount, 2);
  assert.equal(missingPhoto.issues[0].uploadedCount, 0);
  assert.equal(missingPhoto.issues[0].action, 'capture_or_upload_evidence');
});

test('submission readiness is pinned to the current revision and reports server blockers', async () => {
  const args = {
    p_incident_revision_id: revisionId,
    p_expected_version: 15,
  };
  assert.deepEqual(await checkIncidentSubmissionReadinessWith(async (received) => {
    assert.deepEqual(received, args);
    return {
      data: { status: 'ready', incident_revision_id: revisionId, version: 15 },
      error: null,
    };
  }, args), {
    kind: 'ready',
    revisionId,
    version: 15,
  });

  assert.deepEqual(await checkIncidentSubmissionReadinessWith(async () => ({
    data: {
      code: 'VALIDATION_FAILED',
      incident_revision_id: revisionId,
      version: 15,
      issues: [{
        form_key: 'auto',
        field_key: 'what_happened',
        group_instance_id: null,
        code: 'REQUIRED_FIELD_MISSING',
        label: 'Description of accident',
        action: 'answer_field',
      }],
    },
    error: null,
  }), args), {
    kind: 'blocked',
    revisionId,
    version: 15,
    issues: [{
      formKey: 'auto',
      fieldKey: 'what_happened',
      groupInstanceId: null,
      code: 'REQUIRED_FIELD_MISSING',
      label: 'Description of accident',
      expectedType: null,
      required: null,
      answerState: null,
      expectedMediaType: null,
      requiredCount: null,
      uploadedCount: null,
      action: 'answer_field',
      message: null,
      provenance: null,
    }],
  });
});

test('unsaved draft edits survive revision changes and confirmation references are valid UUIDs', () => {
  const cached = {
    expectedVersion: 4,
    dirtyFieldIds: ['["auto","what_happened"]'],
    values: { '["auto","what_happened"]': 'Local fictional detail' },
    updatedAt: '2026-11-19T10:00:00.000Z',
  };
  assert.deepEqual(resolveCachedDraftEdits(cached, 5), {
    kind: 'conflict',
    values: { '["auto","what_happened"]': 'Local fictional detail' },
    dirtyFieldIds: ['["auto","what_happened"]'],
    expectedVersion: 4,
    currentVersion: 5,
  });
  assert.deepEqual(resolveCachedDraftEdits(cached, 4), {
    kind: 'restore',
    values: { '["auto","what_happened"]': 'Local fictional detail' },
    dirtyFieldIds: ['["auto","what_happened"]'],
  });
  assert.match(createSignatureReference(() => 0), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
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

test('question-flow response parsing handles authored questions, options, and completion', () => {
  assert.deepEqual(
    parseNextQuestionResponse({
      selection_source: 'deterministic_fallback',
      interview_complete: false,
      selected_question: {
        field_key: 'injuries',
        form_key: 'auto',
        prompt: 'Was anyone hurt?',
        ui_type: 'single_select',
        required: true,
        answer_states: ['confirmed', 'unknown', 'declined', 'pending_follow_up'],
        options: [
          'No one',
          { value: 'driver', label: { en: 'The driver' } },
        ],
      },
    }),
    {
      kind: 'question',
      question: {
        formKey: 'auto',
        fieldKey: 'injuries',
        prompt: 'Was anyone hurt?',
        options: [
          { value: 'No one', label: 'No one' },
          { value: 'driver', label: 'The driver' },
        ],
        selectionSource: 'deterministic_fallback',
        required: true,
        answerStates: ['confirmed', 'unknown', 'declined', 'pending_follow_up'],
      },
    },
  );
  assert.deepEqual(
    parseNextQuestionResponse({ status: 'interview_complete' }),
    { kind: 'complete' },
  );
  assert.deepEqual(
    parseNextQuestionResponse({ interview_complete: true }),
    { kind: 'complete' },
  );
  assert.deepEqual(
    parseNextQuestionResponse({
      selected_question: {
        form_key: 'general_liability',
        field_key: 'property_owner',
        prompt: 'Who owns it?',
        required: false,
        answer_states: [
          'confirmed',
          'unknown',
          'declined',
          'pending_follow_up',
          'not_applicable',
        ],
      },
    }).kind,
    'question',
  );
  assert.throws(
    () => parseNextQuestionResponse({ next_question: { field_key: 'unknown' } }),
    /missing its pinned form, key, or authored prompt/,
  );
  assert.throws(
    () => parseNextQuestionResponse({ question: { options: 'invented' } }),
    /missing its pinned form, key, or authored prompt/,
  );
});

test('unmapped questions cannot infer or persist an arbitrary form association', () => {
  const parsed = parseNextQuestionResponse({
    selected_question: {
      field_key: 'injuries',
      form_key: null,
      prompt: 'Was anyone hurt?',
      required: true,
      answer_states: [],
    },
  });
  assert.equal(
    findPinnedQuestionMapping(parsed.question, [
      { formKey: 'auto', definition: { fields: [{ key: 'injuries' }] } },
      { formKey: 'workers_comp', definition: { fields: [{ key: 'injuries' }] } },
    ]),
    null,
  );
});

test('question-flow invocation uses the documented edge-function request bodies', async () => {
  const calls = [];
  const invoke = async (functionName, body) => {
    calls.push({ functionName, body });
    if (functionName === 'select-next-question') {
      return {
        data: {
          selected_question: {
            field_key: 'what_happened',
            form_key: 'auto',
            prompt: 'What happened?',
            required: true,
            answer_states: ['confirmed', 'unknown', 'declined', 'pending_follow_up'],
          },
          interview_complete: false,
        },
        error: null,
      };
    }
    return {
      data: { turn_id: 'turn-1', status: 'completed' },
      error: null,
    };
  };

  const selected = await selectNextQuestionWith(invoke, revisionId);
  const processed = await processIncidentTextTurnWith(invoke, {
    revisionId,
    clientTurnId: 'mobile-stable-retry-id',
    text: '  A fictional event occurred.  ',
  });

  assert.deepEqual(calls, [
    {
      functionName: 'select-next-question',
      body: { incident_revision_id: revisionId },
    },
    {
      functionName: 'process-incident-turn',
      body: {
        incident_revision_id: revisionId,
        client_turn_id: 'mobile-stable-retry-id',
        text: 'A fictional event occurred.',
      },
    },
  ]);
  assert.equal(selected.kind, 'question');
  assert.deepEqual(processed, { turnId: 'turn-1', status: 'completed' });
});

test('turn contract parsing rejects unaccepted and malformed responses instead of implying success', async () => {
  assert.deepEqual(
    parseProcessedTurnResponse({ turn_id: 'turn-2', status: 'processing' }),
    { turnId: 'turn-2', status: 'processing' },
  );
  assert.throws(
    () => parseProcessedTurnResponse({ turn_id: 'turn-3', status: 'failed' }),
    /did not confirm an accepted turn/,
  );
  await assert.rejects(
    processIncidentTextTurnWith(async () => ({
      data: null,
      error: { message: 'Edge Function returned 501 NOT_IMPLEMENTED' },
    }), {
      revisionId,
      clientTurnId: 'turn-retry',
      text: 'Fictional answer',
    }),
    /501 NOT_IMPLEMENTED/,
  );
  await assert.rejects(
    processIncidentTextTurnWith(async () => ({ data: null, error: null }), {
      revisionId,
      clientTurnId: 'turn-empty',
      text: '   ',
    }),
    /Enter an answer/,
  );
});

test('question answers map only to pinned fields and preserve authored option values', () => {
  const form = {
    formKey: 'auto',
    definition: parseFormDefinition({
      fields: [
        {
          key: 'injuries',
          type: 'enum',
          options: [
            { value: 'none', label: { en: 'No one' } },
            { value: 'driver', label: { en: 'The driver' } },
          ],
        },
      ],
    }),
  };
  const knownQuestion = {
    formKey: 'auto',
    fieldKey: 'injuries',
    prompt: 'Was anyone hurt?',
    options: [],
    selectionSource: null,
  };
  const field = findPinnedQuestionField(knownQuestion, [form]);

  assert.equal(field?.key, 'injuries');
  assert.equal(questionAnswerText(field, 'driver'), 'The driver');
  assert.equal(findPinnedQuestionField({
    ...knownQuestion,
    fieldKey: 'not_in_the_pinned_definition',
  }, [form]), null);
  assert.equal(findPinnedQuestionField({ ...knownQuestion, formKey: null }, [
    form,
    { formKey: 'workers_comp', definition: form.definition },
  ]), null);
});

test('client turn IDs are non-empty and distinct for independent submissions', () => {
  const first = createClientTurnId();
  const second = createClientTurnId();
  assert.match(first, /^mobile-/);
  assert.notEqual(first, second);
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
    vehicle_id: '22222222-2222-2222-2222-222222222221',
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
