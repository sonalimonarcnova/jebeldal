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
	elsif v_op = 'contains_any' then
		return jsonb_typeof(v_value) = 'array'
			and jsonb_typeof(p_condition->'values') = 'array'
			and exists (
				select 1
				from jsonb_array_elements(v_value) selected(item)
				where (p_condition->'values') @> jsonb_build_array(selected.item)
			);
	end if;

	raise exception using errcode = 'P0001', message = 'INVALID_FORM_RULE';
end;
$$;

update public.form_sets
set definition = jsonb_set(
	definition,
	'{activation_rules,general_liability}',
	'{"op":"contains_any","field_key":"involved","values":["object","delivery_claim"]}'::jsonb,
	true
)
where form_set_key = 'default' and version = 1;

update public.form_definitions
set definition = jsonb_set(
	definition,
	'{requiredEvidence,0,when}',
	'{"any":[
		{"op":"contains_any","field_key":"involved","values":["object","delivery_claim"]},
		{"op":"in","field_key":"injuries","values":["me","someone_else","me_and_someone"]}
	]}'::jsonb,
	true
)
where form_key = 'auto' and version = 1
	and jsonb_typeof(definition->'requiredEvidence') = 'array'
	and jsonb_array_length(definition->'requiredEvidence') > 0;

alter table public.evidence enable row level security;
drop policy if exists evidence_select_own on public.evidence;
create policy evidence_select_own on public.evidence
for select to authenticated
using (
	uploaded_by = (select auth.uid())
	and organization_id = (select public.current_organization_id())
	and exists (
		select 1
		from public.incident_revisions ir
		join public.incidents i on i.id = ir.incident_id
		where ir.id = evidence.incident_revision_id
			and ir.organization_id = evidence.organization_id
			and i.reporter_id = (select auth.uid())
			and i.organization_id = evidence.organization_id
	)
);

alter table public.user_files enable row level security;
revoke all on public.user_files from public, anon, authenticated;
grant select on public.user_files to authenticated;

