create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  legal_name text,
  locale text not null default 'en',
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.form_definitions (
  id uuid primary key default gen_random_uuid(),
  form_key text not null,
  version integer not null,
  definition jsonb not null,
  status text not null default 'active' check (status in ('draft', 'active', 'archived')),
  created_at timestamptz not null default timezone('utc', now()),
  unique (form_key, version)
);

create table if not exists public.form_sets (
  id uuid primary key default gen_random_uuid(),
  form_set_key text not null,
  version integer not null,
  definition jsonb not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (form_set_key, version)
);

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  role text not null default 'driver' check (role in ('driver', 'manager')),
  display_name text not null,
  phone text,
  assigned_vehicle_id uuid,
  preferred_language text not null default 'en',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  unit_number text not null,
  plate text,
  make_model text,
  vin text,
  created_at timestamptz not null default timezone('utc', now()),
  unique (organization_id, unit_number)
);

alter table public.profiles
drop constraint if exists profiles_assigned_vehicle_id_fkey;

alter table public.profiles
add constraint profiles_assigned_vehicle_id_fkey
foreign key (assigned_vehicle_id) references public.vehicles(id) on delete set null;

create table if not exists public.incidents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  reporter_id uuid not null references public.profiles(user_id) on delete restrict,
  active_revision_id uuid,
  status text not null default 'draft' check (status in ('draft', 'submitted')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.incident_revisions (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  revision_number integer not null,
  form_set_key text not null,
  form_set_version integer not null,
  language text not null default 'en',
  status text not null default 'draft' check (status in ('draft', 'submitted')),
  version integer not null default 1,
  occurred_at timestamptz,
  location jsonb,
  submitted_snapshot jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  submitted_at timestamptz,
  unique (incident_id, revision_number)
);

alter table public.incidents
drop constraint if exists incidents_active_revision_id_fkey;

alter table public.incidents
add constraint incidents_active_revision_id_fkey
foreign key (active_revision_id) references public.incident_revisions(id) on delete set null;

create table if not exists public.conversation_turns (
  id uuid primary key default gen_random_uuid(),
  incident_revision_id uuid not null references public.incident_revisions(id) on delete cascade,
  client_turn_id text not null,
  sequence integer not null check (sequence > 0),
  speaker text not null default 'driver' check (speaker in ('driver', 'assistant', 'system')),
  input_kind text not null check (input_kind in ('audio', 'text')),
  transcript text,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed')),
  extraction_proposals jsonb,
  error_code text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (incident_revision_id, client_turn_id),
  unique (incident_revision_id, sequence)
);

create table if not exists public.incident_answer_groups (
  id uuid primary key default gen_random_uuid(),
  incident_revision_id uuid not null references public.incident_revisions(id) on delete cascade,
  form_key text not null,
  group_key text not null,
  position integer not null check (position >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  unique (incident_revision_id, form_key, group_key, position)
);

create table if not exists public.incident_answers (
  id uuid primary key default gen_random_uuid(),
  incident_revision_id uuid not null references public.incident_revisions(id) on delete cascade,
  form_key text not null,
  field_key text not null,
  group_instance_id uuid references public.incident_answer_groups(id) on delete set null,
  value jsonb,
  answer_state text not null check (answer_state in ('confirmed', 'unknown', 'declined', 'not_applicable', 'pending_follow_up')),
  source text not null default 'manual',
  confidence numeric(5,4),
  transcript_turn_id uuid references public.conversation_turns(id) on delete set null,
  updated_by uuid not null references public.profiles(user_id) on delete restrict,
  updated_at timestamptz not null default timezone('utc', now()),
  unique (incident_revision_id, form_key, field_key, group_instance_id)
);

create table if not exists public.evidence (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  incident_revision_id uuid not null references public.incident_revisions(id) on delete cascade,
  object_path text not null unique,
  media_type text not null check (media_type in ('audio', 'photo', 'video')),
  size_bytes bigint check (size_bytes > 0),
  upload_status text not null default 'pending' check (upload_status in ('pending', 'uploaded', 'failed')),
  uploaded_by uuid not null references public.profiles(user_id) on delete restrict,
  capture_time timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.signatures (
  incident_revision_id uuid primary key references public.incident_revisions(id) on delete cascade,
  signer_id uuid not null references public.profiles(user_id) on delete restrict,
  auth_method text not null check (auth_method in ('biometric', 'device_passcode')),
  device_description text not null,
  driver_name text not null,
  signed_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_profiles_organization_id on public.profiles(organization_id);
create index if not exists idx_vehicles_organization_id on public.vehicles(organization_id);
create index if not exists idx_incidents_org_reporter on public.incidents(organization_id, reporter_id);
create index if not exists idx_incident_revisions_incident on public.incident_revisions(incident_id);
create index if not exists idx_conversation_turns_revision on public.conversation_turns(incident_revision_id);
create index if not exists idx_answers_revision_form_field on public.incident_answers(incident_revision_id, form_key, field_key);
create index if not exists idx_evidence_revision on public.evidence(incident_revision_id);

create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger set_incidents_updated_at
before update on public.incidents
for each row execute function public.set_updated_at();

create trigger set_incident_revisions_updated_at
before update on public.incident_revisions
for each row execute function public.set_updated_at();

create trigger set_conversation_turns_updated_at
before update on public.conversation_turns
for each row execute function public.set_updated_at();

create or replace function public.current_organization_id()
returns uuid
language sql
stable
security invoker
set search_path = public
as $$
  select organization_id
  from public.profiles
  where user_id = (select auth.uid());
$$;

create or replace function public.create_incident_draft(
  p_form_set_key text default 'default',
  p_form_set_version integer default 1,
  p_language text default 'en'
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_org_id uuid;
  v_incident_id uuid;
  v_revision_id uuid;
begin
  select organization_id
  into v_org_id
  from public.profiles
  where user_id = (select auth.uid());

  if v_org_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  insert into public.incidents (organization_id, reporter_id)
  values (v_org_id, (select auth.uid()))
  returning id into v_incident_id;

  insert into public.incident_revisions (
    incident_id,
    organization_id,
    revision_number,
    form_set_key,
    form_set_version,
    language
  )
  values (
    v_incident_id,
    v_org_id,
    1,
    p_form_set_key,
    p_form_set_version,
    p_language
  )
  returning id into v_revision_id;

  update public.incidents
  set active_revision_id = v_revision_id
  where id = v_incident_id;

  return v_revision_id;
end;
$$;

grant usage on schema public to anon, authenticated;

grant select on public.form_definitions, public.form_sets to authenticated;
grant select, update on public.profiles to authenticated;
grant select on public.organizations, public.vehicles to authenticated;
grant select, insert, update on public.incidents, public.incident_revisions to authenticated;
grant select, insert, update on public.conversation_turns, public.incident_answers, public.evidence, public.signatures to authenticated;
grant select, insert, update on public.incident_answer_groups to authenticated;
grant execute on function public.create_incident_draft(text, integer, text) to authenticated;
grant execute on function public.current_organization_id() to authenticated;

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.vehicles enable row level security;
alter table public.incidents enable row level security;
alter table public.incident_revisions enable row level security;
alter table public.conversation_turns enable row level security;
alter table public.incident_answer_groups enable row level security;
alter table public.incident_answers enable row level security;
alter table public.evidence enable row level security;
alter table public.signatures enable row level security;
alter table public.form_definitions enable row level security;
alter table public.form_sets enable row level security;

drop policy if exists organizations_select_own on public.organizations;
create policy organizations_select_own
on public.organizations
for select
to authenticated
using (id = public.current_organization_id());

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
on public.profiles
for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
on public.profiles
for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists vehicles_select_org on public.vehicles;
create policy vehicles_select_org
on public.vehicles
for select
to authenticated
using (organization_id = public.current_organization_id());

drop policy if exists incidents_select_own on public.incidents;
create policy incidents_select_own
on public.incidents
for select
to authenticated
using (
  organization_id = public.current_organization_id()
  and reporter_id = (select auth.uid())
);

drop policy if exists incidents_insert_own on public.incidents;
create policy incidents_insert_own
on public.incidents
for insert
to authenticated
with check (
  organization_id = public.current_organization_id()
  and reporter_id = (select auth.uid())
);

drop policy if exists incidents_update_own on public.incidents;
create policy incidents_update_own
on public.incidents
for update
to authenticated
using (
  organization_id = public.current_organization_id()
  and reporter_id = (select auth.uid())
)
with check (
  organization_id = public.current_organization_id()
  and reporter_id = (select auth.uid())
);

drop policy if exists incident_revisions_select_own on public.incident_revisions;
create policy incident_revisions_select_own
on public.incident_revisions
for select
to authenticated
using (
  organization_id = public.current_organization_id()
  and exists (
    select 1
    from public.incidents i
    where i.id = incident_revisions.incident_id
      and i.reporter_id = (select auth.uid())
  )
);

drop policy if exists incident_revisions_insert_own on public.incident_revisions;
create policy incident_revisions_insert_own
on public.incident_revisions
for insert
to authenticated
with check (
  organization_id = public.current_organization_id()
  and exists (
    select 1
    from public.incidents i
    where i.id = incident_revisions.incident_id
      and i.reporter_id = (select auth.uid())
  )
);

drop policy if exists incident_revisions_update_own on public.incident_revisions;
create policy incident_revisions_update_own
on public.incident_revisions
for update
to authenticated
using (
  organization_id = public.current_organization_id()
  and exists (
    select 1
    from public.incidents i
    where i.id = incident_revisions.incident_id
      and i.reporter_id = (select auth.uid())
  )
)
with check (
  organization_id = public.current_organization_id()
);

drop policy if exists conversation_turns_select_own on public.conversation_turns;
create policy conversation_turns_select_own
on public.conversation_turns
for select
to authenticated
using (
  exists (
    select 1
    from public.incident_revisions ir
    join public.incidents i on i.id = ir.incident_id
    where ir.id = conversation_turns.incident_revision_id
      and i.reporter_id = (select auth.uid())
      and ir.organization_id = public.current_organization_id()
  )
);

drop policy if exists conversation_turns_insert_own on public.conversation_turns;
create policy conversation_turns_insert_own
on public.conversation_turns
for insert
to authenticated
with check (
  exists (
    select 1
    from public.incident_revisions ir
    join public.incidents i on i.id = ir.incident_id
    where ir.id = conversation_turns.incident_revision_id
      and i.reporter_id = (select auth.uid())
      and ir.organization_id = public.current_organization_id()
  )
);

drop policy if exists conversation_turns_update_own on public.conversation_turns;
create policy conversation_turns_update_own
on public.conversation_turns
for update
to authenticated
using (
  exists (
    select 1
    from public.incident_revisions ir
    join public.incidents i on i.id = ir.incident_id
    where ir.id = conversation_turns.incident_revision_id
      and i.reporter_id = (select auth.uid())
      and ir.organization_id = public.current_organization_id()
  )
)
with check (
  exists (
    select 1
    from public.incident_revisions ir
    join public.incidents i on i.id = ir.incident_id
    where ir.id = conversation_turns.incident_revision_id
      and i.reporter_id = (select auth.uid())
      and ir.organization_id = public.current_organization_id()
  )
);

drop policy if exists answer_groups_select_own on public.incident_answer_groups;
create policy answer_groups_select_own
on public.incident_answer_groups
for select
to authenticated
using (
  exists (
    select 1
    from public.incident_revisions ir
    join public.incidents i on i.id = ir.incident_id
    where ir.id = incident_answer_groups.incident_revision_id
      and i.reporter_id = (select auth.uid())
      and ir.organization_id = public.current_organization_id()
  )
);

drop policy if exists answer_groups_insert_own on public.incident_answer_groups;
create policy answer_groups_insert_own
on public.incident_answer_groups
for insert
to authenticated
with check (
  exists (
    select 1
    from public.incident_revisions ir
    join public.incidents i on i.id = ir.incident_id
    where ir.id = incident_answer_groups.incident_revision_id
      and i.reporter_id = (select auth.uid())
      and ir.organization_id = public.current_organization_id()
  )
);

drop policy if exists answer_groups_update_own on public.incident_answer_groups;
create policy answer_groups_update_own
on public.incident_answer_groups
for update
to authenticated
using (
  exists (
    select 1
    from public.incident_revisions ir
    join public.incidents i on i.id = ir.incident_id
    where ir.id = incident_answer_groups.incident_revision_id
      and i.reporter_id = (select auth.uid())
      and ir.organization_id = public.current_organization_id()
  )
)
with check (
  exists (
    select 1
    from public.incident_revisions ir
    join public.incidents i on i.id = ir.incident_id
    where ir.id = incident_answer_groups.incident_revision_id
      and i.reporter_id = (select auth.uid())
      and ir.organization_id = public.current_organization_id()
  )
);

drop policy if exists incident_answers_select_own on public.incident_answers;
create policy incident_answers_select_own
on public.incident_answers
for select
to authenticated
using (
  exists (
    select 1
    from public.incident_revisions ir
    join public.incidents i on i.id = ir.incident_id
    where ir.id = incident_answers.incident_revision_id
      and i.reporter_id = (select auth.uid())
      and ir.organization_id = public.current_organization_id()
  )
);

drop policy if exists incident_answers_insert_own on public.incident_answers;
create policy incident_answers_insert_own
on public.incident_answers
for insert
to authenticated
with check (
  exists (
    select 1
    from public.incident_revisions ir
    join public.incidents i on i.id = ir.incident_id
    where ir.id = incident_answers.incident_revision_id
      and i.reporter_id = (select auth.uid())
      and ir.organization_id = public.current_organization_id()
  )
  and updated_by = (select auth.uid())
);

drop policy if exists incident_answers_update_own on public.incident_answers;
create policy incident_answers_update_own
on public.incident_answers
for update
to authenticated
using (
  exists (
    select 1
    from public.incident_revisions ir
    join public.incidents i on i.id = ir.incident_id
    where ir.id = incident_answers.incident_revision_id
      and i.reporter_id = (select auth.uid())
      and ir.organization_id = public.current_organization_id()
  )
)
with check (
  exists (
    select 1
    from public.incident_revisions ir
    join public.incidents i on i.id = ir.incident_id
    where ir.id = incident_answers.incident_revision_id
      and i.reporter_id = (select auth.uid())
      and ir.organization_id = public.current_organization_id()
  )
  and updated_by = (select auth.uid())
);

drop policy if exists evidence_select_own on public.evidence;
create policy evidence_select_own
on public.evidence
for select
to authenticated
using (
  organization_id = public.current_organization_id()
  and uploaded_by = (select auth.uid())
);

drop policy if exists evidence_insert_own on public.evidence;
create policy evidence_insert_own
on public.evidence
for insert
to authenticated
with check (
  organization_id = public.current_organization_id()
  and uploaded_by = (select auth.uid())
);

drop policy if exists evidence_update_own on public.evidence;
create policy evidence_update_own
on public.evidence
for update
to authenticated
using (
  organization_id = public.current_organization_id()
  and uploaded_by = (select auth.uid())
)
with check (
  organization_id = public.current_organization_id()
  and uploaded_by = (select auth.uid())
);

drop policy if exists signatures_select_own on public.signatures;
create policy signatures_select_own
on public.signatures
for select
to authenticated
using (
  signer_id = (select auth.uid())
  and exists (
    select 1
    from public.incident_revisions ir
    join public.incidents i on i.id = ir.incident_id
    where ir.id = signatures.incident_revision_id
      and i.reporter_id = (select auth.uid())
      and ir.organization_id = public.current_organization_id()
  )
);

drop policy if exists signatures_insert_own on public.signatures;
create policy signatures_insert_own
on public.signatures
for insert
to authenticated
with check (
  signer_id = (select auth.uid())
  and exists (
    select 1
    from public.incident_revisions ir
    join public.incidents i on i.id = ir.incident_id
    where ir.id = signatures.incident_revision_id
      and i.reporter_id = (select auth.uid())
      and ir.organization_id = public.current_organization_id()
  )
);

drop policy if exists signatures_update_own on public.signatures;
create policy signatures_update_own
on public.signatures
for update
to authenticated
using (
  signer_id = (select auth.uid())
  and exists (
    select 1
    from public.incident_revisions ir
    join public.incidents i on i.id = ir.incident_id
    where ir.id = signatures.incident_revision_id
      and i.reporter_id = (select auth.uid())
      and ir.organization_id = public.current_organization_id()
  )
)
with check (
  signer_id = (select auth.uid())
);

drop policy if exists form_definitions_select_authenticated on public.form_definitions;
create policy form_definitions_select_authenticated
on public.form_definitions
for select
to authenticated
using (status = 'active');

drop policy if exists form_sets_select_authenticated on public.form_sets;
create policy form_sets_select_authenticated
on public.form_sets
for select
to authenticated
using (true);

insert into storage.buckets (id, name, public, file_size_limit)
values ('incident-evidence', 'incident-evidence', false, 52428800)
on conflict (id) do nothing;

drop policy if exists storage_incident_evidence_select on storage.objects;
create policy storage_incident_evidence_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'incident-evidence'
  and (storage.foldername(name))[1] = public.current_organization_id()::text
);

drop policy if exists storage_incident_evidence_insert on storage.objects;
create policy storage_incident_evidence_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'incident-evidence'
  and (storage.foldername(name))[1] = public.current_organization_id()::text
);

drop policy if exists storage_incident_evidence_update on storage.objects;
create policy storage_incident_evidence_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'incident-evidence'
  and (storage.foldername(name))[1] = public.current_organization_id()::text
)
with check (
  bucket_id = 'incident-evidence'
  and (storage.foldername(name))[1] = public.current_organization_id()::text
);