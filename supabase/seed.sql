insert into public.form_sets (form_set_key, version, definition)
values (
  'default',
  1,
  jsonb_build_object(
    'forms',
    jsonb_build_array('auto', 'general_liability', 'workers_comp'),
    'interview_graph',
    $interview_graph$
    {
      "schema_version": 1,
      "question_count": 38,
      "condition_count": 17,
      "source": "docs/JebelAI_User_Stories (1).xlsx#Question Bank",
      "form_key_map": {"Auto":"auto","GL":"general_liability","WC":"workers_comp"},
      "nodes": [
        {"sequence":1,"source_order":"1","key":"what_happened","section":"Scene","prompt":"What happened?","ui_type":"voice_open","options":[],"quick_reply":null,"forms_source":"Auto, GL, WC","show_if_source":"always","condition_key":null,"notes":"Main extraction source for everything after."},
        {"sequence":2,"source_order":"2","key":"involved","section":"Scene","prompt":"What else was involved?","ui_type":"multi_select","options":["Another vehicle","A building, fence, or object","Customer says our delivery caused it","Just my truck"],"quick_reply":null,"forms_source":"Auto, GL","show_if_source":"always","condition_key":null,"notes":"Drives 4 branches + seatbelt + prevention."},
        {"sequence":3,"source_order":"3","key":"trip","section":"Scene","prompt":"What kind of trip were you on?","ui_type":"single_select","options":["Dispatched load","Other work task","To or from work","Parked or in the yard"],"quick_reply":null,"forms_source":"Auto, WC","show_if_source":"always","condition_key":null,"notes":"Voice maps to option ('Dispatched route, with permission' → Dispatched load)."},
        {"sequence":4,"source_order":"4","key":"weather_road","section":"Scene","prompt":"How was the weather and the road?","ui_type":"multi_select","options":["Clear","Rain","Ice or snow","Fog","Dark","…"],"unresolved_options":["…"],"quick_reply":null,"forms_source":"Auto, GL","show_if_source":"always","condition_key":null,"notes":"Pre-select from weather data."},
        {"sequence":5,"source_order":"5","key":"other_vehicle","section":"Scene","prompt":"Tell me about the other vehicle.","ui_type":"voice_open","options":[],"quick_reply":"It drove off","forms_source":"Auto","show_if_source":"involved has another_vehicle","condition_key":"involved_has_another_vehicle","notes":"Draft – change later. Helper: make, colour and plate, if you saw it. Try: 'Silver Toyota Camry, Texas plate ABC-1234'"},
        {"sequence":6,"source_order":"6","key":"other_driver","section":"People","prompt":"Who was driving the other vehicle?","ui_type":"voice_open","options":[],"quick_reply":"Didn't get it","forms_source":"Auto","show_if_source":"involved has another_vehicle","condition_key":"involved_has_another_vehicle","notes":"Draft – change later. Helper: name, phone and insurance. Try: 'Dana Cole, 512-555-0199, State Farm'"},
        {"sequence":7,"source_order":"7","key":"property_damaged","section":"Scene","prompt":"What got damaged, and how bad?","ui_type":"voice_open","options":[],"quick_reply":"Nothing else was damaged","forms_source":"GL","show_if_source":"involved has object","condition_key":"involved_has_object","notes":"Hint: 'Dock door 3 is bent, won't close'"},
        {"sequence":8,"source_order":"8","key":"property_owner","section":"Scene","prompt":"Who owns it?","ui_type":"voice_open","options":[],"quick_reply":"Not applicable","forms_source":"GL","show_if_source":"involved has object","condition_key":"involved_has_object","notes":"Hint: 'Acme Foods, ask for Jen, 515-555-0110'"},
        {"sequence":9,"source_order":"9","key":"place_type","section":"Scene","prompt":"What kind of place was it?","ui_type":"single_select","options":["Customer's site","Our yard or terminal","Public road","Job site"],"quick_reply":null,"forms_source":"GL","show_if_source":"involved has object OR delivery_claim","condition_key":"involved_has_object_or_delivery_claim"},
        {"sequence":10,"source_order":"10","key":"delivery_work","section":"Scene","prompt":"What were you delivering or doing there?","ui_type":"voice_open","options":[],"quick_reply":"Not applicable","forms_source":"GL","show_if_source":"involved has delivery_claim","condition_key":"involved_has_delivery_claim","notes":"Draft – change later. Try: 'Dropping 12 pallets at Acme Foods, dock 3'"},
        {"sequence":11,"source_order":"11","key":"product_kept","section":"Scene","prompt":"Did the customer keep the product?","ui_type":"single_select","options":["Kept all of it","Kept some, refused some","Refused all of it","Not sure"],"quick_reply":"Not applicable","forms_source":"GL","show_if_source":"involved has delivery_claim","condition_key":"involved_has_delivery_claim","notes":"Draft – change later."},
        {"sequence":12,"source_order":"12","key":"injuries","section":"People","prompt":"Was anyone hurt?","ui_type":"single_select","options":["No one","Yes, me","Someone else","Me and someone else"],"quick_reply":null,"forms_source":"Auto, GL, WC","show_if_source":"always","condition_key":null,"notes":"Safety question: never skipped silently. Drives WC."},
        {"sequence":13,"source_order":"13","key":"seatbelt","section":"People","prompt":"Were you wearing your seatbelt?","ui_type":"single_select","options":["Yes","No","Not sure"],"quick_reply":null,"forms_source":"Auto","show_if_source":"involved has another_vehicle","condition_key":"involved_has_another_vehicle","notes":"Draft – change later. Example answer: 'Seatbelt on'"},
        {"sequence":14,"source_order":"14","key":"driver_injury_where","section":"People","prompt":"Where are you hurt?","ui_type":"multi_select","options":["Head","Neck","Back","Shoulder or arm","Hand or wrist","Chest","Hip or leg","Foot or ankle","Other"],"quick_reply":null,"forms_source":"WC","show_if_source":"injuries in (me, me_and_someone)","condition_key":"injuries_in_me_or_me_and_someone","notes":"Draft – change later. Tap all that apply, or say it."},
        {"sequence":15,"source_order":"15","key":"driver_injury_kind","section":"People","prompt":"What kind of injury is it?","ui_type":"single_select","options":["Cut or scrape","Bruise","Strain or sprain","Broken bone","Burn","Pain, nothing visible","Not sure"],"quick_reply":null,"forms_source":"WC","show_if_source":"injuries in (me, me_and_someone)","condition_key":"injuries_in_me_or_me_and_someone","notes":"Draft – change later. Example: 'Strain or sprain'"},
        {"sequence":16,"source_order":"16","key":"driver_activity","section":"People","prompt":"What were you doing when it happened?","ui_type":"single_select","options":["Driving","Loading or unloading","Coupling or uncoupling","Getting in or out of the cab","Securing the load","Inspection","Other"],"quick_reply":null,"forms_source":"WC","show_if_source":"injuries in (me, me_and_someone)","condition_key":"injuries_in_me_or_me_and_someone","notes":"Draft – change later. Example: 'Driving'"},
        {"sequence":17,"source_order":"17","key":"driver_injury_cause","section":"People","prompt":"What hurt you?","ui_type":"single_select","options":["Vehicle collision","Slip or fall","Lifting or pulling","Struck by an object","Caught in or between","Other"],"quick_reply":null,"forms_source":"WC","show_if_source":"injuries in (me, me_and_someone)","condition_key":"injuries_in_me_or_me_and_someone","notes":"Draft – change later. Example: 'Vehicle collision'"},
        {"sequence":18,"source_order":"18","key":"driver_treatment","section":"People","prompt":"Did you get any treatment?","ui_type":"single_select","options":["None needed","First aid at the scene","Doctor or clinic","ER or hospital","Going later"],"quick_reply":null,"forms_source":"WC, Auto","show_if_source":"injuries in (me, me_and_someone)","condition_key":"injuries_in_me_or_me_and_someone","notes":"Draft – change later. Feeds DOT recordable + drug test rule."},
        {"sequence":19,"source_order":"18a","key":"doctor_clinic","section":"People","prompt":"Which doctor or clinic?","ui_type":"voice_open","options":[],"quick_reply":"Don't know yet","forms_source":"WC","show_if_source":"driver_treatment = doctor_or_clinic","condition_key":"driver_treatment_is_doctor_or_clinic","notes":"Draft – change later. Try: 'CareNow urgent care on Lamar'"},
        {"sequence":20,"source_order":"18b","key":"serious_injury","section":"People","prompt":"Were you kept in hospital?","ui_type":"single_select","options":["Treated and released","Admitted overnight or longer","Still at the ER","Not sure"],"quick_reply":null,"forms_source":"WC, Auto","show_if_source":"driver_treatment = er_or_hospital","condition_key":"driver_treatment_is_er_or_hospital","notes":"Draft – change later. Branch: 'If ER or hospital'"},
        {"sequence":21,"source_order":"18c","key":"work_status","section":"People","prompt":"Can you keep working?","ui_type":"single_select","options":["Yes, full duty","Light duty only","Can't work right now","Not sure"],"quick_reply":null,"forms_source":"WC","show_if_source":"injuries in (me, me_and_someone)","condition_key":"injuries_in_me_or_me_and_someone","notes":"Draft – change later. Node label inferred from flow graph."},
        {"sequence":22,"source_order":"19","key":"other_person_hurt","section":"People","prompt":"Who was hurt, and how?","ui_type":"voice_open","options":[],"quick_reply":null,"forms_source":"Auto, GL","show_if_source":"injuries in (someone_else, me_and_someone)","condition_key":"injuries_in_someone_else_or_me_and_someone","notes":"Draft – change later. Try: 'The other driver hurt her wrist'"},
        {"sequence":23,"source_order":"19a","key":"other_person_type","section":"People","prompt":"Who are they?","ui_type":"single_select","options":["A coworker","The other driver","A passenger","A pedestrian or cyclist","A customer or their staff","A child"],"quick_reply":null,"forms_source":"Auto, GL, WC","show_if_source":"injuries in (someone_else, me_and_someone)","condition_key":"injuries_in_someone_else_or_me_and_someone","notes":"Draft – change later. Coworker → WC; others → Auto / GL."},
        {"sequence":24,"source_order":"19b","key":"child_seat","section":"People","prompt":"Was the child in a car seat?","ui_type":"single_select","options":["Yes","No","Not sure"],"quick_reply":null,"forms_source":"Auto","show_if_source":"other_person_type = child","condition_key":"other_person_type_is_child","notes":"Draft – change later. Branch: 'If a child'"},
        {"sequence":25,"source_order":"19c","key":"their_treatment","section":"People","prompt":"What treatment did they get?","ui_type":"single_select","options":["None needed","First aid at the scene","Ambulance took them","Went to a doctor or ER","Not sure"],"quick_reply":null,"forms_source":"Auto, GL","show_if_source":"injuries in (someone_else, me_and_someone)","condition_key":"injuries_in_someone_else_or_me_and_someone","notes":"Draft – change later. Feeds DOT recordable."},
        {"sequence":26,"source_order":"20","key":"truck_damage","section":"Damage","prompt":"Where is your truck damaged?","ui_type":"truck_diagram (2D + 3D)","options":["Cab L","Cab R","Trailer front L","Trailer front R","Trailer mid L","Trailer mid R","Trailer rear L","Trailer rear R","Rear","Front bumper"],"quick_reply":"No damage","forms_source":"Auto","show_if_source":"always","condition_key":null,"notes":"Example: 'Front bumper is bent …'"},
        {"sequence":27,"source_order":"21","key":"drivable","section":"Damage","prompt":"Can you still drive the truck?","ui_type":"single_select","options":["Yes, I can drive it","Needs a tow"],"quick_reply":null,"forms_source":"Auto","show_if_source":"truck_damage != none","condition_key":"truck_damage_not_none","notes":"Needs a tow → adds Towed to, Leak or spill."},
        {"sequence":28,"source_order":"22","key":"towed_to","section":"Damage","prompt":"Where is the truck being towed?","ui_type":"voice_open","options":[],"quick_reply":"Not towed yet","forms_source":"Auto","show_if_source":"drivable = needs_tow","condition_key":"drivable_is_needs_tow","notes":"Draft – change later. Try: 'Northwind Austin terminal'"},
        {"sequence":29,"source_order":"23","key":"cargo","section":"Damage","prompt":"What were you carrying? Is the cargo okay?","ui_type":"single_select + voice","options":["Cargo is fine","Some damage","Running empty","Not sure"],"quick_reply":null,"forms_source":"Auto","show_if_source":"always","condition_key":null,"notes":"Example: 'Palletized dry goods, cargo is …'"},
        {"sequence":30,"source_order":"24","key":"leak_spill","section":"Damage","prompt":"Did anything leak or spill?","ui_type":"single_select","options":["No leak","Yes, hazmat","Yes, not hazmat","Not sure"],"quick_reply":null,"forms_source":"Auto","show_if_source":"cargo = some_damage OR drivable = needs_tow","condition_key":"cargo_some_damage_or_drivable_needs_tow"},
        {"sequence":31,"source_order":"25","key":"hazmat_details","section":"Damage","prompt":"What leaked, and about how much?","ui_type":"voice_open","options":[],"quick_reply":null,"forms_source":"Auto","show_if_source":"leak_spill = yes_hazmat","condition_key":"leak_spill_is_yes_hazmat","notes":"Draft – change later. Helper: placard or UN number if you can see it. Try: 'Diesel from the saddle tank, about 20 gallons'"},
        {"sequence":32,"source_order":"26","key":"police","section":"Wrap-up","prompt":"Did the police come?","ui_type":"single_select","options":["Yes, they came","On the way","No police","Not sure"],"quick_reply":null,"forms_source":"Auto, GL","show_if_source":"always","condition_key":null},
        {"sequence":33,"source_order":"27","key":"police_report_no","section":"Wrap-up","prompt":"What is the police report number?","ui_type":"voice_open","options":[],"quick_reply":"No number yet","forms_source":"Auto, GL","show_if_source":"police in (came, on_the_way)","condition_key":"police_in_came_or_on_the_way","notes":"Hint: 'Austin PD, 26-0912-0387'"},
        {"sequence":34,"source_order":"28","key":"tickets","section":"Wrap-up","prompt":"Did anyone get a ticket?","ui_type":"single_select","options":["No tickets","I got a ticket","The other driver got one","We both did","Not sure"],"quick_reply":null,"forms_source":"Auto","show_if_source":"police in (came, on_the_way)","condition_key":"police_in_came_or_on_the_way","notes":"Draft – change later. Screenshot missing; built from the single-choice component. Feeds drug test rule."},
        {"sequence":35,"source_order":"29","key":"drug_alcohol_test","section":"Wrap-up","prompt":"Have you been told to take a drug and alcohol test?","ui_type":"single_select","options":["Done already","Scheduled","Not told yet","Not sure"],"quick_reply":null,"forms_source":"Auto","show_if_source":"DOT post-accident test rule = true","condition_key":"dot_post_accident_test_rule","notes":"Draft – change later. Helper: 'DOT rules may need one after this kind of crash.' Rule: 49 CFR 382.303."},
        {"sequence":36,"source_order":"30","key":"video","section":"Wrap-up","prompt":"Is there any video of it?","ui_type":"multi_select","options":["Truck dash cam","Phone video","Other driver's camera","Business security camera","No video","Not sure"],"quick_reply":null,"forms_source":"Auto, GL","show_if_source":"always","condition_key":null,"notes":"Draft – change later. Screenshot missing; built from the multi-select component."},
        {"sequence":37,"source_order":"31","key":"prevention","section":"Wrap-up","prompt":"What would stop this from happening again?","ui_type":"multi_select","options":["Fix equipment","More training","Better safety gear","Fix the site","More time","…","Not preventable"],"unresolved_options":["…"],"quick_reply":null,"forms_source":"WC, GL","show_if_source":"injuries != no_one OR involved has object OR involved has delivery_claim","condition_key":"injuries_not_no_one_or_object_or_delivery_claim"},
        {"sequence":38,"source_order":"32","key":"witnesses","section":"Wrap-up","prompt":"Did anyone see it happen?","ui_type":"voice_open","options":[],"quick_reply":"No one saw it","forms_source":"Auto, GL, WC","show_if_source":"always","condition_key":null,"notes":"Hint: 'Luis, 512-555-0142'"}
      ],
      "conditions": [
        {"key":"involved_has_another_vehicle","source":"involved has another_vehicle","node_keys":["other_vehicle","other_driver","seatbelt"]},
        {"key":"involved_has_object","source":"involved has object","node_keys":["property_damaged","property_owner"]},
        {"key":"involved_has_object_or_delivery_claim","source":"involved has object OR delivery_claim","node_keys":["place_type"]},
        {"key":"involved_has_delivery_claim","source":"involved has delivery_claim","node_keys":["delivery_work","product_kept"]},
        {"key":"injuries_in_me_or_me_and_someone","source":"injuries in (me, me_and_someone)","node_keys":["driver_injury_where","driver_injury_kind","driver_activity","driver_injury_cause","driver_treatment","work_status"]},
        {"key":"driver_treatment_is_doctor_or_clinic","source":"driver_treatment = doctor_or_clinic","node_keys":["doctor_clinic"]},
        {"key":"driver_treatment_is_er_or_hospital","source":"driver_treatment = er_or_hospital","node_keys":["serious_injury"]},
        {"key":"injuries_in_someone_else_or_me_and_someone","source":"injuries in (someone_else, me_and_someone)","node_keys":["other_person_hurt","other_person_type","their_treatment"]},
        {"key":"other_person_type_is_child","source":"other_person_type = child","node_keys":["child_seat"]},
        {"key":"truck_damage_not_none","source":"truck_damage != none","node_keys":["drivable"]},
        {"key":"drivable_is_needs_tow","source":"drivable = needs_tow","node_keys":["towed_to"]},
        {"key":"cargo_some_damage_or_drivable_needs_tow","source":"cargo = some_damage OR drivable = needs_tow","node_keys":["leak_spill"]},
        {"key":"leak_spill_is_yes_hazmat","source":"leak_spill = yes_hazmat","node_keys":["hazmat_details"]},
        {"key":"police_in_came_or_on_the_way","source":"police in (came, on_the_way)","node_keys":["police_report_no","tickets"]},
        {"key":"dot_post_accident_test_rule","source":"DOT post-accident test rule = true","node_keys":["drug_alcohol_test"]},
        {"key":"injuries_not_no_one_or_object_or_delivery_claim","source":"injuries != no_one OR involved has object OR involved has delivery_claim","node_keys":["prevention"]},
        {"key":"photos_videos_shot_list_depends_on_answers","source":"always (shot list depends on answers)","scope":"screen","target":"photos_videos"}
      ]
    }
    $interview_graph$::jsonb
  )
)
on conflict (form_set_key, version) do update
set definition = public.form_sets.definition || excluded.definition;

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