create or replace function public.create_user_file(
	p_category text,
	p_media_type text,
	p_size_bytes bigint,
	p_captured_at timestamptz default null,
	p_location jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_user_id uuid := auth.uid();
	v_org_id uuid;
	v_file_id uuid := gen_random_uuid();
	v_object_path text;
begin
	if v_user_id is null then
		raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
	end if;
	if coalesce(p_category, '') not in (
		'cdl_front', 'cdl_back', 'medical_card', 'registration',
		'insurance_card', 'walkaround_front', 'walkaround_driver_side',
		'walkaround_rear', 'walkaround_passenger_side'
	) or coalesce(p_media_type, '') not in ('image', 'document')
		 or p_size_bytes is null or p_size_bytes <= 0 or p_size_bytes > 52428800
		 or (p_category like 'walkaround_%' and p_media_type <> 'image')
		 or (p_location is not null and (
			jsonb_typeof(p_location) <> 'object'
			or octet_length(p_location::text) > 8192
		 )) then
		raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
	end if;

	select p.organization_id into v_org_id
	from public.profiles p
	where p.user_id = v_user_id and p.role = 'driver';
	if v_org_id is null then
		raise exception using errcode = 'P0001', message = 'NOT_ALLOWED';
	end if;

	v_object_path := v_org_id::text || '/' || v_user_id::text || '/' || v_file_id::text;
	insert into public.user_files (
		id, organization_id, user_id, category, object_path, media_type,
		size_bytes, captured_at, location, upload_status
	) values (
		v_file_id, v_org_id, v_user_id, p_category, v_object_path, p_media_type,
		p_size_bytes, p_captured_at, p_location, 'pending'
	);

	return jsonb_build_object(
		'user_file_id', v_file_id,
		'object_path', v_object_path,
		'category', p_category,
		'media_type', p_media_type,
		'size_bytes', p_size_bytes,
		'upload_status', 'pending'
	);
end;
$$;

create or replace function public.finalize_user_file(p_user_file_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_file public.user_files%rowtype;
	v_mime text;
	v_actual_size bigint;
	v_failure_code text;
begin
	if auth.uid() is null then
		raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
	end if;

	select f.* into v_file
	from public.user_files f
	where f.id = p_user_file_id
		and f.user_id = (select auth.uid())
		and f.organization_id = (select public.current_organization_id())
	for update;
	if not found then
		raise exception using errcode = 'P0001', message = 'NOT_ALLOWED';
	end if;
	if v_file.upload_status = 'uploaded' then
		return jsonb_build_object(
			'user_file_id', v_file.id,
			'category', v_file.category,
			'media_type', v_file.media_type,
			'upload_status', 'uploaded',
			'idempotent', true
		);
	end if;

	select o.metadata->>'mimetype',
		case
			when o.metadata->>'size' ~ '^[0-9]+$'
				then (o.metadata->>'size')::bigint
			else null
		end
	into v_mime, v_actual_size
	from storage.objects o
	where o.bucket_id = 'driver-files' and o.name = v_file.object_path;

	if v_mime is null or v_actual_size is null
		 or v_actual_size <> v_file.size_bytes or v_actual_size > 52428800 then
		v_failure_code := 'SIZE_MISMATCH';
	elsif (v_file.media_type = 'image'
			and v_mime not in ('image/jpeg', 'image/png', 'image/webp'))
		or (v_file.media_type = 'document' and v_mime <> 'application/pdf') then
		v_failure_code := 'MIME_TYPE_MISMATCH';
	end if;

	if v_failure_code is not null then
		update public.user_files
		set upload_status = 'failed'
		where id = v_file.id;
		return jsonb_build_object(
			'code', 'USER_FILE_INVALID',
			'reason', v_failure_code,
			'user_file_id', v_file.id,
			'category', v_file.category,
			'media_type', v_file.media_type,
			'upload_status', 'failed'
		);
	end if;

	update public.user_files
	set upload_status = 'uploaded'
	where id = v_file.id;
	return jsonb_build_object(
		'user_file_id', v_file.id,
		'category', v_file.category,
		'media_type', v_file.media_type,
		'upload_status', 'uploaded',
		'idempotent', false
	);
end;
$$;

revoke all on function public.create_user_file(text, text, bigint, timestamptz, jsonb)
	from public, anon;
revoke all on function public.finalize_user_file(uuid) from public, anon;
grant execute on function public.create_user_file(text, text, bigint, timestamptz, jsonb)
	to authenticated;
grant execute on function public.finalize_user_file(uuid) to authenticated;

alter function public.finalize_incident_evidence(uuid)
	rename to finalize_incident_evidence_core;
revoke all on function public.finalize_incident_evidence_core(uuid)
	from public, anon, authenticated;

create function public.finalize_incident_evidence(p_evidence_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_upload_status text;
	v_revision_status text;
	v_revision_version integer;
begin
	if auth.uid() is null then
		raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
	end if;

	select e.upload_status, ir.status, ir.version
	into v_upload_status, v_revision_status, v_revision_version
	from public.evidence e
	join public.incident_revisions ir on ir.id = e.incident_revision_id
	join public.incidents i on i.id = ir.incident_id
	where e.id = p_evidence_id
		and e.uploaded_by = (select auth.uid())
		and i.reporter_id = (select auth.uid())
		and e.organization_id = (select public.current_organization_id())
	for update of e, ir;

	if found and v_upload_status = 'uploaded' and v_revision_status = 'draft' then
		return jsonb_build_object(
			'evidence_id', p_evidence_id,
			'upload_status', 'uploaded',
			'revision_version', v_revision_version,
			'idempotent', true
		);
	end if;

	return public.finalize_incident_evidence_core(p_evidence_id);
end;
$$;

revoke all on function public.finalize_incident_evidence(uuid) from public, anon;
grant execute on function public.finalize_incident_evidence(uuid) to authenticated;

alter function public.save_incident_answer(
	uuid, integer, text, text, uuid, jsonb, text, text, uuid
) rename to save_incident_answer_core;
revoke all on function public.save_incident_answer_core(
	uuid, integer, text, text, uuid, jsonb, text, text, uuid
) from public, anon, authenticated;

create function public.save_incident_answer(
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
	v_error_message text;
	v_field_definition jsonb;
	v_detail jsonb;
	v_group_key text;
begin
	return public.save_incident_answer_core(
		p_incident_revision_id, p_expected_version, p_form_key, p_field_key,
		p_group_instance_id, p_value, p_answer_state, p_source, p_evidence_id
	);
exception
	when sqlstate 'P0001' then
		get stacked diagnostics v_error_message = message_text;
		if v_error_message <> 'VALIDATION_FAILED' then
			raise;
		end if;

		v_group_key := null;
		if p_group_instance_id is not null then
			select ag.group_key into v_group_key
			from public.incident_answer_groups ag
			where ag.id = p_group_instance_id
				and ag.incident_revision_id = p_incident_revision_id
				and ag.form_key = p_form_key;
		end if;

		select fields.definition into v_field_definition
		from public.incident_revision_forms rf
		join public.form_definitions fd
			on fd.form_key = rf.form_key and fd.version = rf.form_version
		cross join lateral private.definition_fields(fd.definition) fields
		where rf.incident_revision_id = p_incident_revision_id
			and rf.form_key = p_form_key
			and fields.field_key = p_field_key
			and fields.group_key is not distinct from v_group_key
			and fd.status in ('active', 'archived')
		limit 1;

		v_detail := jsonb_build_object(
			'code', case when p_evidence_id is null
				then 'FIELD_VALIDATION_FAILED' else 'EVIDENCE_UNAVAILABLE' end,
			'form_key', p_form_key,
			'field_key', p_field_key,
			'label', v_field_definition->>'label',
			'expected_type', v_field_definition->>'type',
			'validation', v_field_definition->'validation',
			'options', v_field_definition->'options',
			'supplied_type', case
				when p_value is null then null
				else jsonb_typeof(p_value)
			end,
			'answer_state', p_answer_state,
			'source', p_source,
			'evidence_id', p_evidence_id
		);
		raise exception using
			errcode = 'P0001',
			message = v_error_message,
			detail = v_detail::text;
end;
$$;

revoke all on function public.save_incident_answer(
	uuid, integer, text, text, uuid, jsonb, text, text, uuid
) from public, anon;
grant execute on function public.save_incident_answer(
	uuid, integer, text, text, uuid, jsonb, text, text, uuid
) to authenticated;

alter function public.submit_incident(uuid, integer, uuid, text, text)
	rename to submit_incident_core;
revoke all on function public.submit_incident_core(uuid, integer, uuid, text, text)
	from public, anon, authenticated;

create function public.submit_incident(
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
	v_result jsonb;
	v_issue jsonb;
	v_issues jsonb := '[]'::jsonb;
	v_form_definition jsonb;
	v_field_definition jsonb;
	v_visible_when jsonb;
	v_required_when jsonb;
	v_field_evidence text;
	v_rule jsonb;
	v_answer_state text;
	v_source text;
	v_confidence numeric;
	v_evidence_id uuid;
	v_transcript_turn_id uuid;
	v_expected_media text;
	v_required_count integer;
	v_uploaded_count integer;
	v_action text;
	v_message text;
begin
	v_result := public.submit_incident_core(
		p_incident_revision_id, p_expected_version, p_signature_reference,
		p_auth_method, p_device_description
	);
	if coalesce(v_result->>'code', '') <> 'VALIDATION_FAILED'
		 or coalesce(jsonb_typeof(v_result->'issues'), '') <> 'array' then
		return v_result;
	end if;

	for v_issue in
		select value from jsonb_array_elements(v_result->'issues')
	loop
		v_form_definition := null;
		v_field_definition := null;
		v_visible_when := null;
		v_required_when := null;
		v_field_evidence := null;
		v_rule := null;
		v_answer_state := null;
		v_source := null;
		v_confidence := null;
		v_evidence_id := null;
		v_transcript_turn_id := null;
		v_expected_media := null;
		v_required_count := null;
		v_uploaded_count := null;

		select fd.definition into v_form_definition
		from public.incident_revision_forms rf
		join public.form_definitions fd
			on fd.form_key = rf.form_key and fd.version = rf.form_version
		where rf.incident_revision_id = p_incident_revision_id
			and rf.form_key = v_issue->>'form_key'
			and fd.status in ('active', 'archived');

		if v_form_definition is not null then
			select fields.definition, fields.visible_when, fields.required_when,
				fields.evidence_requirement
			into v_field_definition, v_visible_when, v_required_when,
				v_field_evidence
			from private.definition_fields(v_form_definition) fields
			where fields.field_key = v_issue->>'field_key'
			limit 1;

			if v_issue->>'code' = 'REQUIRED_EVIDENCE_MISSING' then
				select requirements.rule into v_rule
				from jsonb_array_elements(coalesce(v_form_definition->'requiredEvidence', '[]'::jsonb))
					as requirements(rule)
				where coalesce(requirements.rule->>'field_key', '_evidence') =
					v_issue->>'field_key'
				limit 1;
				v_expected_media := coalesce(
					v_field_evidence,
					v_rule->>'media_type'
				);
				v_required_count := coalesce(
					(v_rule->>'minimum')::integer,
					1
				);
				select count(*)::integer into v_uploaded_count
				from public.evidence e
				where e.incident_revision_id = p_incident_revision_id
					and e.media_type = v_expected_media
					and e.upload_status = 'uploaded';
			end if;

			select a.answer_state, a.source, a.confidence, a.evidence_id,
				a.transcript_turn_id
			into v_answer_state, v_source, v_confidence, v_evidence_id,
				v_transcript_turn_id
			from public.incident_answers a
			where a.incident_revision_id = p_incident_revision_id
				and a.form_key = v_issue->>'form_key'
				and a.field_key = v_issue->>'field_key'
				and a.group_instance_id is not distinct from
					nullif(v_issue->>'group_instance_id', '')::uuid;
		end if;

		if v_issue->>'code' = 'REQUIRED_EVIDENCE_MISSING' then
			v_action := 'capture_or_upload_evidence';
			v_message := 'Upload the required evidence before submitting.';
		elsif v_issue->>'code' = 'REQUIRED_GROUP_MISSING' then
			v_action := 'add_group_entry';
			v_message := 'Complete this required section before submitting.';
		elsif v_issue->>'code' = 'FORM_DEFINITION_MISSING' then
			v_action := 'refresh_form_definitions';
			v_message := 'The pinned form definition is unavailable. Refresh and retry.';
		else
			v_action := 'answer_field';
			v_message := 'Complete this required field before submitting.';
		end if;

		v_issues := v_issues || jsonb_build_array(
			v_issue || jsonb_build_object(
				'label', coalesce(v_field_definition->>'label', v_issue->>'field_key'),
				'expected_type', v_field_definition->>'type',
				'validation', v_field_definition->'validation',
				'options', v_field_definition->'options',
				'required', (v_issue->>'code') in (
					'REQUIRED_FIELD_MISSING', 'REQUIRED_GROUP_MISSING',
					'REQUIRED_EVIDENCE_MISSING'
				),
				'visible_when', v_visible_when,
				'required_when', v_required_when,
				'answer_state', v_answer_state,
				'provenance', jsonb_strip_nulls(jsonb_build_object(
					'source', v_source,
					'confidence', v_confidence,
					'evidence_id', v_evidence_id,
					'transcript_turn_id', v_transcript_turn_id
				)),
				'expected_media_type', v_expected_media,
				'required_count', v_required_count,
				'uploaded_count', v_uploaded_count,
				'action', v_action,
				'message', v_message
			)
		);
	end loop;

	return v_result || jsonb_build_object(
		'issues', v_issues,
		'issue_count', jsonb_array_length(v_issues)
	);
end;
$$;

revoke all on function public.submit_incident(uuid, integer, uuid, text, text)
	from public, anon;
grant execute on function public.submit_incident(uuid, integer, uuid, text, text)
	to authenticated;

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
	v_user_id uuid := auth.uid();
	v_revision public.incident_revisions%rowtype;
	v_definition jsonb;
	v_group_id uuid;
begin
	if v_user_id is null then
		raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
	end if;
	if nullif(btrim(p_form_key), '') is null
		 or nullif(btrim(p_group_key), '') is null
		 or p_position is null or p_position < 0 then
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

	select fd.definition into v_definition
	from public.incident_revision_forms rf
	join public.form_definitions fd
		on fd.form_key = rf.form_key and fd.version = rf.form_version
	where rf.incident_revision_id = p_incident_revision_id
		and rf.form_key = p_form_key
		and rf.activation_status = 'triggered'
		and fd.status in ('active', 'archived');
	if v_definition is null then
		raise exception using errcode = 'P0001', message = 'FORM_DEFINITION_MISSING';
	end if;
	if not exists (
		select 1
		from private.definition_fields(v_definition) fields
		where fields.field_key = p_group_key and fields.is_group
	) then
		raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
	end if;

	insert into public.incident_answer_groups (
		incident_revision_id, form_key, group_key, position
	) values (
		p_incident_revision_id, p_form_key, p_group_key, p_position
	)
	on conflict (incident_revision_id, form_key, group_key, position)
	do update set position = excluded.position
	returning id into v_group_id;

	update public.incident_revisions
	set version = version + 1
	where id = p_incident_revision_id;
	return v_group_id;
end;
$$;

create or replace function public.delete_incident_answer_group(
	p_incident_revision_id uuid,
	p_expected_version integer,
	p_group_instance_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_user_id uuid := auth.uid();
	v_revision public.incident_revisions%rowtype;
	v_group public.incident_answer_groups%rowtype;
	v_definition jsonb;
	v_group_definition record;
	v_group_required boolean;
	v_next_version integer;
begin
	if v_user_id is null then
		raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
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

	select ag.* into v_group
	from public.incident_answer_groups ag
	where ag.id = p_group_instance_id
		and ag.incident_revision_id = p_incident_revision_id
	for update;
	if not found then
		raise exception using errcode = 'P0001', message = 'NOT_ALLOWED';
	end if;

	select fd.definition into v_definition
	from public.incident_revision_forms rf
	join public.form_definitions fd
		on fd.form_key = rf.form_key and fd.version = rf.form_version
	where rf.incident_revision_id = p_incident_revision_id
		and rf.form_key = v_group.form_key
		and fd.status in ('active', 'archived');
	if v_definition is null then
		raise exception using errcode = 'P0001', message = 'FORM_DEFINITION_MISSING';
	end if;
	select fields.* into v_group_definition
	from private.definition_fields(v_definition) fields
	where fields.field_key = v_group.group_key and fields.is_group;
	if not found then
		raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
	end if;

	v_group_required := v_group_definition.is_required or (
		v_group_definition.required_when is not null
		and private.condition_matches(
			p_incident_revision_id, v_group.form_key, v_group_definition.required_when
		)
	);
	if v_group_required and (
		select count(*) from public.incident_answer_groups ag
		where ag.incident_revision_id = p_incident_revision_id
			and ag.form_key = v_group.form_key
			and ag.group_key = v_group.group_key
	) <= 1 then
		raise exception using errcode = 'P0001', message = 'GROUP_REQUIRED';
	end if;

	delete from public.incident_answers a
	where a.incident_revision_id = p_incident_revision_id
		and a.group_instance_id = p_group_instance_id;
	delete from public.incident_answer_groups ag
	where ag.id = p_group_instance_id
		and ag.incident_revision_id = p_incident_revision_id;

	update public.incident_revisions
	set version = version + 1
	where id = p_incident_revision_id
	returning version into v_next_version;
	return v_next_version;
end;
$$;

revoke all on function public.create_incident_answer_group(uuid, integer, text, text, integer)
	from public, anon;
grant execute on function public.create_incident_answer_group(uuid, integer, text, text, integer)
	to authenticated;
revoke all on function public.delete_incident_answer_group(uuid, integer, uuid)
	from public, anon;
grant execute on function public.delete_incident_answer_group(uuid, integer, uuid)
	to authenticated;

create or replace function public.check_incident_submission_readiness(
	p_incident_revision_id uuid,
	p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_result jsonb;
	v_error_message text;
begin
	if auth.uid() is null then
		raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
	end if;

	begin
		v_result := public.submit_incident(
			p_incident_revision_id,
			p_expected_version,
			gen_random_uuid(),
			'biometric',
			'readiness-preview'
		);
		raise exception using
			errcode = 'P0001',
			message = 'READINESS_PREVIEW_ROLLBACK';
	exception
		when sqlstate 'P0001' then
			get stacked diagnostics v_error_message = message_text;
			if v_error_message <> 'READINESS_PREVIEW_ROLLBACK' then
				raise;
			end if;
	end;

	if v_result->>'status' = 'submitted' then
		return jsonb_build_object(
			'status', 'ready',
			'incident_revision_id', p_incident_revision_id,
			'version', p_expected_version
		);
	end if;
	return v_result;
end;
$$;

revoke all on function public.check_incident_submission_readiness(uuid, integer)
	from public, anon;
grant execute on function public.check_incident_submission_readiness(uuid, integer)
	to authenticated;