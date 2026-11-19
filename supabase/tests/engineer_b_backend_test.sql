begin;
create extension if not exists pgtap with schema extensions;
select plan(104);

create function pg_temp.capture_save_validation(
	p_revision_id uuid,
	p_version integer,
	p_form_key text,
	p_field_key text,
	p_value jsonb
)
returns jsonb
language plpgsql
as $$
declare
	v_detail text;
begin
	perform public.save_incident_answer(
		p_revision_id, p_version, p_form_key, p_field_key, null, p_value,
		'confirmed', 'manual', null
	);
	return null;
exception
	when sqlstate 'P0001' then
		get stacked diagnostics v_detail = pg_exception_detail;
		return v_detail::jsonb;
end;
$$;

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
    {"key":"optional_note","type":"text","required":false},
    {"key":"property_damaged","type":"boolean","required":true},
    {"key":"delivery_work","type":"boolean","required":true},
    {"key":"involved","type":"multi_enum","required":true,"options":[
      {"value":"another_vehicle","label":{"en":"Another vehicle"}},
      {"value":"object","label":{"en":"Object"}},
      {"value":"delivery_claim","label":{"en":"Delivery claim"}},
      {"value":"just_my_truck","label":{"en":"Just my truck"}}
    ]},
    {"key":"other_vehicle","type":"boolean","required":true},
    {"key":"injuries","type":"enum","required":false,"options":[
      {"value":"no_one","label":{"en":"No one"}},
      {"value":"me","label":{"en":"Yes, me"}},
      {"value":"someone_else","label":{"en":"Someone else"}},
      {"value":"me_and_someone","label":{"en":"Me and someone else"}}
    ]},
    {"key":"police","type":"boolean","required":true},
    {"key":"police_report_no","type":"text","requiredWhen":{"op":"eq","field_key":"police","value":true}},
    {"key":"involved_people","type":"repeated_group","fields":[
      {"key":"person_name","type":"text","required":true},
      {"key":"injured","type":"boolean","required":true},
      {"key":"injury_details","type":"text","requiredWhen":{"op":"eq","field_key":"injured","value":true}}
    ]}
  ],"requiredEvidence":[{"field_key":"incident_photos","media_type":"photo","minimum":1,"when":{"any":[
    {"op":"contains_any","field_key":"involved","values":["object","delivery_claim"]},
    {"op":"in","field_key":"injuries","values":["me","someone_else","me_and_someone"]}
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
  public.submit_incident(current_setting('test.revision_id')::uuid, 1,
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc1', 'device_passcode', 'pgTAP device')->'issues'
    @> '[{"form_key":"auto","field_key":"what_happened","label":"what_happened","expected_type":"long_text","required":true,"action":"answer_field","message":"Complete this required field before submitting."}]'::jsonb,
  'readiness issues expose actionable field metadata'
);
select is(
  public.check_incident_submission_readiness(
    current_setting('test.revision_id')::uuid, 1
  )->>'code',
  'VALIDATION_FAILED', 'readiness check reports the same server-side blockers as submit'
);
select is(
  (select version from public.incident_revisions
   where id = current_setting('test.revision_id')::uuid),
  1, 'blocked readiness check does not change the draft version'
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

select set_config('test.skip_revision', public.create_incident_draft()::text, true);
select is(
  public.save_incident_answer(current_setting('test.skip_revision')::uuid, 1,
    'auto', 'what_happened', null, null, 'unknown', 'manual', null),
  2, 'saving an unknown skip persists it and advances the revision'
);
select is(
  (select answer_state from public.incident_answers
   where incident_revision_id = current_setting('test.skip_revision')::uuid
     and form_key = 'auto' and field_key = 'what_happened'),
  'unknown', 'the skipped answer retains its explicit unknown state'
);
select ok(
  (select value is null or value = 'null'::jsonb from public.incident_answers
   where incident_revision_id = current_setting('test.skip_revision')::uuid
     and form_key = 'auto' and field_key = 'what_happened'),
  'a non-confirmed skip has no answer value'
);
select throws_ok(
  $$select public.save_incident_answer(current_setting('test.skip_revision')::uuid, 1,
    'auto', 'what_happened', null, null, 'declined', 'manual', null)$$,
  'P0001', 'STALE_VERSION', 'a stale skipped-answer write is rejected'
);
select is(
  public.submit_incident(current_setting('test.skip_revision')::uuid, 2,
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc3', 'device_passcode', 'pgTAP device')->>'code',
  'VALIDATION_FAILED', 'a required skipped answer still blocks submission'
);
select ok(
  public.submit_incident(current_setting('test.skip_revision')::uuid, 2,
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc3', 'device_passcode', 'pgTAP device')->'issues'
    @> '[{"form_key":"auto","field_key":"what_happened","code":"REQUIRED_FIELD_MISSING"}]'::jsonb,
  'submission identifies the required skipped answer as a blocker'
);
select ok(
  public.submit_incident(current_setting('test.skip_revision')::uuid, 2,
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc3', 'device_passcode', 'pgTAP device')->'issues'
    @> '[{"field_key":"what_happened","answer_state":"unknown","provenance":{"source":"manual"}}]'::jsonb,
  'readiness reports the saved non-confirmed state and provenance'
);
select throws_ok(
  $$select public.save_incident_answer(current_setting('test.skip_revision')::uuid, 2,
    'auto', 'what_happened', null, null, 'not_applicable', 'manual', null)$$,
  'P0001', 'VALIDATION_FAILED', 'a required field cannot be marked not applicable'
);
select is(
  public.save_incident_answer(current_setting('test.skip_revision')::uuid, 2,
    'auto', 'optional_note', null, null, 'not_applicable', 'manual', null),
  3, 'an optional field accepts a valueless not-applicable status'
);
select ok(
  pg_temp.capture_save_validation(
    current_setting('test.skip_revision')::uuid, 3,
    'auto', 'optional_note', '42'::jsonb
  ) @> '{"code":"FIELD_VALIDATION_FAILED","form_key":"auto","field_key":"optional_note","expected_type":"text","supplied_type":"number"}'::jsonb,
  'typed field errors include actionable expected and supplied types'
);
select throws_ok(
  $$select public.save_incident_answer(current_setting('test.skip_revision')::uuid, 3,
    'auto', 'optional_note', null, to_jsonb('not applicable'::text),
    'not_applicable', 'manual', null)$$,
  'P0001', 'VALIDATION_FAILED', 'not-applicable cannot carry a value'
);
select is(
  public.save_incident_answer(current_setting('test.skip_revision')::uuid, 3,
    'auto', 'injuries', null, null, 'unknown', 'manual', null),
  4, 'saving unknown on a safety-critical injury question advances the revision'
);
select ok(
  public.submit_incident(current_setting('test.skip_revision')::uuid, 4,
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc4', 'device_passcode', 'pgTAP device')->'issues'
    @> '[{"form_key":"auto","field_key":"injuries","code":"REQUIRED_FIELD_MISSING"}]'::jsonb,
  'a non-confirmed safety-critical injury answer blocks submission'
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
select is_empty(
  $$select id from public.incident_revisions
    where id = current_setting('test.revision_id')::uuid$$,
  'another driver in the same organization cannot read its revision projection'
);
select is_empty(
  $$select incident_revision_id from public.incident_revision_forms
    where incident_revision_id = current_setting('test.revision_id')::uuid$$,
  'another driver in the same organization cannot read its pinned form projection'
);
select is_empty(
  $$select id from public.incident_answers
    where incident_revision_id = current_setting('test.revision_id')::uuid$$,
  'another driver in the same organization cannot read its answer projection'
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
  'not_triggered', 'property detail alone does not provisionally activate General Liability'
);
select is(
  public.save_incident_answer(current_setting('test.revision_id')::uuid, 5,
    'auto', 'involved', null, '["object"]'::jsonb, 'confirmed', 'manual', null),
  6, 'a confirmed object multi-select persists without detail dependency'
);
select is(
  (select activation_status from public.incident_revision_forms
   where incident_revision_id = current_setting('test.revision_id')::uuid
     and form_key = 'general_liability'),
  'triggered', 'confirmed object selection activates General Liability immediately'
);
select is(
  public.save_incident_answer(current_setting('test.revision_id')::uuid, 6,
    'general_liability', 'delivery_description', null, to_jsonb('Temporary property branch'::text),
    'confirmed', 'manual', null),
  7, 'a visible GL branch answer is saved'
);
select is(
  public.save_incident_answer(current_setting('test.revision_id')::uuid, 7,
    'auto', 'property_damaged', null, 'false'::jsonb, 'confirmed', 'manual', null),
  8, 'editing a detail answer advances the branch revision'
);
select public.save_incident_answer(current_setting('test.revision_id')::uuid, 8,
  'auto', 'involved', null, '["just_my_truck"]'::jsonb, 'confirmed', 'manual', null);
select public.save_incident_answer(current_setting('test.revision_id')::uuid, 9,
  'auto', 'delivery_work', null, 'false'::jsonb, 'confirmed', 'manual', null);
select public.save_incident_answer(current_setting('test.revision_id')::uuid, 10,
  'auto', 'injuries', null, to_jsonb('no_one'::text), 'confirmed', 'manual', null);
select public.save_incident_answer(current_setting('test.revision_id')::uuid, 11,
  'auto', 'other_vehicle', null, 'false'::jsonb, 'confirmed', 'manual', null);
select public.save_incident_answer(current_setting('test.revision_id')::uuid, 12,
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
  $$select public.submit_incident(current_setting('test.revision_id')::uuid, 13,
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', 'device_passcode', 'pgTAP device')$$,
  'P0001', 'PROFILE_INCOMPLETE', 'incomplete profile cannot submit a complete report'
);
select public.complete_driver_profile();
select is(
  public.submit_incident(current_setting('test.revision_id')::uuid, 13,
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
  public.submit_incident(current_setting('test.revision_id')::uuid, 13,
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc1', 'device_passcode', 'pgTAP device')->>'report_reference',
  (select report_reference from public.incident_revisions
   where id = current_setting('test.revision_id')::uuid),
  'duplicate submit returns the original report reference'
);
select throws_ok(
  $$select public.submit_incident(current_setting('test.revision_id')::uuid, 13,
    'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', 'device_passcode', 'other device')$$,
  'P0001', 'INCIDENT_NOT_DRAFT', 'a second confirmation cannot create another submission'
);
select throws_ok(
  $$select public.submit_incident(current_setting('test.revision_id')::uuid, 12,
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
  'auto', 'involved', null, '["delivery_claim"]'::jsonb, 'confirmed', 'manual', null);
select is(
  (select activation_status from public.incident_revision_forms
   where incident_revision_id = current_setting('test.delivery_revision')::uuid
     and form_key = 'general_liability'),
  'triggered', 'confirmed delivery-claim selection activates General Liability'
);
select is(
  (select count(*)::integer from public.incident_answers
   where incident_revision_id = current_setting('test.delivery_revision')::uuid
     and form_key = 'auto' and field_key = 'delivery_work'),
  0, 'GL activation does not require the delivery detail answer'
);
select ok(
  public.submit_incident(
    current_setting('test.delivery_revision')::uuid, 2,
    '77777777-7777-4777-8777-777777777772', 'device_passcode', 'pgTAP device'
  )->'issues' @> '[{"field_key":"incident_photos","expected_media_type":"photo"}]'::jsonb,
  'confirmed involved selection requires property evidence without detail answers'
);

select set_config('test.unconfirmed_involved_revision', public.create_incident_draft()::text, true);
select public.save_incident_answer(
  current_setting('test.unconfirmed_involved_revision')::uuid, 1,
  'auto', 'involved', null, '["object","delivery_claim"]'::jsonb,
  'unknown', 'manual', null
);
select is(
  (select activation_status from public.incident_revision_forms
   where incident_revision_id = current_setting('test.unconfirmed_involved_revision')::uuid
     and form_key = 'general_liability'),
  'not_triggered', 'a non-confirmed involved array does not activate General Liability'
);
select ok(
  not (public.submit_incident(
    current_setting('test.unconfirmed_involved_revision')::uuid, 2,
    '77777777-7777-4777-8777-777777777771', 'device_passcode', 'pgTAP device'
  )->'issues' @> '[{"field_key":"incident_photos"}]'::jsonb),
  'a non-confirmed involved array does not require property photos'
);

select set_config('test.injury_revision', public.create_incident_draft()::text, true);
select public.save_incident_answer(current_setting('test.injury_revision')::uuid, 1,
  'auto', 'what_happened', null, to_jsonb('Injury while unloading'::text),
  'confirmed', 'manual', null);
select public.save_incident_answer(current_setting('test.injury_revision')::uuid, 2,
  'auto', 'injuries', null, to_jsonb('me'::text), 'confirmed', 'manual', null);
select public.save_incident_answer(current_setting('test.injury_revision')::uuid, 3,
  'auto', 'involved', null, '["just_my_truck"]'::jsonb, 'confirmed', 'manual', null);
select is(
  (select activation_status from public.incident_revision_forms
   where incident_revision_id = current_setting('test.injury_revision')::uuid
     and form_key = 'workers_comp'),
  'triggered', 'unloading injury activates Workers Compensation'
);
select is(
  public.submit_incident(current_setting('test.injury_revision')::uuid, 4,
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', 'biometric', 'pgTAP device')->>'code',
  'VALIDATION_FAILED', 'unloading injury is blocked until required WC details are saved'
);
select ok(
  public.submit_incident(current_setting('test.injury_revision')::uuid, 4,
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', 'biometric', 'pgTAP device')->'issues'
    @> '[{"form_key":"auto","field_key":"incident_photos","code":"REQUIRED_EVIDENCE_MISSING"}]'::jsonb,
  'injury report also blocks until its required uploaded photo is present'
);
select ok(
  public.submit_incident(current_setting('test.injury_revision')::uuid, 4,
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', 'biometric', 'pgTAP device')->'issues'
    @> '[{"field_key":"incident_photos","expected_media_type":"photo","required_count":1,"uploaded_count":0,"action":"capture_or_upload_evidence"}]'::jsonb,
  'evidence blockers report required media, count, and client action'
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
  'auto', 'injuries', null, to_jsonb('no_one'::text), 'confirmed', 'manual', null);
select public.save_incident_answer(current_setting('test.rear_revision')::uuid, 5,
  'auto', 'other_vehicle', null, 'true'::jsonb, 'confirmed', 'manual', null);
select public.save_incident_answer(current_setting('test.rear_revision')::uuid, 6,
  'auto', 'police', null, 'true'::jsonb, 'confirmed', 'manual', null);
select public.save_incident_answer(current_setting('test.rear_revision')::uuid, 7,
  'auto', 'police_report_no', null, to_jsonb('No number yet'::text),
  'confirmed', 'manual', null);
select public.save_incident_answer(current_setting('test.rear_revision')::uuid, 8,
  'auto', 'involved', null, '["another_vehicle"]'::jsonb, 'confirmed', 'manual', null);
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
  public.submit_incident(current_setting('test.rear_revision')::uuid, 9,
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
  public.finalize_incident_evidence(current_setting('test.evidence_id')::uuid)->>'idempotent',
  'true', 'finalizing uploaded evidence again does not mutate the revision'
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
  'auto', 'injuries', null, to_jsonb('no_one'::text), 'confirmed', 'manual', null);
select public.save_incident_answer(current_setting('test.storage_revision')::uuid, 7,
  'auto', 'other_vehicle', null, 'false'::jsonb, 'confirmed', 'manual', null);
select public.save_incident_answer(current_setting('test.storage_revision')::uuid, 8,
  'auto', 'police', null, 'false'::jsonb, 'confirmed', 'manual', null);
select public.save_incident_answer(current_setting('test.storage_revision')::uuid, 9,
  'auto', 'involved', null, '["just_my_truck"]'::jsonb, 'confirmed', 'manual', null);
select is(
  public.submit_incident(current_setting('test.storage_revision')::uuid, 10,
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

select ok(
  not has_table_privilege('authenticated', 'public.user_files', 'insert,update'),
  'drivers cannot directly insert or update user-file metadata'
);
select set_config('test.user_file_payload', public.create_user_file(
  'walkaround_front', 'image', 123, timezone('utc', now()),
  '{"capture":"manual"}'::jsonb
)::text, true);
select is(
  current_setting('test.user_file_payload')::jsonb->>'upload_status',
  'pending', 'user-file creation returns pending metadata before upload'
);
select is(
  (select count(*)::integer from public.user_files
   where id = (current_setting('test.user_file_payload')::jsonb->>'user_file_id')::uuid
     and user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
     and organization_id = '11111111-1111-1111-1111-111111111111'),
  1, 'user-file metadata is bound to the authenticated owner and organization'
);
reset role;
insert into storage.objects (bucket_id, name, owner, metadata)
values (
  'driver-files',
  current_setting('test.user_file_payload')::jsonb->>'object_path',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  '{"mimetype":"image/jpeg","size":"123"}'::jsonb
);
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1","role":"authenticated"}';
select is(
  public.finalize_user_file(
    (current_setting('test.user_file_payload')::jsonb->>'user_file_id')::uuid
  )->>'upload_status',
  'uploaded', 'finalization verifies and completes the user-file upload'
);
select is(
  public.finalize_user_file(
    (current_setting('test.user_file_payload')::jsonb->>'user_file_id')::uuid
  )->>'idempotent',
  'true', 'user-file finalization retry is idempotent'
);
select is(
  (select count(*)::integer from public.user_files
   where id = (current_setting('test.user_file_payload')::jsonb->>'user_file_id')::uuid
     and upload_status = 'uploaded'),
  1, 'owner can read finalized file metadata'
);
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2","role":"authenticated"}';
select is_empty(
  $$select id from public.user_files
    where id = (current_setting('test.user_file_payload')::jsonb->>'user_file_id')::uuid$$,
  'same-organization driver cannot read another driver file metadata'
);
select is_empty(
  $$select name from storage.objects
    where name = current_setting('test.user_file_payload')::jsonb->>'object_path'$$,
  'same-organization driver cannot read another driver file object'
);
set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1","role":"authenticated"}';
select is_empty(
  $$select id from public.user_files
    where id = (current_setting('test.user_file_payload')::jsonb->>'user_file_id')::uuid$$,
  'cross-organization driver cannot read user-file metadata'
);
select is_empty(
  $$select name from storage.objects
    where name = current_setting('test.user_file_payload')::jsonb->>'object_path'$$,
  'cross-organization driver cannot read the user-file object'
);
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1","role":"authenticated"}';
select results_eq(
  $$update storage.objects set metadata = metadata || '{"replaced":true}'::jsonb
    where name = current_setting('test.user_file_payload')::jsonb->>'object_path'
    returning name$$,
  array[]::text[],
  'finalized user-file object cannot be replaced'
);
select set_config('test.invalid_user_file_payload', public.create_user_file(
  'registration', 'document', 234
)::text, true);
reset role;
insert into storage.objects (bucket_id, name, owner, metadata)
values (
  'driver-files',
  current_setting('test.invalid_user_file_payload')::jsonb->>'object_path',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  '{"mimetype":"image/jpeg","size":"234"}'::jsonb
);
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1","role":"authenticated"}';
select is(
  public.finalize_user_file(
    (current_setting('test.invalid_user_file_payload')::jsonb->>'user_file_id')::uuid
  )->>'reason',
  'MIME_TYPE_MISMATCH', 'finalization rejects a document uploaded with an image MIME type'
);
select results_eq(
  $$update storage.objects set metadata = '{"mimetype":"application/pdf","size":"234"}'::jsonb
    where name = current_setting('test.invalid_user_file_payload')::jsonb->>'object_path'
    returning name$$,
  array[current_setting('test.invalid_user_file_payload')::jsonb->>'object_path'],
  'failed user-file upload can be replaced for retry'
);
select is(
  public.finalize_user_file(
    (current_setting('test.invalid_user_file_payload')::jsonb->>'user_file_id')::uuid
  )->>'upload_status',
  'uploaded', 'valid retry finalizes after the MIME check succeeds'
);

select set_config('test.delete_group_revision', public.create_incident_draft()::text, true);
select throws_ok(
  $$select public.create_incident_answer_group(
    current_setting('test.delete_group_revision')::uuid, 1, 'auto', 'unknown_group', 0
  )$$,
  'P0001', 'VALIDATION_FAILED', 'group creation rejects keys absent from the pinned definition'
);
select set_config('test.delete_group_one', public.create_incident_answer_group(
  current_setting('test.delete_group_revision')::uuid, 1, 'auto', 'involved_people', 0
)::text, true);
select is(
  public.save_incident_answer(current_setting('test.delete_group_revision')::uuid, 2,
    'auto', 'person_name', current_setting('test.delete_group_one')::uuid,
    to_jsonb('Fictional group member'::text), 'confirmed', 'manual', null),
  3, 'a repeated item answer advances its revision'
);
select is(
  public.delete_incident_answer_group(
    current_setting('test.delete_group_revision')::uuid, 3,
    current_setting('test.delete_group_one')::uuid
  ),
  4, 'removing a repeated item advances its revision'
);
select is(
  (select count(*)::integer from public.incident_answers
   where incident_revision_id = current_setting('test.delete_group_revision')::uuid
     and group_instance_id = current_setting('test.delete_group_one')::uuid),
  0, 'removing a repeated item deletes its child answers'
);
select is(
  (select count(*)::integer from public.incident_answer_groups
   where incident_revision_id = current_setting('test.delete_group_revision')::uuid
     and id = current_setting('test.delete_group_one')::uuid),
  0, 'removing a repeated item deletes only its group row'
);
select throws_ok(
  $$select public.delete_incident_answer_group(
    current_setting('test.delete_group_revision')::uuid, 3,
    current_setting('test.delete_group_one')::uuid
  )$$,
  'P0001', 'STALE_VERSION', 'stale repeated-item removal is rejected'
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
  'auto', 'injuries', null, to_jsonb('no_one'::text), 'confirmed', 'manual', null);
select public.save_incident_answer(current_setting('test.group_revision')::uuid, 11,
  'auto', 'other_vehicle', null, 'false'::jsonb, 'confirmed', 'manual', null);
select public.save_incident_answer(current_setting('test.group_revision')::uuid, 12,
  'auto', 'police', null, 'false'::jsonb, 'confirmed', 'manual', null);
select public.save_incident_answer(current_setting('test.group_revision')::uuid, 13,
  'auto', 'involved', null, '["just_my_truck"]'::jsonb, 'confirmed', 'manual', null);
select ok(
  public.submit_incident(current_setting('test.group_revision')::uuid, 14,
    '88888888-8888-4888-8888-888888888881', 'device_passcode', 'pgTAP device')->'issues'
    @> jsonb_build_array(jsonb_build_object(
      'form_key', 'auto', 'field_key', 'injury_details',
      'group_instance_id', current_setting('test.group_one')::uuid,
      'code', 'REQUIRED_FIELD_MISSING'
    )),
  'requiredWhen is evaluated against each repeated-group member'
);
select public.save_incident_answer(current_setting('test.group_revision')::uuid, 14,
  'auto', 'injury_details', current_setting('test.group_one')::uuid,
  to_jsonb('Fictional bruised shoulder'::text), 'confirmed', 'manual', null);
select is(
  public.check_incident_submission_readiness(
    current_setting('test.group_revision')::uuid, 15
  )->>'status',
  'ready', 'readiness check reports a complete revision as ready'
);
select is(
  (select status from public.incident_revisions
   where id = current_setting('test.group_revision')::uuid),
  'draft', 'ready preview does not submit the incident'
);
select is(
  (select version from public.incident_revisions
   where id = current_setting('test.group_revision')::uuid),
  15, 'ready preview rolls back all version changes'
);
select is(
  (select count(*)::integer from public.signatures
   where incident_revision_id = current_setting('test.group_revision')::uuid),
  0, 'ready preview does not persist a confirmation signature'
);
select is(
  public.submit_incident(current_setting('test.group_revision')::uuid, 15,
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