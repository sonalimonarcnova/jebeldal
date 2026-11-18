insert into public.form_sets (form_set_key, version, definition)
values (
  'default',
  1,
  jsonb_build_object(
    'forms',
    jsonb_build_array('auto', 'general_liability', 'workers_comp')
  )
)
on conflict (form_set_key, version) do nothing;
