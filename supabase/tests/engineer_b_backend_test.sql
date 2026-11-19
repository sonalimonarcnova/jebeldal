begin;
create extension if not exists pgtap with schema extensions;
select plan(54);

insert into public.organizations (id, display_name, legal_name, locale)
values ('44444444-4444-4444-4444-444444444444', 'Other Fictional Fleet', 'Other Fleet LLC', 'en')
on conflict (id) do nothing;

insert into auth.users (id, email)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'driver1@test.jebel.local'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'driver2@test.jebel.local'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'driver3@test.jebel.local')
on conflict (id) do nothing;

insert into public.profiles (user_id, organization_id, role, display_name, profile_completed_at)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '11111111-1111-1111-1111-111111111111', 'driver', 'Alex Driver', timezone('utc', now())),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', '11111111-1111-1111-1111-111111111111', 'driver', 'Casey Driver', timezone('utc', now())),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', '44444444-4444-4444-4444-444444444444', 'driver', 'Jordan Driver', timezone('utc', now()))
on conflict (user_id) do nothing;

insert into public.form_definitions (form_key, version, status, definition)
values
  ('auto', 1, 'active', '{"fields":[
    {"key":"what_happened","type":"long_text","required":true},
    {"key":"property_damaged","type":"boolean","required":true},
    {"key":"delivery_work","type":"boolean","required":true},
    {"key":"other_vehicle","type":"boolean","required":true},
    {"key":"injuries","type":"boolean","required":true},
    {"key":"police","type":"boolean","required":true},
    {"key":"police_report_no","type":"text","requiredWhen":{"op":"eq","field_key":"police","value":true}},
    {"key":"involved_people","type":"repeated_group","fields":[
      {"key":"person_name","type":"text","required":true},
      {"key":"injured","type":"boolean","required":true},
      {"key":"injury_details","type":"text","requiredWhen":{"op":"eq","field_key":"injured","value":true}}
    ]}
  ],"requiredEvidence":[{"field_key":"incident_photos","media_type":"photo","minimum":1,"when":{"any":[
    {"op":"eq","field_key":"property_damaged","value":true},
    {"op":"eq","field_key":"injuries","value":true}
  ]}}]}'::jsonb),
  ('general_liability', 1, 'active', '{"fields":[
    {"key":"delivery_description","type":"long_text","required":true}
  ]}'::jsonb),
  ('workers_comp', 1, 'active', '{"fields":[
    {"key":"injury_description","type":"long_text","required":true}
  ]}'::jsonb)
on conflict (form_key, version) do update
set status = excluded.status, definition = excluded.definition;

set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1","role":"authenticated"}';

select ok(
  has_table_privilege('authenticated', 'public.incidents', 'select'),
  'authenticated drivers can read reports subject to RLS'
);
select ok(
  not has_table_privilege('authenticated', 'public.incidents', 'update'),
  'authenticated drivers cannot directly update report state'
);
select throws_ok(
  $$update public.profiles set role = 'manager' where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'$$,
  '42501', null, 'drivers cannot change their role'
);
select throws_ok(
  $$update public.incidents set status = 'submitted'$$,
  '42501', null, 'drivers cannot directly submit reports'
);

select set_config('test.revision_id', public.create_incident_draft()::text, true);

