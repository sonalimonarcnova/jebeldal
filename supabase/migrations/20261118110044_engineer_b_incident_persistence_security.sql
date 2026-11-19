create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
	new.updated_at = pg_catalog.timezone('utc', pg_catalog.now());
	return new;
end;
$$;

alter table public.organizations
	add column if not exists business_address jsonb;
alter table public.organizations
	add column if not exists dot_number text;
alter table public.organizations
	add column if not exists mc_number text;

alter table public.profiles
	add column if not exists employee_id text;
alter table public.profiles
	add column if not exists profile_completed_at timestamptz;
alter table public.vehicles
	add column if not exists gvwr numeric(10,2);
alter table public.vehicles
	add column if not exists vehicle_class text;
alter table public.vehicles
	add column if not exists cargo_attributes jsonb not null default '{}'::jsonb;
alter table public.incident_revisions
	add column if not exists report_reference text;
alter table public.conversation_turns
	add column if not exists audio_evidence_id uuid;
alter table public.conversation_turns
	add column if not exists input_hash text;
alter table public.conversation_turns
	add column if not exists language text not null default 'en';
alter table public.incident_answers
	add column if not exists evidence_id uuid;
alter table public.evidence
	add column if not exists description text;
alter table public.evidence
	add column if not exists updated_at timestamptz not null default timezone('utc', now());
alter table public.signatures
	add column if not exists confirmation_reference uuid;
alter table public.signatures
	add column if not exists revision_version integer;
alter table public.signatures
	add column if not exists report_reference text;

update public.signatures s
set confirmation_reference = coalesce(s.confirmation_reference, gen_random_uuid()),
		revision_version = coalesce(s.revision_version, ir.version),
		report_reference = coalesce(s.report_reference, ir.report_reference,
			'JBL-' || upper(substr(replace(ir.id::text, '-', ''), 1, 10)))
from public.incident_revisions ir
where ir.id = s.incident_revision_id;
alter table public.signatures alter column confirmation_reference set not null;
alter table public.signatures alter column revision_version set not null;
alter table public.signatures alter column report_reference set not null;
create unique index if not exists signatures_confirmation_reference_key
	on public.signatures (confirmation_reference);

alter table public.profiles
	add constraint profiles_user_organization_key unique (user_id, organization_id);
alter table public.vehicles
	add constraint vehicles_id_organization_key unique (id, organization_id);

create table if not exists public.policies (
	id uuid primary key default gen_random_uuid(),
	organization_id uuid not null references public.organizations(id) on delete cascade,
	policy_number text not null,
	carrier_name text,
	naic_number text,
	agent jsonb not null default '{}'::jsonb,
	effective_from date,
	effective_to date,
	coverage jsonb not null default '{}'::jsonb,
	created_at timestamptz not null default timezone('utc', now()),
	unique (organization_id, policy_number),
	unique (id, organization_id)
);

create table if not exists public.trip_records (
	id uuid primary key default gen_random_uuid(),
	organization_id uuid not null references public.organizations(id) on delete cascade,
	driver_id uuid not null,
	vehicle_id uuid,
	started_at timestamptz,
	ended_at timestamptz,
	route jsonb not null default '{}'::jsonb,
	purpose text,
	hours_of_service jsonb not null default '{}'::jsonb,
	dvir_summary jsonb not null default '{}'::jsonb,
	created_at timestamptz not null default timezone('utc', now()),
	unique (id, organization_id),
	foreign key (driver_id, organization_id)
		references public.profiles(user_id, organization_id) on delete cascade,
	foreign key (vehicle_id, organization_id)
		references public.vehicles(id, organization_id) on delete set null (vehicle_id)
);

create table if not exists public.incident_revision_forms (
	incident_revision_id uuid not null references public.incident_revisions(id) on delete cascade,
	form_key text not null,
	form_version integer not null check (form_version > 0),
	activation_status text not null default 'not_triggered'
		check (activation_status in ('triggered', 'not_triggered')),
	updated_at timestamptz not null default timezone('utc', now()),
	primary key (incident_revision_id, form_key)
);

create table if not exists public.user_files (
	id uuid primary key default gen_random_uuid(),
	organization_id uuid not null,
	user_id uuid not null,
	category text not null check (category in (
		'cdl_front', 'cdl_back', 'medical_card', 'registration',
		'insurance_card', 'walkaround_front', 'walkaround_driver_side',
		'walkaround_rear', 'walkaround_passenger_side'
	)),
	object_path text not null unique,
	media_type text not null check (media_type in ('image', 'document')),
	size_bytes bigint check (size_bytes > 0 and size_bytes <= 52428800),
	captured_at timestamptz,
	location jsonb,
	upload_status text not null default 'pending'
		check (upload_status in ('pending', 'uploaded', 'failed')),
	created_at timestamptz not null default timezone('utc', now()),
	updated_at timestamptz not null default timezone('utc', now()),
	foreign key (user_id, organization_id)
		references public.profiles(user_id, organization_id) on delete cascade
);

alter table public.incidents
	add constraint incidents_id_organization_key unique (id, organization_id);
alter table public.incident_revisions
	add constraint incident_revisions_id_organization_key unique (id, organization_id);
alter table public.incident_revisions
	add constraint incident_revisions_incident_id_key unique (incident_id, id);
alter table public.incident_answer_groups
	add constraint incident_answer_groups_id_revision_key unique (id, incident_revision_id);
alter table public.conversation_turns
	add constraint conversation_turns_id_revision_key unique (id, incident_revision_id);
alter table public.evidence
	add constraint evidence_id_revision_key unique (id, incident_revision_id);

alter table public.profiles
	drop constraint if exists profiles_assigned_vehicle_id_fkey;
alter table public.profiles
	add constraint profiles_assigned_vehicle_org_fkey
	foreign key (assigned_vehicle_id, organization_id)
	references public.vehicles(id, organization_id)
	on delete set null (assigned_vehicle_id) not valid;
alter table public.profiles validate constraint profiles_assigned_vehicle_org_fkey;

alter table public.incident_revisions
	drop constraint if exists incident_revisions_incident_id_fkey;
alter table public.incident_revisions
	add constraint incident_revisions_incident_org_fkey
	foreign key (incident_id, organization_id)
	references public.incidents(id, organization_id)
	on delete cascade not valid;
alter table public.incident_revisions validate constraint incident_revisions_incident_org_fkey;

alter table public.evidence
	drop constraint if exists evidence_incident_revision_id_fkey;
alter table public.evidence
	add constraint evidence_revision_org_fkey
	foreign key (incident_revision_id, organization_id)
	references public.incident_revisions(id, organization_id)
	on delete cascade not valid;
alter table public.evidence validate constraint evidence_revision_org_fkey;
alter table public.evidence
	add constraint evidence_uploader_org_fkey
	foreign key (uploaded_by, organization_id)
	references public.profiles(user_id, organization_id)
	on delete restrict not valid;
