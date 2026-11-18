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

insert into public.organizations (id, display_name, legal_name, locale)
values (
  '11111111-1111-1111-1111-111111111111',
  'JebelAI Workshop Fleet',
  'JebelAI Workshop Logistics LLC',
  'en'
)
on conflict (id) do update
set
  display_name = excluded.display_name,
  legal_name = excluded.legal_name,
  locale = excluded.locale;

insert into public.vehicles (id, organization_id, unit_number, plate, make_model, vin)
values
  (
    '22222222-2222-2222-2222-222222222221',
    '11111111-1111-1111-1111-111111111111',
    'TRK-101',
    'TX-TRK-101',
    'Freightliner Cascadia',
    '1FUJGLDR9CSBS1011'
  ),
  (
    '22222222-2222-2222-2222-222222222222',
    '11111111-1111-1111-1111-111111111111',
    'TRK-102',
    'TX-TRK-102',
    'Volvo VNL 760',
    '4V4NC9EH8MN102222'
  )
on conflict (id) do update
set
  organization_id = excluded.organization_id,
  unit_number = excluded.unit_number,
  plate = excluded.plate,
  make_model = excluded.make_model,
  vin = excluded.vin;