select is(
  (select version from public.incident_revisions where id = current_setting('test.revision_id')::uuid),
  1, 'new draft starts at version one'
);
select is(
  public.submit_incident(current_setting('test.revision_id')::uuid, 1,
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc1', 'device_passcode', 'pgTAP device')->>'code',
  'VALIDATION_FAILED', 'empty report is blocked with field-keyed validation'
);
select ok(
  public.submit_incident(current_setting('test.revision_id')::uuid, 1,
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc1', 'device_passcode', 'pgTAP device')->'issues'
    @> '[{"form_key":"auto","field_key":"what_happened","code":"REQUIRED_FIELD_MISSING"}]'::jsonb,
  'Review receives field-keyed missing-answer issues'
);
select ok(
  (select submitted_snapshot is null from public.incident_revisions
   where id = current_setting('test.revision_id')::uuid),
  'blocked submit leaves the draft unchanged'
);
select is(
  public.save_incident_answer(current_setting('test.revision_id')::uuid, 1,
    'auto', 'what_happened', null, to_jsonb('Bollard contact; no injury'::text),
    'confirmed', 'manual', null),
  2, 'saving an answer advances the revision version'
);
select is(
  public.save_incident_answer(current_setting('test.revision_id')::uuid, 2,
    'auto', 'what_happened', null, to_jsonb('Bollard contact; no injury'::text),
    'confirmed', 'manual', null),
  3, 'answer upsert advances the version on edit'
);
select is(
  (select count(*)::integer from public.incident_answers
   where incident_revision_id = current_setting('test.revision_id')::uuid
     and form_key = 'auto' and field_key = 'what_happened' and group_instance_id is null),
  1, 'nullable scalar answer key remains unique after repeated upsert'
);
select throws_ok(
  $$select public.save_incident_answer(current_setting('test.revision_id')::uuid, 2,
    'auto', 'what_happened', null, to_jsonb('stale'::text), 'confirmed', 'manual', null)$$,
  'P0001', 'STALE_VERSION', 'stale answer write is rejected'
);

select set_config('test.turn_one', public.begin_incident_turn(
  current_setting('test.revision_id')::uuid, 'client-turn-1', 'typed narrative', null, 'en'
)->>'turn_id', true);
select is(
  public.begin_incident_turn(current_setting('test.revision_id')::uuid,
    'client-turn-1', 'typed narrative', null, 'en')->>'turn_id',
  current_setting('test.turn_one'), 'turn retry returns the original persisted turn'
);
select is(
  (select count(*)::integer from public.conversation_turns
   where incident_revision_id = current_setting('test.revision_id')::uuid
     and client_turn_id = 'client-turn-1'),
  1, 'turn retry does not create a duplicate row'
);
select throws_ok(
  $$select public.begin_incident_turn(current_setting('test.revision_id')::uuid,
    'client-turn-1', 'different narrative', null, 'en')$$,
  'P0001', 'TURN_ID_REUSED', 'same turn id cannot be reused for different input'
);
select throws_ok(
  $$select public.submit_incident(current_setting('test.revision_id')::uuid, 3,
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc2', 'device_passcode', 'pgTAP device')$$,
  'P0001', 'STALE_VERSION', 'submit rejects a stale expected revision version'
);

set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2","role":"authenticated"}';
select is_empty(
  $$select id from public.incidents where reporter_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'$$,
  'another driver in the same organization cannot read the report'
);
set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1","role":"authenticated"}';
select is_empty(
  $$select id from public.incidents where reporter_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'$$,
  'a driver in another organization cannot read the report'
);
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1","role":"authenticated"}';
select is(
  public.save_incident_answer(current_setting('test.revision_id')::uuid, 4,
    'auto', 'property_damaged', null, 'true'::jsonb, 'confirmed', 'manual', null),
  5, 'confirmed third-party property damage is persisted'
);
select is(
  (select activation_status from public.incident_revision_forms
   where incident_revision_id = current_setting('test.revision_id')::uuid
     and form_key = 'general_liability'),
  'triggered', 'property damage activates General Liability'
);
select is(
  public.save_incident_answer(current_setting('test.revision_id')::uuid, 5,
    'general_liability', 'delivery_description', null, to_jsonb('Temporary property branch'::text),
    'confirmed', 'manual', null),
  6, 'a visible GL branch answer is saved'
);
select is(
  public.save_incident_answer(current_setting('test.revision_id')::uuid, 6,
    'auto', 'property_damaged', null, 'false'::jsonb, 'confirmed', 'manual', null),
  7, 'editing an earlier answer advances the branch revision'
);
select public.save_incident_answer(current_setting('test.revision_id')::uuid, 7,
  'auto', 'delivery_work', null, 'false'::jsonb, 'confirmed', 'manual', null);
select public.save_incident_answer(current_setting('test.revision_id')::uuid, 8,
  'auto', 'injuries', null, 'false'::jsonb, 'confirmed', 'manual', null);
select public.save_incident_answer(current_setting('test.revision_id')::uuid, 9,
  'auto', 'other_vehicle', null, 'false'::jsonb, 'confirmed', 'manual', null);
select public.save_incident_answer(current_setting('test.revision_id')::uuid, 10,
  'auto', 'police', null, 'false'::jsonb, 'confirmed', 'manual', null);
select is(
  (select activation_status from public.incident_revision_forms
   where incident_revision_id = current_setting('test.revision_id')::uuid
     and form_key = 'general_liability'),
  'not_triggered', 'editing the trigger recomputes form activation'
);
select is(
  (select count(*)::integer from public.incident_answers
   where incident_revision_id = current_setting('test.revision_id')::uuid
     and form_key = 'general_liability' and field_key = 'delivery_description'),
  1, 'hidden branch answer is retained for draft recovery'
);
reset role;
update public.profiles
set profile_completed_at = null
where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1","role":"authenticated"}';
select throws_ok(
  $$select public.submit_incident(current_setting('test.revision_id')::uuid, 11,
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', 'device_passcode', 'pgTAP device')$$,
  'P0001', 'PROFILE_INCOMPLETE', 'incomplete profile cannot submit a complete report'
);
select public.complete_driver_profile();
select is(
  public.submit_incident(current_setting('test.revision_id')::uuid, 11,
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc1', 'device_passcode', 'pgTAP device')->>'status',
  'submitted', 'complete bollard/no-injury Auto report submits'
);
select ok(
  (select submitted_snapshot->'answers' @> '[{"field_key":"what_happened","value":"Bollard contact; no injury"}]'::jsonb
   from public.incident_revisions where id = current_setting('test.revision_id')::uuid),
  'submitted projection includes ordinary fields without visibility rules'
);
select ok(
  not (select submitted_snapshot->'answers' @> '[{"field_key":"delivery_description"}]'::jsonb
   from public.incident_revisions where id = current_setting('test.revision_id')::uuid),
  'hidden branch answer is excluded from submitted projection'
);
select is(
  public.submit_incident(current_setting('test.revision_id')::uuid, 11,
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc1', 'device_passcode', 'pgTAP device')->>'report_reference',
  (select report_reference from public.incident_revisions
   where id = current_setting('test.revision_id')::uuid),
  'duplicate submit returns the original report reference'
);
select throws_ok(
  $$select public.submit_incident(current_setting('test.revision_id')::uuid, 11,
    'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', 'device_passcode', 'other device')$$,
  'P0001', 'INCIDENT_NOT_DRAFT', 'a second confirmation cannot create another submission'
);
select throws_ok(
  $$select public.submit_incident(current_setting('test.revision_id')::uuid, 10,
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc1', 'device_passcode', 'pgTAP device')$$,
  'P0001', 'SIGNATURE_REFERENCE_REUSED', 'confirmation reference is bound to the saved revision version'
);
select throws_ok(
  $$select public.save_incident_answer(current_setting('test.revision_id')::uuid, 8,
    'auto', 'what_happened', null, to_jsonb('late edit'::text), 'confirmed', 'manual', null)$$,
  'P0001', 'INCIDENT_NOT_DRAFT', 'submitted report cannot be edited through the save API'
);

select set_config('test.delivery_revision', public.create_incident_draft()::text, true);
select public.save_incident_answer(current_setting('test.delivery_revision')::uuid, 1,
  'auto', 'delivery_work', null, 'true'::jsonb, 'confirmed', 'manual', null);
select is(
  (select activation_status from public.incident_revision_forms
   where incident_revision_id = current_setting('test.delivery_revision')::uuid
     and form_key = 'general_liability'),
  'triggered', 'delivery-only claim activates General Liability per workbook D-07'
);
select public.save_incident_answer(current_setting('test.delivery_revision')::uuid, 2,
  'auto', 'other_vehicle', null, 'true'::jsonb, 'confirmed', 'manual', null);
select is(
  (select activation_status from public.incident_revision_forms
   where incident_revision_id = current_setting('test.delivery_revision')::uuid
     and form_key = 'general_liability'),
  'triggered', 'delivery plus another vehicle remains on the GL path'
);

select set_config('test.injury_revision', public.create_incident_draft()::text, true);
select public.save_incident_answer(current_setting('test.injury_revision')::uuid, 1,
  'auto', 'what_happened', null, to_jsonb('Injury while unloading'::text),
  'confirmed', 'manual', null);
select public.save_incident_answer(current_setting('test.injury_revision')::uuid, 2,
  'auto', 'injuries', null, 'true'::jsonb, 'confirmed', 'manual', null);
select is(
  (select activation_status from public.incident_revision_forms
   where incident_revision_id = current_setting('test.injury_revision')::uuid
     and form_key = 'workers_comp'),
  'triggered', 'unloading injury activates Workers Compensation'
);
select is(
  public.submit_incident(current_setting('test.injury_revision')::uuid, 3,
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', 'biometric', 'pgTAP device')->>'code',
  'VALIDATION_FAILED', 'unloading injury is blocked until required WC details are saved'
);
select ok(
  public.submit_incident(current_setting('test.injury_revision')::uuid, 3,
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', 'biometric', 'pgTAP device')->'issues'
    @> '[{"form_key":"auto","field_key":"incident_photos","code":"REQUIRED_EVIDENCE_MISSING"}]'::jsonb,
  'injury report also blocks until its required uploaded photo is present'
);

select set_config('test.rear_revision', public.create_incident_draft()::text, true);
select public.save_incident_answer(current_setting('test.rear_revision')::uuid, 1,
  'auto', 'what_happened', null, to_jsonb('Rear-end collision on I-35; police attended'::text),
  'confirmed', 'manual', null);
select public.save_incident_answer(current_setting('test.rear_revision')::uuid, 2,
  'auto', 'property_damaged', null, 'false'::jsonb, 'confirmed', 'manual', null);
select public.save_incident_answer(current_setting('test.rear_revision')::uuid, 3,
  'auto', 'delivery_work', null, 'false'::jsonb, 'confirmed', 'manual', null);
select public.save_incident_answer(current_setting('test.rear_revision')::uuid, 4,
  'auto', 'injuries', null, 'false'::jsonb, 'confirmed', 'manual', null);
select public.save_incident_answer(current_setting('test.rear_revision')::uuid, 5,
  'auto', 'other_vehicle', null, 'true'::jsonb, 'confirmed', 'manual', null);
select public.save_incident_answer(current_setting('test.rear_revision')::uuid, 6,
  'auto', 'police', null, 'true'::jsonb, 'confirmed', 'manual', null);
select public.save_incident_answer(current_setting('test.rear_revision')::uuid, 7,
  'auto', 'police_report_no', null, to_jsonb('No number yet'::text),
  'confirmed', 'manual', null);
select is(
  (select activation_status from public.incident_revision_forms
   where incident_revision_id = current_setting('test.rear_revision')::uuid
     and form_key = 'general_liability'),
  'not_triggered', 'rear-end with another vehicle but no property/delivery claim stays Auto-only'
);
select is(
  (select activation_status from public.incident_revision_forms
   where incident_revision_id = current_setting('test.rear_revision')::uuid
     and form_key = 'workers_comp'),
  'not_triggered', 'rear-end no-injury report does not activate Workers Compensation'
);
select is(
  public.submit_incident(current_setting('test.rear_revision')::uuid, 8,
    'ffffffff-ffff-4fff-8fff-fffffffffff1', 'device_passcode', 'pgTAP device')->>'status',
  'submitted', 'rear-end/police report submits after its conditional police number is saved'
);

select ok(
  not has_table_privilege('authenticated', 'public.evidence', 'insert,update'),
  'drivers cannot directly insert or update evidence metadata'
);
select ok(
  not has_table_privilege('authenticated', 'public.signatures', 'insert,update'),
  'drivers cannot directly create or alter signature stamps'
);

select set_config('test.storage_revision', public.create_incident_draft()::text, true);
select set_config('test.evidence_payload', public.create_incident_evidence(
  current_setting('test.storage_revision')::uuid, 'photo', 123, 'fictional test photo'
)::text, true);
select set_config('test.evidence_id',
  (current_setting('test.evidence_payload')::jsonb->>'evidence_id'), true);
select set_config('test.object_path',
  (current_setting('test.evidence_payload')::jsonb->>'object_path'), true);

reset role;
insert into storage.objects (bucket_id, name, owner, metadata)
values (
  'incident-evidence', current_setting('test.object_path'),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  '{"mimetype":"image/jpeg","size":"123"}'::jsonb
);
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1","role":"authenticated"}';
select results_eq(
  $$update storage.objects set metadata = metadata || '{"retry":true}'::jsonb
    where name = current_setting('test.object_path') returning name$$,
  array[current_setting('test.object_path')],
  'owner may replace a pending draft upload for retry'
);
select is(
  public.finalize_incident_evidence(current_setting('test.evidence_id')::uuid)->>'upload_status',
  'uploaded', 'finalize verifies the stored object metadata and marks evidence uploaded'
);
select is(
  (select count(*)::integer from storage.objects where name = current_setting('test.object_path')),
  1, 'evidence owner can read the uploaded object through RLS'
);
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2","role":"authenticated"}';
select is_empty(
  $$select name from storage.objects where name = current_setting('test.object_path')$$,
  'same-organization driver cannot read another driver evidence object'
);
select is_empty(
  $$select id from public.evidence where id = current_setting('test.evidence_id')::uuid$$,
  'same-organization driver cannot read another driver evidence metadata'
);
set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1","role":"authenticated"}';
select is_empty(
  $$select name from storage.objects where name = current_setting('test.object_path')$$,
  'cross-organization driver cannot read another driver evidence object'
);

set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1","role":"authenticated"}';
select public.save_incident_answer(current_setting('test.storage_revision')::uuid, 3,
  'auto', 'what_happened', null, to_jsonb('No-injury photo report'::text),
  'confirmed', 'manual', null);
select public.save_incident_answer(current_setting('test.storage_revision')::uuid, 4,
  'auto', 'property_damaged', null, 'false'::jsonb, 'confirmed', 'manual', null);
select public.save_incident_answer(current_setting('test.storage_revision')::uuid, 5,
  'auto', 'delivery_work', null, 'false'::jsonb, 'confirmed', 'manual', null);
select public.save_incident_answer(current_setting('test.storage_revision')::uuid, 6,
  'auto', 'injuries', null, 'false'::jsonb, 'confirmed', 'manual', null);
select public.save_incident_answer(current_setting('test.storage_revision')::uuid, 7,
  'auto', 'other_vehicle', null, 'false'::jsonb, 'confirmed', 'manual', null);
select public.save_incident_answer(current_setting('test.storage_revision')::uuid, 8,
  'auto', 'police', null, 'false'::jsonb, 'confirmed', 'manual', null);
select is(
  public.submit_incident(current_setting('test.storage_revision')::uuid, 9,
    '99999999-9999-4999-8999-999999999991', 'device_passcode', 'pgTAP device')->>'status',
  'submitted', 'evidence-backed report submits atomically'
);
select results_eq(
  $$update storage.objects set metadata = metadata || '{"replaced":true}'::jsonb
    where name = current_setting('test.object_path') returning name$$,
  array[]::text[],
  'uploaded evidence cannot be replaced after completion or submission'
);
select is(
  (select metadata->>'retry' from storage.objects where name = current_setting('test.object_path')),
  'true', 'denied post-submit replacement leaves the stored object unchanged'
);

select set_config('test.group_revision', public.create_incident_draft()::text, true);
select set_config('test.group_one', public.create_incident_answer_group(
  current_setting('test.group_revision')::uuid, 1, 'auto', 'involved_people', 0
)::text, true);
select set_config('test.group_two', public.create_incident_answer_group(
  current_setting('test.group_revision')::uuid, 2, 'auto', 'involved_people', 1
)::text, true);
select public.save_incident_answer(current_setting('test.group_revision')::uuid, 3,
  'auto', 'person_name', current_setting('test.group_one')::uuid,
  to_jsonb('Riley Passenger'::text), 'confirmed', 'manual', null);
select public.save_incident_answer(current_setting('test.group_revision')::uuid, 4,
  'auto', 'injured', current_setting('test.group_one')::uuid,
  'true'::jsonb, 'confirmed', 'manual', null);
select public.save_incident_answer(current_setting('test.group_revision')::uuid, 5,
  'auto', 'person_name', current_setting('test.group_two')::uuid,
  to_jsonb('Morgan Passenger'::text), 'confirmed', 'manual', null);
select public.save_incident_answer(current_setting('test.group_revision')::uuid, 6,
  'auto', 'injured', current_setting('test.group_two')::uuid,
  'false'::jsonb, 'confirmed', 'manual', null);
select public.save_incident_answer(current_setting('test.group_revision')::uuid, 7,
  'auto', 'what_happened', null, to_jsonb('Fictional two-person report'::text),
  'confirmed', 'manual', null);
select public.save_incident_answer(current_setting('test.group_revision')::uuid, 8,
  'auto', 'property_damaged', null, 'false'::jsonb, 'confirmed', 'manual', null);
select public.save_incident_answer(current_setting('test.group_revision')::uuid, 9,
  'auto', 'delivery_work', null, 'false'::jsonb, 'confirmed', 'manual', null);
select public.save_incident_answer(current_setting('test.group_revision')::uuid, 10,
  'auto', 'injuries', null, 'false'::jsonb, 'confirmed', 'manual', null);
select public.save_incident_answer(current_setting('test.group_revision')::uuid, 11,
  'auto', 'other_vehicle', null, 'false'::jsonb, 'confirmed', 'manual', null);
select public.save_incident_answer(current_setting('test.group_revision')::uuid, 12,
  'auto', 'police', null, 'false'::jsonb, 'confirmed', 'manual', null);
select ok(
  public.submit_incident(current_setting('test.group_revision')::uuid, 13,
    '88888888-8888-4888-8888-888888888881', 'device_passcode', 'pgTAP device')->'issues'
    @> jsonb_build_array(jsonb_build_object(
      'form_key', 'auto', 'field_key', 'injury_details',
      'group_instance_id', current_setting('test.group_one')::uuid,
      'code', 'REQUIRED_FIELD_MISSING'
    )),
  'requiredWhen is evaluated against each repeated-group member'
);
select public.save_incident_answer(current_setting('test.group_revision')::uuid, 13,
  'auto', 'injury_details', current_setting('test.group_one')::uuid,
  to_jsonb('Fictional bruised shoulder'::text), 'confirmed', 'manual', null);
select is(
  public.submit_incident(current_setting('test.group_revision')::uuid, 14,
    '88888888-8888-4888-8888-888888888881', 'device_passcode', 'pgTAP device')->>'status',
  'submitted', 'non-injured group member does not need injury details'
);
select is(
  (select count(*)::integer
   from public.incident_revisions ir
   cross join lateral jsonb_array_elements(ir.submitted_snapshot->'answers') answer
   where ir.id = current_setting('test.group_revision')::uuid
     and answer->>'field_key' = 'injury_details'),
  1, 'submitted repeated-group projection preserves the applicable child answer'
);

select * from finish();
rollback;