alter table public.evidence validate constraint evidence_uploader_org_fkey;

alter table public.incident_answer_groups
	drop constraint if exists incident_answer_groups_incident_revision_id_fkey;
alter table public.incident_answer_groups
	add constraint answer_groups_revision_fkey
	foreign key (incident_revision_id)
	references public.incident_revisions(id) on delete cascade not valid;
alter table public.incident_answer_groups validate constraint answer_groups_revision_fkey;
alter table public.incident_answers
	drop constraint if exists incident_answers_group_instance_id_fkey;
alter table public.incident_answers
	add constraint answers_group_revision_fkey
	foreign key (group_instance_id, incident_revision_id)
	references public.incident_answer_groups(id, incident_revision_id)
	on delete set null (group_instance_id) not valid;
alter table public.incident_answers validate constraint answers_group_revision_fkey;
alter table public.incident_answers
	add constraint answers_evidence_revision_fkey
	foreign key (evidence_id, incident_revision_id)
	references public.evidence(id, incident_revision_id)
	on delete set null (evidence_id) not valid;
alter table public.incident_answers validate constraint answers_evidence_revision_fkey;
alter table public.conversation_turns
	add constraint turns_audio_evidence_revision_fkey
	foreign key (audio_evidence_id, incident_revision_id)
	references public.evidence(id, incident_revision_id)
	on delete set null (audio_evidence_id) not valid;
alter table public.conversation_turns validate constraint turns_audio_evidence_revision_fkey;
alter table public.incident_answers
	add constraint answers_transcript_turn_revision_fkey
	foreign key (transcript_turn_id, incident_revision_id)
	references public.conversation_turns(id, incident_revision_id)
	on delete set null (transcript_turn_id) not valid;
alter table public.incident_answers validate constraint answers_transcript_turn_revision_fkey;

with ranked_answers as (
	select id,
		row_number() over (
			partition by incident_revision_id, form_key, field_key, group_instance_id
			order by updated_at desc, id desc
		) as duplicate_rank
	from public.incident_answers
)
delete from public.incident_answers a
using ranked_answers r
where a.id = r.id and r.duplicate_rank > 1;

alter table public.incident_answers
	drop constraint if exists incident_answers_incident_revision_id_form_key_field_key_group_instance_id_key;
create unique index if not exists incident_answers_scalar_unique
	on public.incident_answers (incident_revision_id, form_key, field_key)
	where group_instance_id is null;
create unique index if not exists incident_answers_group_unique
	on public.incident_answers (incident_revision_id, form_key, field_key, group_instance_id)
	where group_instance_id is not null;

create index if not exists idx_incidents_owner_status
	on public.incidents (reporter_id, status, updated_at desc);
create index if not exists idx_trip_records_driver_start
	on public.trip_records (driver_id, started_at desc);
create index if not exists idx_user_files_owner_category
	on public.user_files (user_id, category);
create index if not exists idx_revision_forms_status
	on public.incident_revision_forms (incident_revision_id, activation_status);

create or replace function public.current_organization_id()
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
	select p.organization_id
	from public.profiles p
	where p.user_id = (select auth.uid())
		and p.role = 'driver'
$$;

create or replace function private.answer_value(
	p_revision_id uuid,
	p_form_key text,
	p_field_key text,
	p_group_instance_id uuid default null
)
returns jsonb
language sql
stable
set search_path = ''
as $$
	select a.value
	from public.incident_answers a
	where a.incident_revision_id = p_revision_id
		and a.form_key = p_form_key
		and a.field_key = p_field_key
		and a.group_instance_id is not distinct from p_group_instance_id
		and a.answer_state = 'confirmed'
	limit 1
$$;

create or replace function private.condition_matches(
	p_revision_id uuid,
	p_form_key text,
	p_condition jsonb,
	p_group_instance_id uuid default null
)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
	v_item jsonb;
	v_value jsonb;
	v_op text;
begin
	if p_condition is null or p_condition = 'null'::jsonb then
		return false;
	end if;

	if p_condition ? 'all' then
		for v_item in select value from jsonb_array_elements(p_condition->'all') loop
			if not private.condition_matches(p_revision_id, p_form_key, v_item, p_group_instance_id) then
				return false;
			end if;
		end loop;
		return true;
	end if;

	if p_condition ? 'any' then
		for v_item in select value from jsonb_array_elements(p_condition->'any') loop
			if private.condition_matches(p_revision_id, p_form_key, v_item, p_group_instance_id) then
				return true;
			end if;
		end loop;
		return false;
	end if;

	v_op := p_condition->>'op';
	v_value := private.answer_value(
		p_revision_id, p_form_key, p_condition->>'field_key', p_group_instance_id
	);
	if v_op = 'exists' then
		return v_value is not null and v_value <> 'null'::jsonb;
	elsif v_op = 'eq' then
		return v_value is not null and v_value = p_condition->'value';
	elsif v_op = 'in' then
		return v_value is not null
			and jsonb_typeof(p_condition->'values') = 'array'
			and (p_condition->'values') @> jsonb_build_array(v_value);
	end if;

	raise exception using errcode = 'P0001', message = 'INVALID_FORM_RULE';
end;
$$;

create or replace function private.definition_fields(p_definition jsonb)
returns table (
	field_key text,
	group_key text,
	is_group boolean,
	is_required boolean,
	visible_when jsonb,
	required_when jsonb,
	evidence_requirement text,
	definition jsonb
)
language sql
immutable
set search_path = ''
as $$
	with recursive walk(node, parent_group_key) as (
		select p_definition, null::text
		union all
		select child.node,
			case when walk.node->>'type' = 'repeated_group'
				then walk.node->>'key' else walk.parent_group_key end
		from walk
		cross join lateral (
			select value as node
			from jsonb_array_elements(
				case when jsonb_typeof(walk.node->'fields') = 'array'
					then walk.node->'fields' else '[]'::jsonb end
			)
			union all
			select value as node
			from jsonb_array_elements(
				case when jsonb_typeof(walk.node->'sections') = 'array'
					then walk.node->'sections' else '[]'::jsonb end
			)
		) child
	)
	select node->>'key', parent_group_key,
		node->>'type' = 'repeated_group',
		coalesce((node->>'required')::boolean, false),
		node->'visibleWhen', node->'requiredWhen',
		node->>'evidenceRequirement', node
	from walk
	where jsonb_typeof(node) = 'object' and node ? 'key'
$$;

create or replace function private.find_field(p_definition jsonb, p_field_key text)
returns jsonb
language sql
stable
set search_path = ''
as $$
	select f.definition
	from private.definition_fields(p_definition) f
	where f.field_key = p_field_key
	limit 1
$$;

