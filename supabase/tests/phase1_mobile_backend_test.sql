begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into public.organizations (id, display_name, legal_name, locale)
values (
	'55555555-5555-4555-8555-555555555555',
	'Phase One Fictional Fleet',
	'Phase One Fictional Fleet LLC',
	'en'
);

insert into auth.users (id, email)
values
	('55555555-5555-4555-8555-555555555551', 'phase1-driver@test.jebel.local'),
	('55555555-5555-4555-8555-555555555552', 'phase1-other@test.jebel.local');

insert into public.profiles (user_id, organization_id, role, display_name)
values
	('55555555-5555-4555-8555-555555555551',
	 '55555555-5555-4555-8555-555555555555', 'driver', 'Alex Phase One'),
	('55555555-5555-4555-8555-555555555552',
	 '55555555-5555-4555-8555-555555555555', 'driver', 'Casey Phase One');

insert into public.form_sets (form_set_key, version, definition)
values ('phase1_validation', 1, '{"forms":["phase1_auto"]}'::jsonb);

insert into public.form_definitions (form_key, version, definition, status)
values (
	'phase1_auto',
	1,
	'{"fields":[
		{"key":"narrative","type":"long_text","required":true,"validation":{"minLength":1,"maxLength":80}},
		{"key":"injured","type":"boolean","required":true},
		{"key":"severity","type":"enum","options":[
			{"value":"low","label":{"en":"Low"}},
			{"value":"high","label":{"en":"High"}}
		]},
		{"key":"concerns","type":"multi_enum","options":[
			{"value":"property","label":{"en":"Property"}},
			{"value":"injury","label":{"en":"Injury"}}
		]},
		{"key":"people","type":"repeated_group","fields":[
			{"key":"name","type":"text","required":true}
		]}
	]}'::jsonb,
	'active'
);

set local role authenticated;
set local request.jwt.claim.sub = '55555555-5555-4555-8555-555555555551';
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555551","role":"authenticated"}';

select set_config(
	'test.phase1_revision',
	public.create_incident_draft('phase1_validation', 1, 'en')::text,
	true
);

select is(
	(select version from public.incident_revisions
	 where id = current_setting('test.phase1_revision')::uuid),
	1,
	'phase-one draft starts at version one'
);

select is(
	public.save_incident_answer(
		current_setting('test.phase1_revision')::uuid, 1, 'phase1_auto', 'narrative',
		null, to_jsonb('Fictional training-yard event'::text), 'confirmed', 'manual', null
	),
	2,
	'definition-backed text answer saves and advances the revision'
);

select throws_ok(
	$$select public.save_incident_answer(
		current_setting('test.phase1_revision')::uuid, 2, 'phase1_auto', 'unknown_key',
		null, to_jsonb('value'::text), 'confirmed', 'manual', null
	)$$,
	'P0001', 'VALIDATION_FAILED',
	'unknown field key is rejected'
);

select throws_ok(
	$$select public.save_incident_answer(
		current_setting('test.phase1_revision')::uuid, 2, 'phase1_auto', 'injured',
		null, to_jsonb('yes'::text), 'confirmed', 'manual', null
	)$$,
	'P0001', 'VALIDATION_FAILED',
	'boolean field rejects a string value'
);

select throws_ok(
	$$select public.save_incident_answer(
		current_setting('test.phase1_revision')::uuid, 2, 'phase1_auto', 'severity',
		null, to_jsonb('critical'::text), 'confirmed', 'manual', null
	)$$,
	'P0001', 'VALIDATION_FAILED',
	'enum rejects values outside the pinned options'
);

select is(
	public.save_incident_answer(
		current_setting('test.phase1_revision')::uuid, 2, 'phase1_auto', 'severity',
		null, to_jsonb('high'::text), 'confirmed', 'manual', null
	),
	3,
	'enum accepts a value from the pinned options'
);

select throws_ok(
	$$select public.save_incident_answer(
		current_setting('test.phase1_revision')::uuid, 3, 'phase1_auto', 'concerns',
		null, '["property","unknown"]'::jsonb, 'confirmed', 'manual', null
	)$$,
	'P0001', 'VALIDATION_FAILED',
	'multi-enum rejects an option outside the pinned definition'
);

select is(
	public.save_incident_answer(
		current_setting('test.phase1_revision')::uuid, 3, 'phase1_auto', 'concerns',
		null, '["property","injury"]'::jsonb, 'confirmed', 'manual', null
	),
	4,
	'multi-enum accepts values from the pinned options'
);

select set_config(
	'test.phase1_group',
	public.create_incident_answer_group(
		current_setting('test.phase1_revision')::uuid, 4, 'phase1_auto', 'people', 0
	)::text,
	true
);

select ok(
	nullif(current_setting('test.phase1_group'), '') is not null,
	'definition-backed repeated group can be created'
);

select is(
	public.save_incident_answer(
		current_setting('test.phase1_revision')::uuid, 5, 'phase1_auto', 'name',
		current_setting('test.phase1_group')::uuid, to_jsonb('Fictional witness'::text),
		'confirmed', 'manual', null
	),
	6,
	'repeated-group child accepts a matching group instance'
);

select set_config(
	'test.phase1_wrong_group',
	public.create_incident_answer_group(
		current_setting('test.phase1_revision')::uuid, 6, 'phase1_auto', 'other_people', 0
	)::text,
	true
);

select throws_ok(
	$$select public.save_incident_answer(
		current_setting('test.phase1_revision')::uuid, 7, 'phase1_auto', 'name',
		current_setting('test.phase1_wrong_group')::uuid,
		to_jsonb('Fictional witness'::text), 'confirmed', 'manual', null
	)$$,
	'P0001', 'VALIDATION_FAILED',
	'repeated-group child rejects an instance from a different group'
);

select ok(
	public.complete_driver_profile() is not null,
	'driver can persist profile completion through the authenticated RPC'
);

select is(
	public.complete_driver_profile(),
	(select profile_completed_at from public.profiles
	 where user_id = '55555555-5555-4555-8555-555555555551'),
	'profile completion is idempotent'
);

set local request.jwt.claim.sub = '55555555-5555-4555-8555-555555555552';
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555552","role":"authenticated"}';

select throws_ok(
	$$select public.save_incident_answer(
		current_setting('test.phase1_revision')::uuid, 7, 'phase1_auto', 'narrative',
		null, to_jsonb('Fictional unauthorized edit'::text), 'confirmed', 'manual', null
	)$$,
	'P0001', 'NOT_ALLOWED',
	'other driver cannot save an answer to the draft'
);

select * from finish();
rollback;
