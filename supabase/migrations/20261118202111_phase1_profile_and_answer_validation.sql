create or replace function private.answer_value_matches(
	p_field_definition jsonb,
	p_value jsonb
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
	v_type text := p_field_definition->>'type';
	v_options jsonb := p_field_definition->'options';
	v_validation jsonb := coalesce(p_field_definition->'validation', '{}'::jsonb);
	v_text text;
	v_number numeric;
begin
	if jsonb_typeof(p_field_definition) <> 'object' then
		return false;
	end if;
	if p_value is null or jsonb_typeof(p_value) = 'null' then
		return true;
	end if;

	case v_type
		when 'text', 'long_text', 'phone', 'email', 'date', 'datetime' then
			if jsonb_typeof(p_value) <> 'string' then
				return false;
			end if;
			v_text := p_value #>> '{}';
			if v_validation ? 'minLength'
				 and char_length(v_text) < (v_validation->>'minLength')::integer then
				return false;
			end if;
			if v_validation ? 'maxLength'
				 and char_length(v_text) > (v_validation->>'maxLength')::integer then
				return false;
			end if;
		when 'number', 'currency' then
			if jsonb_typeof(p_value) <> 'number' then
				return false;
			end if;
			v_number := (p_value #>> '{}')::numeric;
			if v_validation ? 'min' and v_number < (v_validation->>'min')::numeric then
				return false;
			end if;
			if v_validation ? 'max' and v_number > (v_validation->>'max')::numeric then
				return false;
			end if;
		when 'boolean' then
			return jsonb_typeof(p_value) = 'boolean';
		when 'enum' then
			if jsonb_typeof(p_value) <> 'string' or jsonb_typeof(v_options) <> 'array' then
				return false;
			end if;
			return exists (
				select 1
				from jsonb_array_elements(v_options) as choices(item)
				where choices.item->>'value' = p_value #>> '{}'
			);
		when 'multi_enum' then
			if jsonb_typeof(p_value) <> 'array' or jsonb_typeof(v_options) <> 'array' then
				return false;
			end if;
			return not exists (
				select 1
				from jsonb_array_elements(p_value) as selected(value)
				where jsonb_typeof(selected.value) <> 'string'
					or not exists (
						select 1
						from jsonb_array_elements(v_options) as choices(item)
						where choices.item->>'value' = selected.value #>> '{}'
					)
			);
		when 'address' then
			return jsonb_typeof(p_value) = 'object';
		when 'media' then
			return jsonb_typeof(p_value) in ('string', 'object', 'array');
		when 'repeated_group' then
			return false;
		else
			return false;
	end case;

	return true;
end;
$$;

create or replace function public.complete_driver_profile()
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_user_id uuid := auth.uid();
	v_display_name text;
	v_completed_at timestamptz;
begin
	if v_user_id is null then
		raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
	end if;

	select p.display_name into v_display_name
	from public.profiles p
	where p.user_id = v_user_id and p.role = 'driver'
	for update;
	if not found then
		raise exception using errcode = 'P0001', message = 'NOT_ALLOWED';
	end if;
	if nullif(btrim(v_display_name), '') is null then
		raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
	end if;

	update public.profiles p
	set profile_completed_at = coalesce(p.profile_completed_at, pg_catalog.now())
	where p.user_id = v_user_id and p.role = 'driver'
	returning p.profile_completed_at into v_completed_at;
	return v_completed_at;
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
	v_form_definition jsonb;
	v_field_definition jsonb;
	v_group_instance_key text;
	v_field_is_group boolean;
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

	select fd.definition into v_form_definition
	from public.incident_revision_forms rf
	join public.form_definitions fd
		on fd.form_key = rf.form_key and fd.version = rf.form_version
	where rf.incident_revision_id = p_incident_revision_id
		and rf.form_key = p_form_key
		and fd.status in ('active', 'archived');
	if v_form_definition is null then
		raise exception using errcode = 'P0001', message = 'FORM_DEFINITION_MISSING';
	end if;

	if p_group_instance_id is not null then
		select ag.group_key into v_group_instance_key
		from public.incident_answer_groups ag
		where ag.id = p_group_instance_id
			and ag.incident_revision_id = p_incident_revision_id
			and ag.form_key = p_form_key;
		if not found then
			raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
		end if;
	else
		v_group_instance_key := null;
	end if;

	select f.definition, f.is_group
	into v_field_definition, v_field_is_group
	from private.definition_fields(v_form_definition) f
	where f.field_key = p_field_key
		and f.group_key is not distinct from v_group_instance_key
	limit 1;
	if not found or v_field_is_group then
		raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
	end if;
	if p_value is not null and jsonb_typeof(p_value) <> 'null'
		 and not private.answer_value_matches(v_field_definition, p_value) then
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

revoke all on function public.complete_driver_profile() from public, anon;
grant execute on function public.complete_driver_profile() to authenticated;

revoke all on function public.save_incident_answer(uuid, integer, text, text, uuid, jsonb, text, text, uuid)
	from public, anon;
grant execute on function public.save_incident_answer(uuid, integer, text, text, uuid, jsonb, text, text, uuid)
	to authenticated;