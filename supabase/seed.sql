insert into public.form_sets (form_set_key, version, definition)
values (
  'default',
  1,
  jsonb_build_object(
    'forms',
    jsonb_build_array('auto', 'general_liability', 'workers_comp'),
    'activation_rules',
    jsonb_build_object(
      'general_liability',
      jsonb_build_object(
        'op', 'contains_any',
        'field_key', 'involved',
        'values', jsonb_build_array('object', 'delivery_claim')
      ),
      'workers_comp',
      jsonb_build_object('any', jsonb_build_array(
        jsonb_build_object('op', 'eq', 'field_key', 'injuries', 'value', 'me'),
        jsonb_build_object('op', 'eq', 'field_key', 'injuries', 'value', 'me_and_someone'),
        jsonb_build_object('op', 'eq', 'field_key', 'other_person_type', 'value', 'a_coworker')
      ))
    ),
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
      "label":"Automobile / Fleet Loss",
      "source_catalog":{
        "mockup":"docs/image.png",
        "question_bank":"docs/JebelAI_User_Stories (1).xlsx#Question Bank"
      },
      "mvp_assumptions":[
        "Screenshot-only labels do not specify control type or requiredness, so they use optional text and conservative length limits; no screenshot sample values are seeded.",
        "prefillSource identifies only an existing record category. The UI may prefill or lock a value only when that record actually contains it; definitions contain no company, driver, policy, or vehicle values.",
        "Additional vehicles, injured people, and witnesses use optional repeated groups with provisional children derived from existing workbook prompts and mockup labels; they are not validated carrier forms.",
        "GL activation and the property-photo requirement derive only from confirmed involved selections; detail answers remain follow-up context and do not determine form activation."
      ],
      "sections":[
        {"key":"reporter_policy","label":"A. REPORTER & POLICY","fields":[
          {"key":"reporting_company","type":"text","required":false,"label":"Reporting company / insured","source":"mockup","provisional":true,"prefillSource":"organization","validation":{"maxLength":500}},
          {"key":"dot_mc_number","type":"text","required":false,"label":"DOT / MC number","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"policy_number","type":"text","required":false,"label":"Policy number","source":"mockup","provisional":true,"prefillSource":"policy","validation":{"maxLength":500}},
          {"key":"carrier_naic_code","type":"text","required":false,"label":"Carrier & NAIC code","source":"mockup","provisional":true,"prefillSource":"policy","validation":{"maxLength":500}},
          {"key":"agent_broker","type":"text","required":false,"label":"Agent / broker","source":"mockup","provisional":true,"prefillSource":"policy","validation":{"maxLength":500}},
          {"key":"effective_expiration_dates","type":"text","required":false,"label":"Effective / expiration dates","source":"mockup","provisional":true,"prefillSource":"policy","validation":{"maxLength":500}},
          {"key":"person_reporting","type":"text","required":false,"label":"Person reporting","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"reporter_phone_email","type":"text","required":false,"label":"Reporter phone / email","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"date_time_reported","type":"text","required":false,"label":"Date & time reported","source":"mockup","provisional":true,"prefillSource":"incident","validation":{"maxLength":500}},
          {"key":"internal_claim_number","type":"text","required":false,"label":"Internal claim #","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"previously_reported","type":"text","required":false,"label":"Previously reported?","source":"mockup","provisional":true,"validation":{"maxLength":500}}
        ]},
        {"key":"loss_details","label":"B. LOSS DETAILS","fields":[
          {"key":"date_time_loss","type":"text","required":false,"label":"Date & time of loss","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"location_loss","type":"text","required":false,"label":"Location of loss","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"mile_marker_gps","type":"text","required":false,"label":"Mile marker / GPS","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"weather_road","type":"multi_enum","required":false,"label":"Weather & road conditions","question":"How was the weather and the road?","source":["mockup","question_bank"],"provisional":true,"mvp_assumption":"Omit the workbook's unresolved ellipsis marker from choices; weather prefill remains provisional.","options":[{"value":"clear","label":"Clear"},{"value":"rain","label":"Rain"},{"value":"ice_or_snow","label":"Ice or snow"},{"value":"fog","label":"Fog"},{"value":"dark","label":"Dark"}]},
          {"key":"police","type":"enum","required":true,"label":"Police / fire / EMS contacted?","question":"Did the police come?","source":["mockup","question_bank"],"provisional":true,"mvp_assumption":"The authored question captures police status only; the wider screenshot label remains visible without inventing fire/EMS choices.","options":[{"value":"came","label":"Yes, they came"},{"value":"on_the_way","label":"On the way"},{"value":"no_police","label":"No police"},{"value":"not_sure","label":"Not sure"}]},
          {"key":"citations_issued","type":"text","required":false,"label":"Citations issued?","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"what_happened","type":"long_text","required":true,"label":"Description of accident","question":"What happened?","source":["mockup","question_bank"],"provisional":true,"mvp_assumption":"The narrative length cap is a safe client limit; the source specifies no maximum.","validation":{"maxLength":4000}},
          {"key":"involved","type":"multi_enum","required":true,"label":"What else was involved?","question":"What else was involved?","source":"question_bank","options":[{"value":"another_vehicle","label":"Another vehicle"},{"value":"object","label":"A building, fence, or object"},{"value":"delivery_claim","label":"Customer says our delivery caused it"},{"value":"just_my_truck","label":"Just my truck"}]},
          {"key":"trip","type":"enum","required":false,"label":"What kind of trip were you on?","question":"What kind of trip were you on?","source":"question_bank","options":[{"value":"dispatched_load","label":"Dispatched load"},{"value":"other_work_task","label":"Other work task"},{"value":"to_or_from_work","label":"To or from work"},{"value":"parked_or_in_the_yard","label":"Parked or in the yard"}]},
          {"key":"other_vehicle","type":"text","required":false,"label":"Tell me about the other vehicle.","question":"Tell me about the other vehicle.","source":"question_bank","provisional":true,"mvp_assumption":"The interview captures the first other vehicle in one answer; the optional repeated group captures additional vehicles using the same authored make, color, and plate prompt.","validation":{"maxLength":1000}},
          {"key":"other_driver","type":"text","required":false,"label":"Who was driving the other vehicle?","question":"Who was driving the other vehicle?","source":"question_bank","provisional":true,"mvp_assumption":"The interview captures the first other driver in one answer; additional vehicle entries can record their driver details separately.","validation":{"maxLength":1000}},
          {"key":"property_damaged","type":"long_text","required":false,"label":"What got damaged, and how bad?","question":"What got damaged, and how bad?","source":"question_bank","provisional":true,"mvp_assumption":"Kept on Auto to preserve the evaluator's stable Auto key; future GL display should reference this confirmed answer, not duplicate it.","validation":{"maxLength":4000}},
          {"key":"delivery_work","type":"long_text","required":false,"label":"What were you delivering or doing there?","question":"What were you delivering or doing there?","source":"question_bank","provisional":true,"mvp_assumption":"Kept on Auto to preserve the evaluator's stable Auto key; future GL display should reference this confirmed answer, not duplicate it.","validation":{"maxLength":4000}}
        ]},
        {"key":"insured_vehicle","label":"C. INSURED VEHICLE","fields":[
          {"key":"unit_asset_id","type":"text","required":false,"label":"Unit / asset ID","source":"mockup","provisional":true,"prefillSource":"vehicle","validation":{"maxLength":500}},
          {"key":"year_make_model_body","type":"text","required":false,"label":"Year / make / model / body","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"vin","type":"text","required":false,"label":"VIN","source":"mockup","provisional":true,"prefillSource":"vehicle","validation":{"maxLength":500}},
          {"key":"plate_state","type":"text","required":false,"label":"Plate & state","source":"mockup","provisional":true,"prefillSource":"vehicle","validation":{"maxLength":500}},
          {"key":"odometer_at_loss","type":"text","required":false,"label":"Odometer at loss","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"gvw_class","type":"text","required":false,"label":"GVW / class","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"cargo","type":"text","required":false,"label":"Cargo being carried","question":"What were you carrying? Is the cargo okay?","source":["mockup","question_bank"],"provisional":true,"mvp_assumption":"The source combines a choice and free speech; text is the safe MVP representation until a structured cargo contract exists.","validation":{"maxLength":1000}},
          {"key":"hazmat","type":"text","required":false,"label":"Hazmat?","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"telematics_dash_cam","type":"text","required":false,"label":"Telematics / dash cam","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"pre_trip_dvir","type":"text","required":false,"label":"Pre-trip DVIR","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"damage_description","type":"long_text","required":false,"label":"Damage description","source":"mockup","provisional":true,"validation":{"maxLength":4000}},
          {"key":"estimated_damage","type":"text","required":false,"label":"Estimated damage","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"vehicle_inspection_location","type":"text","required":false,"label":"Where vehicle can be inspected","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"drivable","type":"enum","required":false,"label":"Drivable after loss?","question":"Can you still drive the truck?","source":["mockup","question_bank"],"options":[{"value":"yes_i_can_drive_it","label":"Yes, I can drive it"},{"value":"needs_tow","label":"Needs a tow"}]},
          {"key":"towed_to","type":"text","required":false,"label":"Where is the truck being towed?","question":"Where is the truck being towed?","source":"question_bank","provisional":true,"mvp_assumption":"Towing destination remains one text answer; no dispatch or terminal data is fabricated.","validation":{"maxLength":1000}},
          {"key":"other_insurance_on_vehicle","type":"text","required":false,"label":"Other insurance on vehicle","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"truck_damage","type":"multi_enum","required":false,"label":"Where is your truck damaged?","question":"Where is your truck damaged?","source":"question_bank","options":[{"value":"cab_l","label":"Cab L"},{"value":"cab_r","label":"Cab R"},{"value":"trailer_front_l","label":"Trailer front L"},{"value":"trailer_front_r","label":"Trailer front R"},{"value":"trailer_mid_l","label":"Trailer mid L"},{"value":"trailer_mid_r","label":"Trailer mid R"},{"value":"trailer_rear_l","label":"Trailer rear L"},{"value":"trailer_rear_r","label":"Trailer rear R"},{"value":"rear","label":"Rear"},{"value":"front_bumper","label":"Front bumper"},{"value":"none","label":"No damage"}]},
          {"key":"leak_spill","type":"enum","required":false,"label":"Did anything leak or spill?","question":"Did anything leak or spill?","source":"question_bank","options":[{"value":"no_leak","label":"No leak"},{"value":"yes_hazmat","label":"Yes, hazmat"},{"value":"yes_not_hazmat","label":"Yes, not hazmat"},{"value":"not_sure","label":"Not sure"}]},
          {"key":"hazmat_details","type":"long_text","required":false,"label":"What leaked, and about how much?","question":"What leaked, and about how much?","source":"question_bank","provisional":true,"mvp_assumption":"Substance, quantity, placard, and UN number stay in one answer; no unprovided structured children are added.","validation":{"maxLength":4000}}
        ]},
        {"key":"driver","label":"D. DRIVER","fields":[
          {"key":"driver_full_name","type":"text","required":false,"label":"Driver full name","source":"mockup","provisional":true,"prefillSource":"profile","validation":{"maxLength":500}},
          {"key":"relationship_to_insured","type":"text","required":false,"label":"Relationship to insured","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"driver_date_of_birth","type":"text","required":false,"label":"Date of birth","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"license_state","type":"text","required":false,"label":"License & state","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"cdl_class_endorsements","type":"text","required":false,"label":"CDL class / endorsements","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"hire_date_experience","type":"text","required":false,"label":"Hire date / experience","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"hours_of_service","type":"text","required":false,"label":"Hours of service","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"driving_with_permission","type":"text","required":false,"label":"Driving with permission?","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"purpose_of_use","type":"text","required":false,"label":"Purpose of use","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"seatbelt","type":"enum","required":false,"label":"Seatbelt in use?","question":"Were you wearing your seatbelt?","source":["mockup","question_bank"],"options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"},{"value":"not_sure","label":"Not sure"}]},
          {"key":"injuries","type":"enum","required":true,"label":"Driver injured?","question":"Was anyone hurt?","source":["mockup","question_bank"],"provisional":true,"mvp_assumption":"The broader injury choices stay under this existing key; it preserves the visible Auto caption and drives WC activation for driver injuries. Coworker injury uses the authored other_person_type choice.","options":[{"value":"no_one","label":"No one"},{"value":"me","label":"Yes, me"},{"value":"someone_else","label":"Someone else"},{"value":"me_and_someone","label":"Me and someone else"}]},
          {"key":"driver_treatment","type":"enum","required":false,"label":"Did you get any treatment?","question":"Did you get any treatment?","source":"question_bank","options":[{"value":"none_needed","label":"None needed"},{"value":"first_aid_at_the_scene","label":"First aid at the scene"},{"value":"doctor_or_clinic","label":"Doctor or clinic"},{"value":"er_or_hospital","label":"ER or hospital"},{"value":"going_later","label":"Going later"}]},
          {"key":"serious_injury","type":"enum","required":false,"label":"Were you kept in hospital?","question":"Were you kept in hospital?","source":"question_bank","options":[{"value":"treated_and_released","label":"Treated and released"},{"value":"admitted_overnight_or_longer","label":"Admitted overnight or longer"},{"value":"still_at_the_er","label":"Still at the ER"},{"value":"not_sure","label":"Not sure"}]},
          {"key":"other_person_hurt","type":"long_text","required":false,"label":"Who was hurt, and how?","question":"Who was hurt, and how?","source":"question_bank","provisional":true,"mvp_assumption":"This preserves the authored interview answer; the optional repeated group captures additional people with the existing person-type and treatment choices.","validation":{"maxLength":4000}},
          {"key":"other_person_type","type":"enum","required":false,"label":"Who are they?","question":"Who are they?","source":"question_bank","provisional":true,"mvp_assumption":"The Workers' Comp activation rule treats the authored coworker choice as a worker-injury signal; confirm this derived rule before real use.","options":[{"value":"a_coworker","label":"A coworker"},{"value":"the_other_driver","label":"The other driver"},{"value":"a_passenger","label":"A passenger"},{"value":"a_pedestrian_or_cyclist","label":"A pedestrian or cyclist"},{"value":"a_customer_or_their_staff","label":"A customer or their staff"},{"value":"child","label":"A child"}]},
          {"key":"child_seat","type":"enum","required":false,"label":"Was the child in a car seat?","question":"Was the child in a car seat?","source":"question_bank","options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"},{"value":"not_sure","label":"Not sure"}]},
          {"key":"their_treatment","type":"enum","required":false,"label":"What treatment did they get?","question":"What treatment did they get?","source":"question_bank","options":[{"value":"none_needed","label":"None needed"},{"value":"first_aid_at_the_scene","label":"First aid at the scene"},{"value":"ambulance_took_them","label":"Ambulance took them"},{"value":"went_to_a_doctor_or_er","label":"Went to a doctor or ER"},{"value":"not_sure","label":"Not sure"}]}
        ]},
        {"key":"wrap_up","label":"Wrap-up","fields":[
          {"key":"police_report_no","type":"text","required":false,"label":"Agency & report number","question":"What is the police report number?","source":["mockup","question_bank"],"provisional":true,"validation":{"maxLength":500}},
          {"key":"tickets","type":"enum","required":false,"label":"Citations issued?","question":"Did anyone get a ticket?","source":["mockup","question_bank"],"options":[{"value":"no_tickets","label":"No tickets"},{"value":"i_got_a_ticket","label":"I got a ticket"},{"value":"other_driver_ticket","label":"The other driver got one"},{"value":"both_got_tickets","label":"We both did"},{"value":"not_sure","label":"Not sure"}]},
          {"key":"drug_alcohol_test","type":"enum","required":false,"label":"Post-accident testing","question":"Have you been told to take a drug and alcohol test?","source":["mockup","question_bank"],"provisional":true,"mvp_assumption":"The question and options are workbook drafts; the DOT rule is provisional demo logic, not compliance advice.","options":[{"value":"done_already","label":"Done already"},{"value":"scheduled","label":"Scheduled"},{"value":"not_told_yet","label":"Not told yet"},{"value":"not_sure","label":"Not sure"}]},
          {"key":"video","type":"multi_enum","required":false,"label":"Is there any video of it?","question":"Is there any video of it?","source":"question_bank","provisional":true,"mvp_assumption":"This records reported video sources only; media objects and proof of availability are separate evidence data.","options":[{"value":"truck_dash_cam","label":"Truck dash cam"},{"value":"phone_video","label":"Phone video"},{"value":"other_driver_s_camera","label":"Other driver's camera"},{"value":"business_security_camera","label":"Business security camera"},{"value":"no_video","label":"No video"},{"value":"not_sure","label":"Not sure"}]},
          {"key":"prevention","type":"multi_enum","required":false,"label":"What would stop this from happening again?","question":"What would stop this from happening again?","source":"question_bank","provisional":true,"mvp_assumption":"The workbook's unresolved ellipsis is omitted from choices; authored selectable labels are preserved.","options":[{"value":"fix_equipment","label":"Fix equipment"},{"value":"more_training","label":"More training"},{"value":"better_safety_gear","label":"Better safety gear"},{"value":"fix_the_site","label":"Fix the site"},{"value":"more_time","label":"More time"},{"value":"not_preventable","label":"Not preventable"}]},
          {"key":"witnesses","type":"long_text","required":false,"label":"Did anyone see it happen?","question":"Did anyone see it happen?","source":"question_bank","provisional":true,"mvp_assumption":"This preserves the authored interview answer; optional repeated entries capture witness contact details from the mockup.","validation":{"maxLength":4000}}
        ]},
        {"key":"repeatable_details","label":"Additional incident details","fields":[
          {"type":"repeated_group","key":"additional_vehicles","label":"Additional involved vehicles","required":false,"fields":[
            {"key":"additional_vehicle_details","type":"text","required":true,"label":"Vehicle make, color, and plate","source":"question_bank","provisional":true,"mvp_assumption":"Uses the authored other-vehicle prompt for additional vehicles; no separate manufacturer or plate rules are inferred.","validation":{"maxLength":1000}},
            {"key":"additional_vehicle_driver","type":"text","required":false,"label":"Driver name, phone, and insurer","source":"question_bank","provisional":true,"mvp_assumption":"Uses the authored other-driver prompt for additional vehicles; values remain free text.","validation":{"maxLength":1000}}
          ]},
          {"type":"repeated_group","key":"additional_injured_people","label":"Additional injured people","required":false,"fields":[
            {"key":"additional_injured_person_type","type":"enum","required":true,"label":"Who are they?","source":"question_bank","provisional":true,"mvp_assumption":"Reuses the existing authored person-type choices for additional people.","options":[{"value":"a_coworker","label":"A coworker"},{"value":"the_other_driver","label":"The other driver"},{"value":"a_passenger","label":"A passenger"},{"value":"a_pedestrian_or_cyclist","label":"A pedestrian or cyclist"},{"value":"a_customer_or_their_staff","label":"A customer or their staff"},{"value":"child","label":"A child"}]},
            {"key":"additional_injury_description","type":"long_text","required":false,"label":"Who was hurt, and how?","source":"question_bank","provisional":true,"mvp_assumption":"Free-text description follows the existing injury question; it does not diagnose or infer severity.","validation":{"maxLength":4000}},
            {"key":"additional_injured_person_treatment","type":"enum","required":false,"label":"What treatment did they get?","source":"question_bank","provisional":true,"mvp_assumption":"Reuses the existing authored treatment choices.","options":[{"value":"none_needed","label":"None needed"},{"value":"first_aid_at_the_scene","label":"First aid at the scene"},{"value":"ambulance_took_them","label":"Ambulance took them"},{"value":"went_to_a_doctor_or_er","label":"Went to a doctor or ER"},{"value":"not_sure","label":"Not sure"}]}
          ]},
          {"type":"repeated_group","key":"additional_witnesses","label":"Additional witnesses","required":false,"fields":[
            {"key":"additional_witness_details","type":"text","required":true,"label":"Witness name, address, and phone","source":"mockup","provisional":true,"mvp_assumption":"The mockup provides these witness labels; optional repeated entries avoid treating sample values as required data.","validation":{"maxLength":1000}},
            {"key":"additional_witness_relationship","type":"text","required":false,"label":"Relationship to the incident","source":"mockup","provisional":true,"validation":{"maxLength":500}}
          ]}
        ]}
      ],
      "requiredEvidence":[
        {"field_key":"incident_photos","media_type":"photo","minimum":1,"when":{"any":[
          {"op":"contains_any","field_key":"involved","values":["object","delivery_claim"]},
          {"op":"in","field_key":"injuries","values":["me","someone_else","me_and_someone"]}
        ]}}
      ]
    }
    $auto$::jsonb,
    'active'
  ),
  (
    'general_liability',
    1,
    $gl$
    {
      "label":"General Liability Occurrence",
      "source_catalog":{
        "mockup":"docs/image.png",
        "question_bank":"docs/JebelAI_User_Stories (1).xlsx#Question Bank"
      },
      "mvp_assumptions":[
        "Screenshot-only labels use optional text and conservative length limits; visible sample values are not seed values.",
        "Additional claimants, damaged properties, and witnesses use optional repeated groups with provisional children derived from existing mockup labels; they are not validated carrier forms.",
        "prefillSource is a lookup hint only and never supplies fake data or guarantees a read-only UI."
      ],
      "sections":[
        {"key":"reporter_policy","label":"A. REPORTER & POLICY","fields":[
          {"key":"insured_reporting_company","type":"text","required":false,"label":"Insured / Reporting company","source":"mockup","provisional":true,"prefillSource":"organization","validation":{"maxLength":500}},
          {"key":"policy_number","type":"text","required":false,"label":"Policy number","source":"mockup","provisional":true,"prefillSource":"policy","validation":{"maxLength":500}},
          {"key":"carrier_naic_code","type":"text","required":false,"label":"Carrier & NAIC code","source":"mockup","provisional":true,"prefillSource":"policy","validation":{"maxLength":500}},
          {"key":"agent_broker","type":"text","required":false,"label":"Agent / broker","source":"mockup","provisional":true,"prefillSource":"policy","validation":{"maxLength":500}},
          {"key":"umbrella_excess","type":"text","required":false,"label":"Umbrella / excess","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"coverage_part_form","type":"text","required":false,"label":"Coverage part / form as","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"policy_limits","type":"text","required":false,"label":"Policy limits","source":"mockup","provisional":true,"prefillSource":"policy","validation":{"maxLength":500}},
          {"key":"deductible_sir","type":"text","required":false,"label":"Deductible / SIR","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"person_reporting","type":"text","required":false,"label":"Person reporting","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"date_time_reported","type":"text","required":false,"label":"Date & time reported","source":"mockup","provisional":true,"prefillSource":"incident","validation":{"maxLength":500}},
          {"key":"occurrence_or_claim","type":"text","required":false,"label":"Occurrence or claim","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"policy_trigger","type":"text","required":false,"label":"Policy trigger","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"previously_reported","type":"text","required":false,"label":"Previously reported?","source":"mockup","provisional":true,"validation":{"maxLength":500}}
        ]},
        {"key":"occurrence_details","label":"B. OCCURRENCE DETAILS","fields":[
          {"key":"date_time_occurrence","type":"text","required":false,"label":"Date & time","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"occurrence_location_area","type":"text","required":false,"label":"Location & specific area","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"liability_type","type":"text","required":false,"label":"Type of liability","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"insured_relationship_to_location","type":"text","required":false,"label":"Insured's relationship to location","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"authority_contacted","type":"text","required":false,"label":"Authority contacted","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"occurrence_description","type":"long_text","required":false,"label":"Description of occurrence","source":"mockup","provisional":true,"validation":{"maxLength":4000}},
          {"key":"place_type","type":"enum","required":false,"label":"What kind of place was it?","question":"What kind of place was it?","source":"question_bank","options":[{"value":"customer_s_site","label":"Customer's site"},{"value":"our_yard_or_terminal","label":"Our yard or terminal"},{"value":"public_road","label":"Public road"},{"value":"job_site","label":"Job site"}]}
        ]},
        {"key":"insured_party_claimant","label":"C. INSURED PARTY / CLAIMANT","fields":[
          {"key":"claimant_name_address","type":"text","required":false,"label":"Name & address","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"claimant_phone_email","type":"text","required":false,"label":"Phone / email","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"claimant_age_sex","type":"text","required":false,"label":"Age / sex","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"claimant_occupation","type":"text","required":false,"label":"Occupation","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"claimant_employer","type":"text","required":false,"label":"Employer","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"claimant_activity","type":"text","required":false,"label":"What claimant was doing","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"claimant_injury_description","type":"long_text","required":false,"label":"Description of injury","source":"mockup","provisional":true,"validation":{"maxLength":4000}},
          {"key":"claimant_fatality","type":"text","required":false,"label":"Fatality?","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"claimant_treatment_location","type":"text","required":false,"label":"Where treated","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"claimant_relationship_to_insured","type":"text","required":false,"label":"Relationship to insured","source":"mockup","provisional":true,"validation":{"maxLength":500}}
        ]},
        {"key":"property_damaged","label":"D. PROPERTY DAMAGED","fields":[
          {"key":"property_owner","type":"text","required":false,"label":"Owner name & address","question":"Who owns it?","source":["mockup","question_bank"],"provisional":true,"mvp_assumption":"The interview keeps the first owner under its stable key; optional property entries capture additional owners.","validation":{"maxLength":1000}},
          {"key":"owner_phone_email","type":"text","required":false,"label":"Owner phone / email","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"property_description","type":"long_text","required":false,"label":"Description of property","source":"mockup","provisional":true,"validation":{"maxLength":4000}},
          {"key":"damage_description","type":"long_text","required":false,"label":"Description of damage","source":"mockup","provisional":true,"validation":{"maxLength":4000}},
          {"key":"estimated_damage","type":"text","required":false,"label":"Estimated damage","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"property_inspection_location","type":"text","required":false,"label":"Where it can be inspected","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"other_insurance_on_property","type":"text","required":false,"label":"Other insurance on property","source":"mockup","provisional":true,"validation":{"maxLength":500}}
        ]},
        {"key":"product_completed_operations","label":"E. PRODUCT / COMPLETED OPERATIONS","fields":[
          {"key":"product_work_description","type":"long_text","required":false,"label":"Product / work description","source":"mockup","provisional":true,"validation":{"maxLength":4000}},
          {"key":"manufacturer","type":"text","required":false,"label":"Manufacturer","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"vendor","type":"text","required":false,"label":"Vendor","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"product_location","type":"text","required":false,"label":"Where product can be seen","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"date_delivered_completed","type":"text","required":false,"label":"Date delivered / completed","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"alleged_defect","type":"long_text","required":false,"label":"Alleged defect","source":"mockup","provisional":true,"validation":{"maxLength":4000}},
          {"key":"product_kept","type":"enum","required":false,"label":"Did the customer keep the product?","question":"Did the customer keep the product?","source":"question_bank","options":[{"value":"kept_all_of_it","label":"Kept all of it"},{"value":"kept_some_refused_some","label":"Kept some, refused some"},{"value":"refused_all_of_it","label":"Refused all of it"},{"value":"not_sure","label":"Not sure"},{"value":"not_applicable","label":"Not applicable"}]}
        ]},
        {"key":"witnesses","label":"F. WITNESSES","fields":[
          {"key":"witness_name_address_phone","type":"text","required":false,"label":"Name, address, phone","source":"mockup","provisional":true,"mvp_assumption":"This scalar preserves the first witness entry; additional witnesses use a separate optional repeated group.","validation":{"maxLength":1000}},
          {"key":"witness_relationship","type":"text","required":false,"label":"Relationship","source":"mockup","provisional":true,"validation":{"maxLength":500}}
        ]},
        {"key":"repeatable_details","label":"Additional parties and property","fields":[
          {"type":"repeated_group","key":"additional_claimants","label":"Additional claimants","required":false,"fields":[
            {"key":"additional_claimant_name_address","type":"text","required":true,"label":"Claimant name and address","source":"mockup","provisional":true,"mvp_assumption":"Derived from the existing claimant heading; additional entries support more than one claimant without creating legal requirements.","validation":{"maxLength":1000}},
            {"key":"additional_claimant_phone_email","type":"text","required":false,"label":"Claimant phone and email","source":"mockup","provisional":true,"validation":{"maxLength":500}},
            {"key":"additional_claimant_injury_description","type":"long_text","required":false,"label":"Claimant injury description","source":"mockup","provisional":true,"validation":{"maxLength":4000}},
            {"key":"additional_claimant_treatment_location","type":"text","required":false,"label":"Where treated","source":"mockup","provisional":true,"validation":{"maxLength":500}}
          ]},
          {"type":"repeated_group","key":"additional_properties","label":"Additional damaged property","required":false,"fields":[
            {"key":"additional_property_owner_name_address","type":"text","required":false,"label":"Owner name and address","source":"mockup","provisional":true,"validation":{"maxLength":1000}},
            {"key":"additional_property_owner_phone_email","type":"text","required":false,"label":"Owner phone and email","source":"mockup","provisional":true,"validation":{"maxLength":500}},
            {"key":"additional_property_description","type":"long_text","required":true,"label":"Property description","source":"mockup","provisional":true,"mvp_assumption":"Derived from the existing property-damage section; each added entry represents one additional item.","validation":{"maxLength":4000}},
            {"key":"additional_property_damage","type":"long_text","required":false,"label":"Damage description","source":"mockup","provisional":true,"validation":{"maxLength":4000}},
            {"key":"additional_property_estimated_damage","type":"text","required":false,"label":"Estimated damage","source":"mockup","provisional":true,"validation":{"maxLength":500}},
            {"key":"additional_property_inspection_location","type":"text","required":false,"label":"Where it can be inspected","source":"mockup","provisional":true,"validation":{"maxLength":500}}
          ]},
          {"type":"repeated_group","key":"additional_witnesses","label":"Additional witnesses","required":false,"fields":[
            {"key":"additional_witness_name_address_phone","type":"text","required":true,"label":"Witness name, address, and phone","source":"mockup","provisional":true,"validation":{"maxLength":1000}},
            {"key":"additional_witness_relationship","type":"text","required":false,"label":"Relationship","source":"mockup","provisional":true,"validation":{"maxLength":500}}
          ]}
        ]}
      ]
    }
    $gl$::jsonb,
    'active'
  ),
  (
    'workers_comp',
    1,
    $wc$
    {
      "label":"Workers' Comp Injury Report",
      "source_catalog":{
        "mockup":"docs/image.png",
        "question_bank":"docs/JebelAI_User_Stories (1).xlsx#Question Bank"
      },
      "mvp_assumptions":[
        "Screenshot-only labels use optional text and conservative length limits; visible sample values are not seed values.",
        "prefillSource is a lookup hint only and never supplies fake data or guarantees a read-only UI.",
        "The interview's own-injury answers remain single-value scalars; optional repeated injury entries reuse the authored body-part and injury-nature choices."
      ],
      "sections":[
        {"key":"employer_policy_reporter","label":"A. EMPLOYER, POLICY & REPORTER","fields":[
          {"key":"employer_reporting_company","type":"text","required":false,"label":"Employer / Reporting company","source":"mockup","provisional":true,"prefillSource":"organization","validation":{"maxLength":500}},
          {"key":"establishment_address","type":"text","required":false,"label":"Establishment address","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"naics_sic_code","type":"text","required":false,"label":"NAICS / SIC code","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"wc_policy_number","type":"text","required":false,"label":"WC policy number","source":"mockup","provisional":true,"prefillSource":"policy","validation":{"maxLength":500}},
          {"key":"carrier_tpa","type":"text","required":false,"label":"Carrier / TPA","source":"mockup","provisional":true,"prefillSource":"policy","validation":{"maxLength":500}},
          {"key":"agent_code","type":"text","required":false,"label":"Agent & code","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"jurisdiction_state","type":"text","required":false,"label":"Jurisdiction / state","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"person_completing_report","type":"text","required":false,"label":"Person completing report","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"date_time_completed","type":"text","required":false,"label":"Date & time completed","source":"mockup","provisional":true,"prefillSource":"incident","validation":{"maxLength":500}},
          {"key":"supervisor_follow_up","type":"text","required":false,"label":"Supervisor for follow-up","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"location_site_number","type":"text","required":false,"label":"Location / site #","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"osha_300_case_number","type":"text","required":false,"label":"OSHA 300 case #","source":"mockup","provisional":true,"validation":{"maxLength":500}}
        ]},
        {"key":"employee","label":"B. EMPLOYEE","fields":[
          {"key":"full_legal_name","type":"text","required":false,"label":"Full legal name","source":"mockup","provisional":true,"prefillSource":"profile","validation":{"maxLength":500}},
          {"key":"home_address","type":"text","required":false,"label":"Home address","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"date_of_birth","type":"text","required":false,"label":"Date of birth","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"sex","type":"text","required":false,"label":"Sex","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"date_of_hire","type":"text","required":false,"label":"Date of hire","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"job_title","type":"text","required":false,"label":"Job title","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"employment_status","type":"text","required":false,"label":"Employment status","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"marital_dependents","type":"text","required":false,"label":"Marital status / dependents","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"wage_pay_frequency","type":"text","required":false,"label":"Wage rate / pay frequency","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"phone_email","type":"text","required":false,"label":"Phone / email","source":"mockup","provisional":true,"validation":{"maxLength":500}}
        ]},
        {"key":"case_incident","label":"C. CASE & INCIDENT","fields":[
          {"key":"date_of_injury","type":"text","required":false,"label":"Date of injury","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"time_began_work","type":"text","required":false,"label":"Time began work","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"time_of_event","type":"text","required":false,"label":"Time of event","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"location_of_incident","type":"text","required":false,"label":"Location of incident","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"date_employer_notified","type":"text","required":false,"label":"Date employer notified","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"date_disability_began","type":"text","required":false,"label":"Date disability began","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"driver_activity","type":"enum","required":false,"label":"What employee was doing","question":"What were you doing when it happened?","source":["mockup","question_bank"],"options":[{"value":"driving","label":"Driving"},{"value":"loading_or_unloading","label":"Loading or unloading"},{"value":"coupling_or_uncoupling","label":"Coupling or uncoupling"},{"value":"getting_in_or_out_of_the_cab","label":"Getting in or out of the cab"},{"value":"securing_the_load","label":"Securing the load"},{"value":"inspection","label":"Inspection"},{"value":"other","label":"Other"}]},
          {"key":"driver_injury_cause","type":"enum","required":false,"label":"How injury occurred","question":"What hurt you?","source":["mockup","question_bank"],"options":[{"value":"vehicle_collision","label":"Vehicle collision"},{"value":"slip_or_fall","label":"Slip or fall"},{"value":"lifting_or_pulling","label":"Lifting or pulling"},{"value":"struck_by_an_object","label":"Struck by an object"},{"value":"caught_in_or_between","label":"Caught in or between"},{"value":"other","label":"Other"}]},
          {"key":"object_substance_that_harmed","type":"text","required":false,"label":"Object / substance that harmed","source":"mockup","provisional":true,"validation":{"maxLength":1000}},
          {"key":"part_of_normal_duties","type":"text","required":false,"label":"Part of normal duties?","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"work_process_underway","type":"text","required":false,"label":"Work process underway","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"driver_injury_where","type":"multi_enum","required":false,"label":"Body part & how","question":"Where are you hurt?","source":["mockup","question_bank"],"options":[{"value":"head","label":"Head"},{"value":"neck","label":"Neck"},{"value":"back","label":"Back"},{"value":"shoulder_or_arm","label":"Shoulder or arm"},{"value":"hand_or_wrist","label":"Hand or wrist"},{"value":"chest","label":"Chest"},{"value":"hip_or_leg","label":"Hip or leg"},{"value":"foot_or_ankle","label":"Foot or ankle"},{"value":"other","label":"Other"}]},
          {"key":"driver_injury_kind","type":"enum","required":false,"label":"Nature of injury","question":"What kind of injury is it?","source":["mockup","question_bank"],"options":[{"value":"cut_or_scrape","label":"Cut or scrape"},{"value":"bruise","label":"Bruise"},{"value":"strain_or_sprain","label":"Strain or sprain"},{"value":"broken_bone","label":"Broken bone"},{"value":"burn","label":"Burn"},{"value":"pain_nothing_visible","label":"Pain, nothing visible"},{"value":"not_sure","label":"Not sure"}]}
        ]},
        {"key":"nature_of_injury","label":"D. NATURE OF INJURY","fields":[
          {"key":"work_status","type":"enum","required":false,"label":"Can you keep working?","question":"Can you keep working?","source":"question_bank","provisional":true,"mvp_assumption":"The question bank supplies status choices but the screenshot has only downstream day-count fields; retain the node without inventing those counts.","options":[{"value":"yes_full_duty","label":"Yes, full duty"},{"value":"light_duty_only","label":"Light duty only"},{"value":"can_t_work_right_now","label":"Can't work right now"},{"value":"not_sure","label":"Not sure"}]},
          {"key":"case_classification","type":"text","required":false,"label":"Case classification","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"days_away_from_work","type":"text","required":false,"label":"Days away from work","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"days_on_restriction","type":"text","required":false,"label":"Days on restriction","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"date_of_death","type":"text","required":false,"label":"Date of death","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"hospitalized_overnight","type":"text","required":false,"label":"Hospitalized overnight?","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"treated_in_er","type":"text","required":false,"label":"Treated in ER?","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"amputation_eye_loss","type":"text","required":false,"label":"Amputation / eye loss?","source":"mockup","provisional":true,"validation":{"maxLength":500}},
          {"key":"fatality","type":"text","required":false,"label":"Fatality?","source":"mockup","provisional":true,"validation":{"maxLength":500}}
        ]},
        {"key":"medical_treatment","label":"E. MEDICAL TREATMENT","fields":[
          {"key":"doctor_clinic","type":"text","required":false,"label":"Physician name","question":"Which doctor or clinic?","source":["mockup","question_bank"],"provisional":true,"mvp_assumption":"Physician or clinic details remain one text answer; no separate provider child fields are inferred.","validation":{"maxLength":1000}},
          {"key":"facility_address","type":"text","required":false,"label":"Facility & address","source":"mockup","provisional":true,"validation":{"maxLength":500}}
        ]},
        {"key":"repeatable_injuries","label":"Additional injury details","fields":[
          {"type":"repeated_group","key":"additional_injuries","label":"Additional injuries","required":false,"fields":[
            {"key":"additional_injury_body_parts","type":"multi_enum","required":true,"label":"Body parts affected","source":"question_bank","provisional":true,"mvp_assumption":"Reuses the authored body-part choices for another injury; this does not infer a diagnosis.","options":[{"value":"head","label":"Head"},{"value":"neck","label":"Neck"},{"value":"back","label":"Back"},{"value":"shoulder_or_arm","label":"Shoulder or arm"},{"value":"hand_or_wrist","label":"Hand or wrist"},{"value":"chest","label":"Chest"},{"value":"hip_or_leg","label":"Hip or leg"},{"value":"foot_or_ankle","label":"Foot or ankle"},{"value":"other","label":"Other"}]},
            {"key":"additional_injury_nature","type":"enum","required":false,"label":"Nature of injury","source":"question_bank","provisional":true,"mvp_assumption":"Reuses the authored injury-nature choices for another injury.","options":[{"value":"cut_or_scrape","label":"Cut or scrape"},{"value":"bruise","label":"Bruise"},{"value":"strain_or_sprain","label":"Strain or sprain"},{"value":"broken_bone","label":"Broken bone"},{"value":"burn","label":"Burn"},{"value":"pain_nothing_visible","label":"Pain, nothing visible"},{"value":"not_sure","label":"Not sure"}]}
          ]}
        ]}
      ]
    }
    $wc$::jsonb,
    'active'
  )
on conflict (form_key, version) do update
set definition = excluded.definition,
    status = excluded.status;

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
