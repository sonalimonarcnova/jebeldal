# 03 - Interview Question and Branch Matrix

Audit date: 2026-11-19

## Evidence legend

**MOCKUP** = rendered prototype observation; **SOURCE** = workbook or repository; **MOBILE** = emulator; **TEST** = automated check; **INFERRED** = not runtime-proven; **BLOCKED** = not exercised; **MISSING** = absent.

## Count reconciliation

- **SOURCE**: The workbook Question Bank contains **38 question nodes**.
- **SOURCE**: The workbook has **16 distinct question-level `Show if` expressions**. One additional conditional screen row says the Photos & videos shot list depends on answers. Counting that screen rule gives the documented **17 `show_if`/branch expressions**.
- The same question-level expressions are reused by multiple question nodes; the 29 conditional question rows are not 29 distinct rules.
- **SOURCE**: `supabase/seed.sql` now stores the authored graph at `form_sets.default` version 1 under `definition.interview_graph`; a static test checks node/condition counts, stable keys, and references. The 16 question expressions and photo-screen rule are preserved as source text, not executed.
- **MOCKUP**: 16 different question prompts were reached in this audit. This is not a full traversal: delivery, other-person/child, property, tow, cargo/hazmat, police/ticket/testing, video, prevention, and witnesses remain unverified in this run.
- **MOBILE**: No interview node or branch ran in the Expo app.

## Question-by-question matrix

| # | Field key | Authored question | Workbook input type and options (compact) | `Show if` | Live mockup result |
|---:|---|---|---|---|---|
| 1 | `what_happened` | What happened? | Voice/open text | always | **MOCKUP observed**; typed fictional answer accepted and advanced. Initial progress nevertheless read Question 5 of 14. Voice mode was canned. |
| 2 | `involved` | What else was involved? | Multi-select: another vehicle; building/fence/object; delivery claim; just my truck | always | **MOCKUP observed**; object and other vehicle selected; Back restored the selection. |
| 3 | `trip` | What kind of trip were you on? | Single-select: dispatched load; other work task; to/from work; parked/yard | always | **MOCKUP observed**; Dispatched load advanced automatically. |
| 4 | `weather_road` | How was the weather and the road? | Multi-select: clear; rain; ice/snow; fog; dark; workbook ellipsis | always | **MOCKUP observed**; Clear advanced as Clear sky. The live screen also showed Heavy traffic. |
| 5 | `other_vehicle` | Tell me about the other vehicle. | Voice/open text; quick reply: it drove off | involved has another_vehicle | **MOCKUP partial**; rendered as "What was the other vehicle?" and canned voice answer. |
| 6 | `other_driver` | Who was driving the other vehicle? | Voice/open text | involved has another_vehicle | **MOCKUP partial**; rendered as "Who was driving it?" with "I took a photo of their card" and "They drove off" choices. |
| 7 | `property_damaged` | What got damaged, and how bad? | Voice/open text; quick reply: nothing else was damaged | involved has object | **NOT TESTED**; object was selected but the authored property node was not reached. |
| 8 | `property_owner` | Who owns it? | Voice/open text; quick reply: not applicable | involved has object | **NOT TESTED**. |
| 9 | `place_type` | What kind of place was it? | Single-select: customer site; our yard/terminal; public road; job site | involved has object OR delivery_claim | **NOT TESTED**. |
| 10 | `delivery_work` | What were you delivering or doing there? | Voice/open text; quick reply: not applicable | involved has delivery_claim | **NOT TESTED**. |
| 11 | `product_kept` | Did the customer keep the product? | Single-select: kept all; kept some/refused some; refused all; not sure; not applicable | involved has delivery_claim | **NOT TESTED**. |
| 12 | `injuries` | Was anyone hurt? | Single-select: no one; yes me; someone else; me and someone else | always | **MOCKUP observed**; Yes, me opened Workers' comp follow-ups. |
| 13 | `seatbelt` | Were you wearing your seatbelt? | Single-select: yes; no; not sure | involved has another_vehicle | **MOCKUP partial**; shown after selecting another vehicle and an injury; live options were Yes, No, I was out of the truck. |
| 14 | `driver_injury_where` | Where are you hurt? | Multi-select body areas | injuries in (me, me_and_someone) | **MOCKUP partial**; body diagram appeared and Left foot was selectable. |
| 15 | `driver_injury_kind` | What kind of injury is it? | Single-select: cut/scrape; bruise; strain/sprain; broken bone; burn; pain/no visible injury; not sure | injuries in (me, me_and_someone) | **MOCKUP mismatch**; screen said "What kind of hurt is it?", "Tap all that apply", with a different multi-select option list. |
| 16 | `driver_activity` | What were you doing when it happened? | Single-select: driving; loading/unloading; coupling/uncoupling; entering/exiting cab; securing load; inspection; other | injuries in (me, me_and_someone) | **MOCKUP mismatch**; single-select, but showed a shorter/different set (including climbing in/out, strapping/tarping, not sure). |
| 17 | `driver_injury_cause` | What hurt you? | Single-select: vehicle collision; slip/fall; lifting/pulling; struck by object; caught in/between; other | injuries in (me, me_and_someone) | **MOCKUP mismatch**; displayed The crash, Part of the truck, Cargo or a pallet, Slipped or fell. |
| 18 | `driver_treatment` | Did you get any treatment? | Single-select: none needed; first aid; doctor/clinic; ER/hospital; going later | injuries in (me, me_and_someone) | **MOCKUP mismatch**; asked "Did you get checked out?" and omitted None needed/Going later. |
| 18a | `doctor_clinic` | Which doctor or clinic? | Voice/open text; quick reply: don't know yet | driver_treatment = doctor_or_clinic | **MOCKUP mismatch**; after selecting Emergency room, the next prompt was "Where were you treated?" with a clinic/doctor helper. |
| 18b | `serious_injury` | Were you kept in hospital? | Single-select: released; admitted overnight; still at ER; not sure | driver_treatment = er_or_hospital | **MOCKUP mismatch**; after Skip, asked about losing a finger/toe or eye injury instead. |
| 18c | `work_status` | Can you keep working? | Single-select: full duty; light duty; can't work; not sure | injuries in (me, me_and_someone) | **MOCKUP partial**; prompt reached; options were similar but not exact. |
| 19 | `other_person_hurt` | Who was hurt, and how? | Voice/open text | injuries in (someone_else, me_and_someone) | **NOT TESTED**. |
| 19a | `other_person_type` | Who are they? | Single-select: coworker; other driver; passenger; pedestrian/cyclist; customer/staff; child | injuries in (someone_else, me_and_someone) | **NOT TESTED**. |
| 19b | `child_seat` | Was the child in a car seat? | Single-select: yes; no; not sure | other_person_type = child | **NOT TESTED**. |
| 19c | `their_treatment` | What treatment did they get? | Single-select: none; first aid; ambulance; doctor/ER; not sure | injuries in (someone_else, me_and_someone) | **NOT TESTED**. |
| 20 | `truck_damage` | Where is your truck damaged? | Truck diagram: cab/trailer sides, front/rear, No damage | always | **NOT TESTED in this run**; older browser report has a partial observation, not current full verification. |
| 21 | `drivable` | Can you still drive the truck? | Single-select: yes; needs a tow | truck_damage != none | **NOT TESTED**. |
| 22 | `towed_to` | Where is the truck being towed? | Voice/open text; quick reply: not towed yet | drivable = needs_tow | **NOT TESTED**. |
| 23 | `cargo` | What were you carrying? Is the cargo okay? | Single-select plus voice: fine; damage; empty; not sure | always | **NOT TESTED**. |
| 24 | `leak_spill` | Did anything leak or spill? | Single-select: no leak; hazmat; non-hazmat; not sure | cargo = some_damage OR drivable = needs_tow | **NOT TESTED**. |
| 25 | `hazmat_details` | What leaked, and about how much? | Voice/open text | leak_spill = yes_hazmat | **NOT TESTED**. |
| 26 | `police` | Did the police come? | Single-select: came; on the way; no police; not sure | always | **NOT TESTED**. |
| 27 | `police_report_no` | What is the police report number? | Voice/open text; quick reply: no number yet | police in (came, on_the_way) | **NOT TESTED**. |
| 28 | `tickets` | Did anyone get a ticket? | Single-select: no; me; other driver; both; not sure | police in (came, on_the_way) | **NOT TESTED**. |
| 29 | `drug_alcohol_test` | Have you been told to take a drug and alcohol test? | Single-select: done; scheduled; not told; not sure | DOT post-accident test rule = true | **NOT TESTED**. |
| 30 | `video` | Is there any video of it? | Multi-select: truck dash cam; phone; other driver's camera; business camera; none; not sure | always | **NOT TESTED**. |
| 31 | `prevention` | What would stop this from happening again? | Multi-select: equipment; training; safety gear; site; more time; workbook ellipsis | injuries != no_one OR involved has object OR involved has delivery_claim | **NOT TESTED**. |
| 32 | `witnesses` | Did anyone see it happen? | Voice/open text; quick reply: no one saw it | always | **NOT TESTED**. |

