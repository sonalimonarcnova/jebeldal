create or replace function private.enforce_completed_driver_profile()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
	v_profile_role text;
	v_profile_completed_at timestamptz;
	v_requires_completion boolean := false;
begin
	if tg_op = 'INSERT' then
		v_requires_completion := true;
	elsif new.status = 'submitted' and old.status is distinct from new.status then
		v_requires_completion := true;
	end if;

	if v_requires_completion then
		select p.role, p.profile_completed_at
		into v_profile_role, v_profile_completed_at
		from public.profiles p
		where p.user_id = new.reporter_id;

		if not found or v_profile_role <> 'driver' then
			raise exception using errcode = 'P0001', message = 'NOT_ALLOWED';
		end if;
		if v_profile_completed_at is null then
			raise exception using errcode = 'P0001', message = 'PROFILE_INCOMPLETE';
		end if;
	end if;

	return new;
end;
$$;

revoke all on function private.enforce_completed_driver_profile() from public, anon, authenticated;

create trigger incidents_require_completed_driver_profile
before insert or update on public.incidents
for each row execute function private.enforce_completed_driver_profile();