create table if not exists public.incident_setup_files (
	incident_revision_id uuid not null,
	user_file_id uuid not null,
	organization_id uuid not null,
	user_id uuid not null,
	category text not null,
	object_path text not null,
	media_type text not null check (media_type in ('image', 'document')),
	captured_at timestamptz,
	linked_at timestamptz not null default timezone('utc', now()),
	primary key (incident_revision_id, user_file_id),
	foreign key (incident_revision_id, organization_id)
		references public.incident_revisions(id, organization_id)
		on delete cascade,
	foreign key (user_file_id) references public.user_files(id) on delete cascade,
	foreign key (user_id, organization_id)
		references public.profiles(user_id, organization_id)
		on delete cascade
);

create index if not exists idx_incident_setup_files_revision
	on public.incident_setup_files (incident_revision_id);

alter table public.incident_setup_files enable row level security;
revoke all on public.incident_setup_files from public, anon, authenticated;
grant select on public.incident_setup_files to authenticated;

drop policy if exists incident_setup_files_select_own on public.incident_setup_files;
create policy incident_setup_files_select_own
	on public.incident_setup_files
	for select
	to authenticated
	using (
		exists (
			select 1
			from public.incident_revisions ir
			join public.incidents i on i.id = ir.incident_id
			where ir.id = incident_setup_files.incident_revision_id
				and ir.organization_id = incident_setup_files.organization_id
				and i.reporter_id = (select auth.uid())
		)
		and user_id = (select auth.uid())
	);

alter function public.create_incident_draft(text, integer, text)
	rename to create_incident_draft_core;
revoke all on function public.create_incident_draft_core(text, integer, text)
	from public, anon, authenticated;

create function public.create_incident_draft(
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
	v_revision_id uuid;
	v_org_id uuid;
	v_user_id uuid;
begin
	v_revision_id := public.create_incident_draft_core(
		p_form_set_key,
		p_form_set_version,
		p_language
	);

	select ir.organization_id, i.reporter_id
	into v_org_id, v_user_id
	from public.incident_revisions ir
	join public.incidents i on i.id = ir.incident_id
	where ir.id = v_revision_id;

	insert into public.incident_setup_files (
		incident_revision_id,
		user_file_id,
		organization_id,
		user_id,
		category,
		object_path,
		media_type,
		captured_at
	)
	select
		v_revision_id,
		selected.id,
		selected.organization_id,
		selected.user_id,
		selected.category,
		selected.object_path,
		selected.media_type,
		selected.captured_at
	from (
		select distinct on (f.category)
			f.id,
			f.organization_id,
			f.user_id,
			f.category,
			f.object_path,
			f.media_type,
			f.captured_at,
			f.created_at
		from public.user_files f
		where f.user_id = v_user_id
			and f.organization_id = v_org_id
			and f.upload_status = 'uploaded'
		order by
			f.category,
			coalesce(f.captured_at, f.created_at) desc,
			f.created_at desc,
			f.id desc
	) selected
	on conflict (incident_revision_id, user_file_id) do nothing;

	return v_revision_id;
end;
$$;

revoke all on function public.create_incident_draft(text, integer, text) from public, anon;
grant execute on function public.create_incident_draft(text, integer, text) to authenticated;