## Branch-expression matrix

| # | Distinct question-level expression | Audit result |
|---:|---|---|
| 1 | `involved has another_vehicle` | **MOCKUP partial**; vehicle follow-ups reached. |
| 2 | `involved has object` | **MOCKUP partial**; selection changed count/header, property node not reached. |
| 3 | `involved has object OR delivery_claim` | **NOT TESTED**. |
| 4 | `involved has delivery_claim` | **NOT TESTED**. |
| 5 | `injuries in (me, me_and_someone)` | **MOCKUP partial**; Yes, me opened injury follow-ups. |
| 6 | `driver_treatment = doctor_or_clinic` | **NOT TESTED**. |
| 7 | `driver_treatment = er_or_hospital` | **MOCKUP mismatch**; wrong follow-up sequence. |
| 8 | `injuries in (someone_else, me_and_someone)` | **NOT TESTED**. |
| 9 | `other_person_type = child` | **NOT TESTED**. |
| 10 | `truck_damage != none` | **NOT TESTED**. |
| 11 | `drivable = needs_tow` | **NOT TESTED**. |
| 12 | `cargo = some_damage OR drivable = needs_tow` | **NOT TESTED**. |
| 13 | `leak_spill = yes_hazmat` | **NOT TESTED**. |
| 14 | `police in (came, on_the_way)` | **NOT TESTED**. |
| 15 | `DOT post-accident test rule = true` | **NOT TESTED**. |
| 16 | `injuries != no_one OR involved has object OR involved has delivery_claim` | **NOT TESTED** as a prevention-question eligibility rule. |
| 17 | Photos & videos screen: `always (shot list depends on answers)` | **SOURCE only**; this is a screen rule, not a question-visibility expression. |

## Rule ownership and gaps

- **SOURCE**: The workbook is the authored source of question wording/options and conditions.
- **SOURCE**: Architecture requires deterministic eligibility and server validation; AI can only choose among allowed questions.
- **MISSING**: No mobile evaluator, server question planner, localized prompts, no-cap path traversal, or persisted answer state exists in mobile source. The seed graph is data only; workbook ellipses remain unresolved.
- **BLOCKED**: AI question selection, transcript provenance, unknown/declined semantics, reload persistence, and full 38-node traversal were not validated.