create or replace function private.recompute_revision_forms(p_revision_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_revision public.incident_revisions%rowtype;
	v_form_set jsonb;
	v_form_key text;
	v_form_version integer;
	v_active boolean;
	v_rule jsonb;
begin
	select * into v_revision
	from public.incident_revisions
	where id = p_revision_id;

	select fs.definition into v_form_set
	from public.form_sets fs
	where fs.form_set_key = v_revision.form_set_key
		and fs.version = v_revision.form_set_version;

	if v_form_set is null then
		raise exception using errcode = 'P0001', message = 'FORM_SET_MISSING';
	end if;

	for v_form_key in
		select value from jsonb_array_elements_text(v_form_set->'forms')
	loop
		select coalesce(rf.form_version, (
			select max(fd.version) from public.form_definitions fd
			where fd.form_key = v_form_key and fd.status in ('active', 'archived')
		), 1)
		into v_form_version
		from (select 1) seed
		left join public.incident_revision_forms rf
			on rf.incident_revision_id = p_revision_id and rf.form_key = v_form_key;

		v_rule := v_form_set->'activation_rules'->v_form_key;
		if v_form_key = 'auto' then
			v_active := true;
		elsif v_rule is not null then
			v_active := private.condition_matches(p_revision_id, 'auto', v_rule);
		elsif v_form_key in ('general_liability', 'gl') then
			v_active := private.condition_matches(p_revision_id, 'auto', jsonb_build_object(
				'any', jsonb_build_array(
					jsonb_build_object('op', 'eq', 'field_key', 'property_damaged', 'value', true),
					jsonb_build_object('op', 'eq', 'field_key', 'delivery_work', 'value', true)
				)
			));
		elsif v_form_key in ('workers_comp', 'wc') then
			v_active := private.condition_matches(p_revision_id, 'auto', jsonb_build_object(
				'op', 'eq', 'field_key', 'injuries', 'value', true
			));
		else
			v_active := false;
		end if;

		insert into public.incident_revision_forms (
			incident_revision_id, form_key, form_version, activation_status
		) values (
			p_revision_id, v_form_key, v_form_version,
			case when v_active then 'triggered' else 'not_triggered' end
		)
		on conflict (incident_revision_id, form_key) do update
			set activation_status = excluded.activation_status,
					updated_at = timezone('utc', now());
	end loop;
end;
$$;

create or replace function public.create_incident_draft(
	p_form_set_key text default 'default',
	p_form_set_version integer default 1,
	p_language text default 'en'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_user_id uuid := auth.uid();
	v_org_id uuid;
	v_incident_id uuid;
	v_revision_id uuid;
begin
	if v_user_id is null then
		raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
	end if;

	select p.organization_id into v_org_id
	from public.profiles p
	where p.user_id = v_user_id and p.role = 'driver';
	if v_org_id is null then
		raise exception using errcode = 'P0001', message = 'NOT_ALLOWED';
	end if;
	if p_language not in ('en', 'es') or p_form_set_version < 1 then
		raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
	end if;
	if not exists (
		select 1 from public.form_sets fs
		where fs.form_set_key = p_form_set_key and fs.version = p_form_set_version
	) then
		raise exception using errcode = 'P0001', message = 'FORM_SET_MISSING';
	end if;

	insert into public.incidents (organization_id, reporter_id)
	values (v_org_id, v_user_id)
	returning id into v_incident_id;

	insert into public.incident_revisions (
		incident_id, organization_id, revision_number, form_set_key,
		form_set_version, language
	) values (
		v_incident_id, v_org_id, 1, p_form_set_key,
		p_form_set_version, p_language
	) returning id into v_revision_id;

	update public.incidents
	set active_revision_id = v_revision_id
	where id = v_incident_id;

	perform private.recompute_revision_forms(v_revision_id);
	return v_revision_id;
end;
$$;

create or replace function public.save_incident_answer(
	p_incident_revision_id uuid,
	p_expected_version integer,
	p_form_key text,
	p_field_key text,
	p_group_instance_id uuid default null,
	p_value jsonb default null,
	p_answer_state text default 'confirmed',
	p_source text default 'manual',
	p_evidence_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_user_id uuid := auth.uid();
	v_revision public.incident_revisions%rowtype;
	v_next_version integer;
begin
	if v_user_id is null then
		raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
	end if;
	if p_answer_state not in ('confirmed', 'unknown', 'declined', 'not_applicable', 'pending_follow_up')
		 or p_source not in ('manual', 'driver_confirmed')
		 or nullif(btrim(p_field_key), '') is null then
		raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
	end if;

	select ir.* into v_revision
	from public.incident_revisions ir
	join public.incidents i on i.id = ir.incident_id
	join public.profiles p on p.user_id = i.reporter_id
	where ir.id = p_incident_revision_id
		and i.reporter_id = v_user_id
		and i.organization_id = p.organization_id
		and p.role = 'driver'
	for update of ir;
	if not found then
		raise exception using errcode = 'P0001', message = 'NOT_ALLOWED';
	end if;
	if v_revision.status <> 'draft' then
		raise exception using errcode = 'P0001', message = 'INCIDENT_NOT_DRAFT';
	end if;
	if v_revision.version <> p_expected_version then
		raise exception using errcode = 'P0001', message = 'STALE_VERSION';
	end if;
	if not exists (
		select 1 from public.incident_revision_forms rf
		where rf.incident_revision_id = p_incident_revision_id and rf.form_key = p_form_key
	) then
		raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
	end if;
	if p_group_instance_id is not null and not exists (
		select 1 from public.incident_answer_groups ag
		where ag.id = p_group_instance_id
			and ag.incident_revision_id = p_incident_revision_id
			and ag.form_key = p_form_key
	) then
		raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
	end if;
	if p_evidence_id is not null and not exists (
		select 1 from public.evidence e
		where e.id = p_evidence_id
			and e.incident_revision_id = p_incident_revision_id
			and e.upload_status = 'uploaded'
	) then
		raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
	end if;

	if p_group_instance_id is null then
		insert into public.incident_answers (
			incident_revision_id, form_key, field_key, group_instance_id, value,
			answer_state, source, evidence_id, updated_by
		) values (
			p_incident_revision_id, p_form_key, p_field_key, null, p_value,
			p_answer_state, p_source, p_evidence_id, v_user_id
		) on conflict (incident_revision_id, form_key, field_key)
			where group_instance_id is null
		do update set value = excluded.value,
			answer_state = excluded.answer_state,
			source = excluded.source,
			evidence_id = excluded.evidence_id,
			updated_by = excluded.updated_by,
			updated_at = timezone('utc', now());
	else
		insert into public.incident_answers (
			incident_revision_id, form_key, field_key, group_instance_id, value,
			answer_state, source, evidence_id, updated_by
		) values (
			p_incident_revision_id, p_form_key, p_field_key, p_group_instance_id,
			p_value, p_answer_state, p_source, p_evidence_id, v_user_id
		) on conflict (incident_revision_id, form_key, field_key, group_instance_id)
			where group_instance_id is not null
		do update set value = excluded.value,
			answer_state = excluded.answer_state,
			source = excluded.source,
			evidence_id = excluded.evidence_id,
			updated_by = excluded.updated_by,
			updated_at = timezone('utc', now());
	end if;

	update public.incident_revisions
	set version = version + 1
	where id = p_incident_revision_id
	returning version into v_next_version;
	perform private.recompute_revision_forms(p_incident_revision_id);
	return v_next_version;
end;
$$;

create or replace function public.save_incident_details(
	p_incident_revision_id uuid,
	p_expected_version integer,
	p_occurred_at timestamptz,
	p_location jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_revision public.incident_revisions%rowtype;
	v_next_version integer;
begin
	if auth.uid() is null then
		raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
	end if;
	if p_location is not null and (
		jsonb_typeof(p_location) <> 'object' or octet_length(p_location::text) > 8192
	) then
		raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
	end if;

	select ir.* into v_revision
	from public.incident_revisions ir
	join public.incidents i on i.id = ir.incident_id
	where ir.id = p_incident_revision_id and i.reporter_id = auth.uid()
	for update of ir;
	if not found then
		raise exception using errcode = 'P0001', message = 'NOT_ALLOWED';
	end if;
	if v_revision.status <> 'draft' then
		raise exception using errcode = 'P0001', message = 'INCIDENT_NOT_DRAFT';
	end if;
	if v_revision.version <> p_expected_version then
		raise exception using errcode = 'P0001', message = 'STALE_VERSION';
	end if;

	update public.incident_revisions
	set occurred_at = p_occurred_at,
			location = p_location,
			version = version + 1
	where id = p_incident_revision_id
	returning version into v_next_version;
	return v_next_version;
end;
$$;

create or replace function public.create_incident_answer_group(
	p_incident_revision_id uuid,
	p_expected_version integer,
	p_form_key text,
	p_group_key text,
	p_position integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_revision public.incident_revisions%rowtype;
	v_group_id uuid;
begin
	if auth.uid() is null then
		raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
	end if;
	select ir.* into v_revision
	from public.incident_revisions ir
	join public.incidents i on i.id = ir.incident_id
	where ir.id = p_incident_revision_id and i.reporter_id = auth.uid()
	for update of ir;
	if not found then
		raise exception using errcode = 'P0001', message = 'NOT_ALLOWED';
	end if;
	if v_revision.status <> 'draft' then
		raise exception using errcode = 'P0001', message = 'INCIDENT_NOT_DRAFT';
	end if;
	if v_revision.version <> p_expected_version then
		raise exception using errcode = 'P0001', message = 'STALE_VERSION';
	end if;
	if not exists (
		select 1 from public.incident_revision_forms rf
		where rf.incident_revision_id = p_incident_revision_id and rf.form_key = p_form_key
	) or nullif(btrim(p_group_key), '') is null or p_position < 0 then
		raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
	end if;

	insert into public.incident_answer_groups (
		incident_revision_id, form_key, group_key, position
	) values (p_incident_revision_id, p_form_key, p_group_key, p_position)
	on conflict (incident_revision_id, form_key, group_key, position)
	do update set position = excluded.position
	returning id into v_group_id;
	update public.incident_revisions set version = version + 1
	where id = p_incident_revision_id;
	return v_group_id;
end;
$$;

create or replace function public.begin_incident_turn(
	p_incident_revision_id uuid,
	p_client_turn_id text,
	p_text text default null,
	p_audio_evidence_id uuid default null,
	p_language text default 'en'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_revision public.incident_revisions%rowtype;
	v_hash text;
	v_turn public.conversation_turns%rowtype;
begin
	if auth.uid() is null then
		raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
	end if;
	if (p_text is null) = (p_audio_evidence_id is null)
		 or nullif(btrim(p_client_turn_id), '') is null
		 or p_language not in ('en', 'es')
		 or (p_text is not null and (length(p_text) > 12000 or length(btrim(p_text)) = 0)) then
		raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
	end if;
	v_hash := md5(coalesce(p_text, p_audio_evidence_id::text));

	select ir.* into v_revision
	from public.incident_revisions ir
	join public.incidents i on i.id = ir.incident_id
	where ir.id = p_incident_revision_id and i.reporter_id = auth.uid()
	for update of ir;
	if not found then
		raise exception using errcode = 'P0001', message = 'NOT_ALLOWED';
	end if;
	if v_revision.status <> 'draft' then
		raise exception using errcode = 'P0001', message = 'INCIDENT_NOT_DRAFT';
	end if;
	if p_audio_evidence_id is not null and not exists (
		select 1 from public.evidence e
		where e.id = p_audio_evidence_id and e.incident_revision_id = p_incident_revision_id
			and e.media_type = 'audio' and e.upload_status = 'uploaded'
	) then
		raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
	end if;

	select * into v_turn from public.conversation_turns t
	where t.incident_revision_id = p_incident_revision_id
		and t.client_turn_id = p_client_turn_id;
	if found then
		if v_turn.input_hash <> v_hash then
			raise exception using errcode = 'P0001', message = 'TURN_ID_REUSED';
		end if;
		return jsonb_build_object(
			'turn_id', v_turn.id, 'client_turn_id', v_turn.client_turn_id,
			'status', v_turn.status, 'transcript', v_turn.transcript,
			'proposals', v_turn.extraction_proposals, 'error_code', v_turn.error_code
		);
	end if;

	insert into public.conversation_turns (
		incident_revision_id, client_turn_id, sequence, input_kind,
		audio_evidence_id, transcript, input_hash, language, status
	) values (
		p_incident_revision_id, p_client_turn_id,
		coalesce((select max(sequence) + 1 from public.conversation_turns
			where incident_revision_id = p_incident_revision_id), 1),
		case when p_text is null then 'audio' else 'text' end,
		p_audio_evidence_id, case when p_text is null then null else p_text end,
		v_hash, p_language, 'pending'
	) returning * into v_turn;

	update public.incident_revisions set version = version + 1
	where id = p_incident_revision_id;
	return jsonb_build_object(
		'turn_id', v_turn.id, 'client_turn_id', v_turn.client_turn_id,
		'status', v_turn.status, 'transcript', v_turn.transcript,
		'proposals', v_turn.extraction_proposals, 'error_code', v_turn.error_code
	);
end;
$$;

create or replace function public.record_incident_turn_result(
	p_incident_revision_id uuid,
	p_turn_id uuid,
	p_status text,
	p_transcript text default null,
	p_proposals jsonb default null,
	p_error_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_turn public.conversation_turns%rowtype;
	v_revision public.incident_revisions%rowtype;
begin
	if auth.uid() is null then
		raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
	end if;
	if p_status not in ('processing', 'completed', 'failed')
		 or (p_status = 'completed' and nullif(btrim(p_transcript), '') is null)
		 or (p_proposals is not null and jsonb_typeof(p_proposals) not in ('array', 'object')) then
		raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
	end if;
	select ir.* into v_revision
	from public.incident_revisions ir
	join public.incidents i on i.id = ir.incident_id
	where ir.id = p_incident_revision_id
		and i.reporter_id = auth.uid()
	for update of ir;
	if not found then
		raise exception using errcode = 'P0001', message = 'NOT_ALLOWED';
	end if;
	if v_revision.status <> 'draft' then
		raise exception using errcode = 'P0001', message = 'INCIDENT_NOT_DRAFT';
	end if;
	update public.conversation_turns t
	set status = p_status,
			transcript = coalesce(p_transcript, t.transcript),
			extraction_proposals = coalesce(p_proposals, t.extraction_proposals),
			error_code = case when p_status = 'failed' then left(p_error_code, 64) else null end,
			updated_at = timezone('utc', now())
	where t.id = p_turn_id
		and t.incident_revision_id = p_incident_revision_id
		and exists (
			select 1 from public.incident_revisions ir
			join public.incidents i on i.id = ir.incident_id
			where ir.id = p_incident_revision_id and i.reporter_id = auth.uid()
				and ir.status = 'draft'
		)
		and t.status in ('pending', 'processing', 'failed')
	returning t.* into v_turn;
	if not found then
		raise exception using errcode = 'P0001', message = 'NOT_ALLOWED';
	end if;
	return jsonb_build_object(
		'turn_id', v_turn.id, 'client_turn_id', v_turn.client_turn_id,
		'status', v_turn.status, 'transcript', v_turn.transcript,
		'proposals', v_turn.extraction_proposals, 'error_code', v_turn.error_code
	);
end;
$$;

create or replace function public.create_incident_evidence(
	p_incident_revision_id uuid,
	p_media_type text,
	p_size_bytes bigint,
	p_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_user_id uuid := auth.uid();
	v_org_id uuid;
	v_evidence_id uuid := gen_random_uuid();
	v_path text;
	v_revision_version integer;
begin
	if v_user_id is null then
		raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
	end if;
	if p_media_type not in ('audio', 'photo', 'video')
		 or p_size_bytes <= 0 or p_size_bytes > 52428800 then
		raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
	end if;
	select ir.organization_id into v_org_id
	from public.incident_revisions ir
	join public.incidents i on i.id = ir.incident_id
	where ir.id = p_incident_revision_id and i.reporter_id = v_user_id and ir.status = 'draft'
	for update of ir;
	if v_org_id is null then
		raise exception using errcode = 'P0001', message = 'NOT_ALLOWED';
	end if;
	v_path := v_org_id::text || '/' || p_incident_revision_id::text || '/' || v_evidence_id::text;
	insert into public.evidence (
		id, organization_id, incident_revision_id, object_path,
		media_type, size_bytes, description, upload_status, uploaded_by
	) values (
		v_evidence_id, v_org_id, p_incident_revision_id, v_path,
		p_media_type, p_size_bytes, left(p_description, 500), 'pending', v_user_id
	);
	update public.incident_revisions
	set version = version + 1
	where id = p_incident_revision_id
	returning version into v_revision_version;
	return jsonb_build_object('evidence_id', v_evidence_id, 'object_path', v_path,
		'upload_status', 'pending', 'revision_version', v_revision_version);
end;
$$;

create or replace function public.finalize_incident_evidence(p_evidence_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_evidence public.evidence%rowtype;
	v_revision_id uuid;
	v_mime text;
	v_actual_size bigint;
	v_revision_version integer;
begin
	if auth.uid() is null then
		raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
	end if;
	select ir.id into v_revision_id
	from public.incident_revisions ir
	join public.incidents i on i.id = ir.incident_id
	join public.evidence e on e.incident_revision_id = ir.id
	where e.id = p_evidence_id and e.uploaded_by = auth.uid()
		and ir.status = 'draft'
	for update of ir;
	if not found then
		raise exception using errcode = 'P0001', message = 'NOT_ALLOWED';
	end if;

	select e.* into v_evidence
	from public.evidence e
	where e.id = p_evidence_id and e.uploaded_by = auth.uid()
	for update;
	if not found then
		raise exception using errcode = 'P0001', message = 'NOT_ALLOWED';
	end if;

	select o.metadata->>'mimetype', nullif(o.metadata->>'size', '')::bigint
	into v_mime, v_actual_size
	from storage.objects o
	where o.bucket_id = 'incident-evidence' and o.name = v_evidence.object_path;
	if v_mime is null or v_actual_size is null or v_actual_size <> v_evidence.size_bytes
		 or v_actual_size > 52428800
		 or not (
			 (v_evidence.media_type = 'audio' and v_mime like 'audio/%')
			 or (v_evidence.media_type = 'photo' and v_mime in ('image/jpeg', 'image/png', 'image/webp'))
			 or (v_evidence.media_type = 'video' and v_mime in ('video/mp4', 'video/quicktime'))
		 ) then
		update public.evidence set upload_status = 'failed', updated_at = timezone('utc', now())
		where id = p_evidence_id;
		update public.incident_revisions set version = version + 1
		where id = v_revision_id returning version into v_revision_version;
		return jsonb_build_object('code', 'EVIDENCE_INVALID', 'upload_status', 'failed',
			'revision_version', v_revision_version);
	end if;
	update public.evidence set upload_status = 'uploaded', updated_at = timezone('utc', now())
	where id = p_evidence_id;
	update public.incident_revisions set version = version + 1
	where id = v_revision_id returning version into v_revision_version;
	return jsonb_build_object('evidence_id', p_evidence_id, 'upload_status', 'uploaded',
		'revision_version', v_revision_version);
end;
$$;

create or replace function public.submit_incident(
	p_incident_revision_id uuid,
	p_expected_version integer,
	p_signature_reference uuid,
	p_auth_method text,
	p_device_description text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_user_id uuid := auth.uid();
	v_revision public.incident_revisions%rowtype;
	v_incident public.incidents%rowtype;
	v_profile public.profiles%rowtype;
	v_form record;
	v_field record;
	v_definition jsonb;
	v_is_visible boolean;
	v_is_required boolean;
	v_missing jsonb := '[]'::jsonb;
	v_answers jsonb;
	v_forms jsonb;
	v_evidence jsonb;
	v_snapshot jsonb;
	v_reference text;
	v_signature public.signatures%rowtype;
	v_group record;
	v_answer_ok boolean;
begin
	if v_user_id is null then
		raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
	end if;
	if p_auth_method not in ('biometric', 'device_passcode')
		 or nullif(btrim(p_device_description), '') is null
		 or length(p_device_description) > 160 then
		raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
	end if;

	select ir.* into v_revision
	from public.incident_revisions ir
	where ir.id = p_incident_revision_id
	for update;
	if not found then
		raise exception using errcode = 'P0001', message = 'NOT_ALLOWED';
	end if;
	select i.* into v_incident from public.incidents i where i.id = v_revision.incident_id for update;
	select p.* into v_profile from public.profiles p
	where p.user_id = v_user_id and p.role = 'driver';
	if not found or v_incident.reporter_id <> v_user_id
		 or v_incident.organization_id <> v_profile.organization_id
		 or v_revision.organization_id <> v_profile.organization_id then
		raise exception using errcode = 'P0001', message = 'NOT_ALLOWED';
	end if;

	if v_revision.status = 'submitted' then
		select s.* into v_signature from public.signatures s
		where s.incident_revision_id = p_incident_revision_id
			and s.confirmation_reference = p_signature_reference;
		if found then
			if v_signature.revision_version <> p_expected_version
				 or v_signature.auth_method <> p_auth_method
				 or v_signature.device_description <> btrim(p_device_description) then
				raise exception using errcode = 'P0001', message = 'SIGNATURE_REFERENCE_REUSED';
			end if;
			return jsonb_build_object(
				'status', 'submitted', 'driver_status', 'Submitted · awaiting review',
				'incident_revision_id', p_incident_revision_id,
				'report_reference', v_signature.report_reference,
				'submitted_at', v_revision.submitted_at, 'version', v_revision.version
			);
		end if;
		raise exception using errcode = 'P0001', message = 'INCIDENT_NOT_DRAFT';
	end if;
	if v_revision.status <> 'draft' then
		raise exception using errcode = 'P0001', message = 'INCIDENT_NOT_DRAFT';
	end if;
	if v_revision.version <> p_expected_version then
		raise exception using errcode = 'P0001', message = 'STALE_VERSION';
	end if;

	perform private.recompute_revision_forms(p_incident_revision_id);
	for v_form in
		select rf.form_key, rf.form_version
		from public.incident_revision_forms rf
		where rf.incident_revision_id = p_incident_revision_id
			and rf.activation_status = 'triggered'
	loop
		select fd.definition into v_definition
		from public.form_definitions fd
		where fd.form_key = v_form.form_key and fd.version = v_form.form_version
			and fd.status in ('active', 'archived');
		if v_definition is null then
			v_missing := v_missing || jsonb_build_array(jsonb_build_object(
				'form_key', v_form.form_key, 'field_key', '_form_definition',
				'code', 'FORM_DEFINITION_MISSING'
			));
			continue;
		end if;

		for v_field in select * from private.definition_fields(v_definition)
		loop
			if v_field.is_group then
				v_is_visible := v_field.visible_when is null or private.condition_matches(
					p_incident_revision_id, v_form.form_key, v_field.visible_when
				);
				v_is_required := v_field.is_required or (
					v_field.required_when is not null and private.condition_matches(
						p_incident_revision_id, v_form.form_key, v_field.required_when
					)
				);
				if v_is_visible and v_is_required and not exists (
					select 1 from public.incident_answer_groups ag
					where ag.incident_revision_id = p_incident_revision_id
						and ag.form_key = v_form.form_key and ag.group_key = v_field.field_key
				) then
					v_missing := v_missing || jsonb_build_array(jsonb_build_object(
						'form_key', v_form.form_key, 'field_key', v_field.field_key,
						'code', 'REQUIRED_GROUP_MISSING'
					));
				end if;
			elsif v_field.group_key is null then
				v_is_visible := v_field.visible_when is null or private.condition_matches(
					p_incident_revision_id, v_form.form_key, v_field.visible_when
				);
				v_is_required := v_field.is_required or (
					v_field.required_when is not null and private.condition_matches(
						p_incident_revision_id, v_form.form_key, v_field.required_when
					)
				);
				if v_is_visible and v_is_required then
					select exists (
						select 1 from public.incident_answers a
						where a.incident_revision_id = p_incident_revision_id
							and a.form_key = v_form.form_key and a.field_key = v_field.field_key
							and a.group_instance_id is null
							and a.answer_state in ('confirmed', 'not_applicable')
							and a.value is not null and a.value <> 'null'::jsonb
							and (v_field.evidence_requirement is null or exists (
								select 1 from public.evidence e
								where e.id = a.evidence_id and e.upload_status = 'uploaded'
									and e.media_type = v_field.evidence_requirement
							))
					) into v_answer_ok;
					if not v_answer_ok then
						v_missing := v_missing || jsonb_build_array(jsonb_build_object(
							'form_key', v_form.form_key, 'field_key', v_field.field_key,
							'code', case when v_field.evidence_requirement is null
								then 'REQUIRED_FIELD_MISSING' else 'REQUIRED_EVIDENCE_MISSING' end
						));
					end if;
				end if;
			else
				for v_group in
					select ag.id from public.incident_answer_groups ag
					where ag.incident_revision_id = p_incident_revision_id
						and ag.form_key = v_form.form_key and ag.group_key = v_field.group_key
				loop
					v_is_visible := v_field.visible_when is null or private.condition_matches(
						p_incident_revision_id, v_form.form_key,
						v_field.visible_when, v_group.id
					);
					v_is_required := v_field.is_required or (
						v_field.required_when is not null and private.condition_matches(
							p_incident_revision_id, v_form.form_key,
							v_field.required_when, v_group.id
						)
					);
					if not v_is_visible or not v_is_required then
						continue;
					end if;
					select exists (
						select 1 from public.incident_answers a
						where a.incident_revision_id = p_incident_revision_id
							and a.form_key = v_form.form_key and a.field_key = v_field.field_key
							and a.group_instance_id = v_group.id
							and a.answer_state in ('confirmed', 'not_applicable')
							and a.value is not null and a.value <> 'null'::jsonb
							and (v_field.evidence_requirement is null or exists (
								select 1 from public.evidence e
								where e.id = a.evidence_id and e.upload_status = 'uploaded'
									and e.media_type = v_field.evidence_requirement
							))
					) into v_answer_ok;
					if not v_answer_ok then
						v_missing := v_missing || jsonb_build_array(jsonb_build_object(
							'form_key', v_form.form_key, 'field_key', v_field.field_key,
							'group_instance_id', v_group.id,
							'code', case when v_field.evidence_requirement is null
								then 'REQUIRED_FIELD_MISSING' else 'REQUIRED_EVIDENCE_MISSING' end
						));
					end if;
				end loop;
			end if;
		end loop;

		for v_field in
			select value as rule
			from jsonb_array_elements(coalesce(v_definition->'requiredEvidence', '[]'::jsonb))
		loop
			  if (v_field.rule->'when' is null or private.condition_matches(
				  p_incident_revision_id, v_form.form_key, v_field.rule->'when'))
				 and (select count(*) from public.evidence e
					 where e.incident_revision_id = p_incident_revision_id
						 and e.media_type = v_field.rule->>'media_type'
						 and e.upload_status = 'uploaded') < coalesce((v_field.rule->>'minimum')::integer, 1) then
				v_missing := v_missing || jsonb_build_array(jsonb_build_object(
					'form_key', v_form.form_key, 'field_key', coalesce(v_field.rule->>'field_key', '_evidence'),
					'code', 'REQUIRED_EVIDENCE_MISSING'
				));
			end if;
		end loop;
	end loop;

	if jsonb_array_length(v_missing) > 0 then
		return jsonb_build_object('code', 'VALIDATION_FAILED', 'issues', v_missing,
			'incident_revision_id', p_incident_revision_id, 'version', v_revision.version);
	end if;

	v_reference := 'JBL-' || upper(substr(replace(p_incident_revision_id::text, '-', ''), 1, 10));
	select coalesce(jsonb_agg(jsonb_build_object(
		'form_key', rf.form_key, 'version', rf.form_version, 'status', rf.activation_status
	) order by rf.form_key), '[]'::jsonb)
	into v_forms from public.incident_revision_forms rf
	where rf.incident_revision_id = p_incident_revision_id;

	select coalesce(jsonb_agg(jsonb_build_object(
		'form_key', a.form_key, 'field_key', a.field_key,
		'group_instance_id', a.group_instance_id, 'value', a.value,
		'answer_state', a.answer_state, 'source', a.source,
		'evidence_id', a.evidence_id
	) order by a.form_key, a.field_key, a.group_instance_id), '[]'::jsonb)
	into v_answers
	from public.incident_answers a
	join public.incident_revision_forms rf
		on rf.incident_revision_id = a.incident_revision_id
		and rf.form_key = a.form_key and rf.activation_status = 'triggered'
	left join public.form_definitions fd
		on fd.form_key = rf.form_key and fd.version = rf.form_version
	left join lateral (
		select private.find_field(fd.definition, a.field_key) as definition
	) field_def on true
	where a.incident_revision_id = p_incident_revision_id
		and (field_def.definition is null
			or field_def.definition->'visibleWhen' is null
			or private.condition_matches(p_incident_revision_id, a.form_key,
				field_def.definition->'visibleWhen', a.group_instance_id));

	select coalesce(jsonb_agg(jsonb_build_object(
		'id', e.id, 'media_type', e.media_type, 'object_path', e.object_path,
		'size_bytes', e.size_bytes, 'captured_at', e.capture_time,
		'description', e.description
	) order by e.created_at), '[]'::jsonb)
	into v_evidence from public.evidence e
	where e.incident_revision_id = p_incident_revision_id and e.upload_status = 'uploaded';

	v_snapshot := jsonb_build_object(
		'report_reference', v_reference,
		'incident_id', v_incident.id,
		'incident_revision_id', p_incident_revision_id,
		'revision_version', v_revision.version + 1,
		'status', 'submitted',
		'occurred_at', v_revision.occurred_at,
		'location', v_revision.location,
		'forms', v_forms,
		'answers', v_answers,
		'evidence', v_evidence,
		'confirmation', jsonb_build_object(
			'signer_id', v_user_id, 'driver_name', v_profile.display_name,
			'auth_method', p_auth_method, 'device_description', p_device_description
		)
	);

	insert into public.signatures (
		incident_revision_id, signer_id, auth_method, device_description,
		driver_name, signed_at, confirmation_reference, revision_version,
		report_reference
	) values (
		p_incident_revision_id, v_user_id, p_auth_method, btrim(p_device_description),
		v_profile.display_name, timezone('utc', now()), p_signature_reference,
		v_revision.version, v_reference
	);
	update public.incident_revisions
	set status = 'submitted', version = version + 1,
			submitted_at = timezone('utc', now()),
			report_reference = v_reference, submitted_snapshot = v_snapshot
	where id = p_incident_revision_id;
	update public.incidents
	set status = 'submitted', updated_at = timezone('utc', now())
	where id = v_incident.id;

	return jsonb_build_object(
		'status', 'submitted', 'driver_status', 'Submitted · awaiting review',
		'incident_revision_id', p_incident_revision_id,
		'report_reference', v_reference,
		'submitted_at', timezone('utc', now()), 'version', v_revision.version + 1
	);
end;
$$;

create or replace function private.touch_user_file()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
	new.updated_at := timezone('utc', now());
	return new;
end;
$$;

create trigger set_user_files_updated_at
before update on public.user_files
for each row execute function private.touch_user_file();

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.vehicles enable row level security;
alter table public.policies enable row level security;
alter table public.trip_records enable row level security;
alter table public.incidents enable row level security;
alter table public.incident_revisions enable row level security;
alter table public.incident_revision_forms enable row level security;
alter table public.conversation_turns enable row level security;
alter table public.incident_answer_groups enable row level security;
alter table public.incident_answers enable row level security;
alter table public.evidence enable row level security;
alter table public.signatures enable row level security;
alter table public.user_files enable row level security;
alter table public.form_definitions enable row level security;
alter table public.form_sets enable row level security;

drop policy if exists incidents_insert_own on public.incidents;
drop policy if exists incidents_update_own on public.incidents;
drop policy if exists incident_revisions_insert_own on public.incident_revisions;
drop policy if exists incident_revisions_update_own on public.incident_revisions;
drop policy if exists conversation_turns_insert_own on public.conversation_turns;
drop policy if exists conversation_turns_update_own on public.conversation_turns;
drop policy if exists answer_groups_insert_own on public.incident_answer_groups;
drop policy if exists answer_groups_update_own on public.incident_answer_groups;
drop policy if exists incident_answers_insert_own on public.incident_answers;
drop policy if exists incident_answers_update_own on public.incident_answers;
drop policy if exists evidence_insert_own on public.evidence;
drop policy if exists evidence_update_own on public.evidence;
drop policy if exists signatures_insert_own on public.signatures;
drop policy if exists signatures_update_own on public.signatures;

drop policy if exists policies_select_org on public.policies;
create policy policies_select_org on public.policies for select to authenticated
using (organization_id = (select public.current_organization_id()));
drop policy if exists trip_records_select_own on public.trip_records;
create policy trip_records_select_own on public.trip_records for select to authenticated
using (driver_id = (select auth.uid())
	and organization_id = (select public.current_organization_id()));
drop policy if exists revision_forms_select_own on public.incident_revision_forms;
create policy revision_forms_select_own on public.incident_revision_forms for select to authenticated
using (exists (
	select 1 from public.incident_revisions ir
	join public.incidents i on i.id = ir.incident_id
	where ir.id = incident_revision_forms.incident_revision_id
		and i.reporter_id = (select auth.uid())
));
drop policy if exists user_files_select_own on public.user_files;
create policy user_files_select_own on public.user_files for select to authenticated
using (user_id = (select auth.uid())
	and organization_id = (select public.current_organization_id()));

drop policy if exists storage_incident_evidence_select on storage.objects;
create policy storage_incident_evidence_select on storage.objects
for select to authenticated
using (bucket_id = 'incident-evidence' and exists (
	select 1 from public.evidence e
	join public.incident_revisions ir on ir.id = e.incident_revision_id
	join public.incidents i on i.id = ir.incident_id
	where e.object_path = storage.objects.name
		and e.organization_id = (select public.current_organization_id())
		and e.uploaded_by = (select auth.uid())
		and e.upload_status in ('pending', 'failed', 'uploaded')
		and i.reporter_id = (select auth.uid())
));
drop policy if exists storage_incident_evidence_insert on storage.objects;
create policy storage_incident_evidence_insert on storage.objects
for insert to authenticated
with check (bucket_id = 'incident-evidence' and exists (
	select 1 from public.evidence e
	join public.incident_revisions ir on ir.id = e.incident_revision_id
	join public.incidents i on i.id = ir.incident_id
	where e.object_path = storage.objects.name
		and e.organization_id = (select public.current_organization_id())
		and e.uploaded_by = (select auth.uid())
		and e.upload_status in ('pending', 'failed')
		and ir.status = 'draft' and i.reporter_id = (select auth.uid())
));
drop policy if exists storage_incident_evidence_update on storage.objects;
create policy storage_incident_evidence_update on storage.objects
for update to authenticated using (bucket_id = 'incident-evidence' and exists (
	select 1 from public.evidence e
	join public.incident_revisions ir on ir.id = e.incident_revision_id
	join public.incidents i on i.id = ir.incident_id
	where e.object_path = storage.objects.name
		and e.organization_id = (select public.current_organization_id())
		and e.uploaded_by = (select auth.uid())
		and e.upload_status in ('pending', 'failed')
		and ir.status = 'draft' and i.reporter_id = (select auth.uid())
)) with check (bucket_id = 'incident-evidence' and exists (
	select 1 from public.evidence e
	join public.incident_revisions ir on ir.id = e.incident_revision_id
	join public.incidents i on i.id = ir.incident_id
	where e.object_path = storage.objects.name
		and e.organization_id = (select public.current_organization_id())
		and e.uploaded_by = (select auth.uid())
		and e.upload_status in ('pending', 'failed')
		and ir.status = 'draft' and i.reporter_id = (select auth.uid())
));

insert into storage.buckets (id, name, public, file_size_limit)
values ('driver-files', 'driver-files', false, 52428800)
on conflict (id) do nothing;
drop policy if exists storage_driver_files_select on storage.objects;
create policy storage_driver_files_select on storage.objects
for select to authenticated
using (bucket_id = 'driver-files' and exists (
	select 1 from public.user_files f
	where f.object_path = storage.objects.name and f.user_id = (select auth.uid())
		and f.organization_id = (select public.current_organization_id())
		and f.upload_status in ('pending', 'failed', 'uploaded')
));
drop policy if exists storage_driver_files_insert on storage.objects;
create policy storage_driver_files_insert on storage.objects
for insert to authenticated
with check (bucket_id = 'driver-files' and exists (
	select 1 from public.user_files f
	where f.object_path = storage.objects.name and f.user_id = (select auth.uid())
		and f.organization_id = (select public.current_organization_id())
		and f.upload_status in ('pending', 'failed')
));
drop policy if exists storage_driver_files_update on storage.objects;
create policy storage_driver_files_update on storage.objects
for update to authenticated using (bucket_id = 'driver-files' and exists (
	select 1 from public.user_files f
	where f.object_path = storage.objects.name and f.user_id = (select auth.uid())
		and f.organization_id = (select public.current_organization_id())
		and f.upload_status in ('pending', 'failed')
)) with check (bucket_id = 'driver-files' and exists (
	select 1 from public.user_files f
	where f.object_path = storage.objects.name and f.user_id = (select auth.uid())
		and f.organization_id = (select public.current_organization_id())
		and f.upload_status in ('pending', 'failed')
));

revoke all on public.organizations, public.profiles, public.vehicles,
	public.policies, public.trip_records, public.incidents,
	public.incident_revisions, public.incident_revision_forms,
	public.conversation_turns, public.incident_answer_groups,
	public.incident_answers, public.evidence, public.signatures,
	public.user_files, public.form_definitions, public.form_sets
from anon, authenticated;

grant select on public.organizations, public.profiles, public.vehicles,
	public.policies, public.trip_records, public.incidents,
	public.incident_revisions, public.incident_revision_forms,
	public.conversation_turns, public.incident_answer_groups,
	public.incident_answers, public.evidence, public.signatures,
	public.user_files, public.form_definitions, public.form_sets
to authenticated;
grant update (display_name, phone, preferred_language) on public.profiles to authenticated;

revoke all on function public.create_incident_draft(text, integer, text) from public, anon;
revoke all on function public.save_incident_answer(uuid, integer, text, text, uuid, jsonb, text, text, uuid) from public, anon;
revoke all on function public.save_incident_details(uuid, integer, timestamptz, jsonb) from public, anon;
revoke all on function public.create_incident_answer_group(uuid, integer, text, text, integer) from public, anon;
revoke all on function public.begin_incident_turn(uuid, text, text, uuid, text) from public, anon;
revoke all on function public.record_incident_turn_result(uuid, uuid, text, text, jsonb, text) from public, anon;
revoke all on function public.create_incident_evidence(uuid, text, bigint, text) from public, anon;
revoke all on function public.finalize_incident_evidence(uuid) from public, anon;
revoke all on function public.submit_incident(uuid, integer, uuid, text, text) from public, anon;
grant execute on function public.create_incident_draft(text, integer, text) to authenticated;
grant execute on function public.save_incident_answer(uuid, integer, text, text, uuid, jsonb, text, text, uuid) to authenticated;
grant execute on function public.save_incident_details(uuid, integer, timestamptz, jsonb) to authenticated;
grant execute on function public.create_incident_answer_group(uuid, integer, text, text, integer) to authenticated;
grant execute on function public.begin_incident_turn(uuid, text, text, uuid, text) to authenticated;
grant execute on function public.record_incident_turn_result(uuid, uuid, text, text, jsonb, text) to authenticated;
grant execute on function public.create_incident_evidence(uuid, text, bigint, text) to authenticated;
grant execute on function public.finalize_incident_evidence(uuid) to authenticated;
grant execute on function public.submit_incident(uuid, integer, uuid, text, text) to authenticated;

update public.form_sets
set definition = definition || jsonb_build_object(
	'activation_rules', jsonb_build_object(
		'general_liability', jsonb_build_object('any', jsonb_build_array(
			jsonb_build_object('op', 'eq', 'field_key', 'property_damaged', 'value', true),
			jsonb_build_object('op', 'eq', 'field_key', 'delivery_work', 'value', true)
		)),
		'workers_comp', jsonb_build_object(
			'op', 'eq', 'field_key', 'injuries', 'value', true
		)
	)
)
where form_set_key = 'default' and version = 1
	and not (definition ? 'activation_rules');
