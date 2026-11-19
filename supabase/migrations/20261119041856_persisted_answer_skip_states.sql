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
		coalesce((node->>'required')::boolean, false)
			or node->>'key' = 'injuries',
		node->'visibleWhen', node->'requiredWhen',
		node->>'evidenceRequirement', node
	from walk
	where jsonb_typeof(node) = 'object' and node ? 'key'
$$;

create or replace function private.guard_incident_answer_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_form_definition jsonb;
	v_group_instance_key text;
	v_field record;
begin
	if new.answer_state <> 'not_applicable' then
		return new;
	end if;
	if new.value is not null and new.value <> 'null'::jsonb then
		raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
	end if;

	select fd.definition into v_form_definition
	from public.incident_revision_forms rf
	join public.form_definitions fd
		on fd.form_key = rf.form_key and fd.version = rf.form_version
	where rf.incident_revision_id = new.incident_revision_id
		and rf.form_key = new.form_key
		and fd.status in ('active', 'archived');
	if v_form_definition is null then
		raise exception using errcode = 'P0001', message = 'FORM_DEFINITION_MISSING';
	end if;

	if new.group_instance_id is null then
		v_group_instance_key := null;
	else
		select ag.group_key into v_group_instance_key
		from public.incident_answer_groups ag
		where ag.id = new.group_instance_id
			and ag.incident_revision_id = new.incident_revision_id
			and ag.form_key = new.form_key;
		if not found then
			raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
		end if;
	end if;

	select fields.* into v_field
	from private.definition_fields(v_form_definition) fields
	where fields.field_key = new.field_key
		and fields.group_key is not distinct from v_group_instance_key
	limit 1;
	if not found then
		raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
	end if;
	if v_field.is_group or v_field.is_required or (
		v_field.required_when is not null
		and private.condition_matches(
			new.incident_revision_id,
			new.form_key,
			v_field.required_when,
			new.group_instance_id
		)
	) then
		raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
	end if;

	return new;
end;
$$;

update public.incident_answers a
set answer_state = 'unknown',
	value = null,
	updated_at = timezone('utc', now())
from public.incident_revisions ir
where ir.id = a.incident_revision_id
	and ir.status = 'draft'
	and a.answer_state = 'not_applicable'
	and a.value is not null
	and a.value <> 'null'::jsonb;

revoke all on function private.guard_incident_answer_state() from public, anon, authenticated;

drop trigger if exists guard_incident_answer_state on public.incident_answers;
create trigger guard_incident_answer_state
before insert or update on public.incident_answers
for each row execute function private.guard_incident_answer_state();