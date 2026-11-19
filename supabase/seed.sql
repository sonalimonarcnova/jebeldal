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

insert into public.form_definitions (form_key, version, definition, status)
values
  (
    'auto',
    1,
    $auto$
    {
      "fields": [
        {"key":"what_happened","type":"long_text","required":true},
        {"key":"property_damaged","type":"boolean","required":true},
        {"key":"delivery_work","type":"boolean","required":true},
        {"key":"injuries","type":"boolean","required":true},
        {"key":"other_vehicle","type":"boolean","required":true},
        {"key":"police","type":"boolean","required":true}
      ],
      "requiredEvidence": [
        {
          "field_key":"incident_photos",
          "media_type":"photo",
          "minimum":1,
          "when":{"any":[
            {"op":"eq","field_key":"property_damaged","value":true},
            {"op":"eq","field_key":"injuries","value":true}
          ]}
        }
      ]
    }
    $auto$::jsonb,
    'active'
  ),
  (
    'general_liability',
    1,
    '{"fields":[{"key":"claim_details","type":"long_text","required":true}]}'::jsonb,
    'active'
  ),
  (
    'workers_comp',
    1,
    '{"fields":[{"key":"injury_details","type":"long_text","required":true}]}'::jsonb,
    'active'
  )
on conflict (form_key, version) do nothing;

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

insert into public.policies (
  id, organization_id, policy_number, carrier_name, naic_number,
  agent, effective_from, effective_to, coverage
)
values (
  '33333333-3333-4333-8333-333333333331',
  '11111111-1111-1111-1111-111111111111',
  'DEMO-AUTO-2026',
  'Fictional Mutual',
  '00000',
  '{"name":"Demo Agent","phone":"555-0100"}'::jsonb,
  '2026-01-01',
  '2026-12-31',
  '{"auto":{"limit":1000000},"general_liability":{"limit":500000},"workers_comp":{"limit":"statutory-demo"}}'::jsonb
)
on conflict (id) do update
set policy_number = excluded.policy_number,
    carrier_name = excluded.carrier_name,
    naic_number = excluded.naic_number,
    agent = excluded.agent,
    effective_from = excluded.effective_from,
    effective_to = excluded.effective_to,
    coverage = excluded.coverage;
