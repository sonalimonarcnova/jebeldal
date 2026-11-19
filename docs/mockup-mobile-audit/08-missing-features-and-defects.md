# 08 - Missing Features and Defects

Audit date: 2026-11-19

## Evidence legend

**MOCKUP** = live prototype; **MOBILE** = Expo/Android; **SOURCE** = repository; **TEST** = automated; **INFERRED** = static concern; **BLOCKED** = not executed; **MISSING** = absent.

Severity is assigned against the approved driver-only MVP. Mockup-only failures are not represented as production backend defects.

## A. Missing mobile pages and routes

- **Implemented in source; emulator verification blocked**: sign-in/profile routes, guarded Home/Files/Incidents tabs, Home setup actions, private PDF and walk-around photo uploads, incident listing/draft creation, and a narrative-only draft editor with revision-aware local caching.
- **Auth blocker diagnosed**: the prior Expo bundle used `10.0.2.2:55421` (local Supabase) rather than hosted dev. Root `mobile:start` now injects Infisical `dev`; `mobile:start:local` is explicit for local Supabase.
- **P0 hosted profile blocker**: dev Auth accepts the seeded driver's password, but the hosted profile query fails with SQLSTATE `42703`; `employee_id` and `profile_completed_at` from checked-in migrations are absent. Do not mask this with client fallback values; apply the approved migration to dev before claiming profile completion works.
- **Auth configuration**: hosted Auth settings report `disable_signup=false`. The app has no sign-up route, but project-level self-sign-up remains enabled; changing hosted Auth settings requires an authorized project-management path.
- **P0 - core interview remains partial**: only the pinned Auto narrative field is editable. The 38-node graph, branches, typed form renderer, confirmation details, voice, and complete draft answer flow are not implemented.
- **P1 - remaining routes**: Confirm details, Photos & videos, Review & sign, submitted confirmation, and submitted-report detail remain absent as standalone routes or complete workflows.
- **BLOCKED**: Android MCP initialization currently fails; source route presence is not emulator verification.

Affected source: [mobile app routes](../../apps/mobile/app/), [auth and feature modules](../../apps/mobile/src/).

## B. Missing or broken routes

- **P2, MOCKUP defect**: on `/mobile`, a normal click on the visible JebelAI icon was intercepted by the dock overlay. Direct route navigation was possible, but the primary icon action was not.
- **P1, MOCKUP defect**: the sample draft card opened a generic interview state without the earlier typed answer visible. Persistence loss is **not confirmed** because this is a prototype card with no verified server state.
- **SOURCE**: Expo Router and driver route guards exist. Home, Files, Incidents, Profile, sign-in, and incident-revision routes are implemented; Home and Files remain runtime unverified.
- **MISSING**: the unimplemented mockup routes listed above and a submitted-report detail route.
- **BLOCKED**: Expo routes were not opened on emulator in this continuation.

Evidence: `phone-home-launch-control.png`, mockup route inventory, and live route observations.

## C. Missing UI controls and confirmed mockup mismatches

| ID | Priority | Reproduction / expected | Actual | Evidence / affected area | Root cause / recommended correction |
|---|---|---|---|---|---|
| M-01 | P1 | At `/mobile/login`, enter an invalid reserved-domain email/password; remain on login with inline auth error. | The prototype displayed Signing in, then navigated to Profile. | `login-heading.png`; mockup login flow. | Mock authentication accepts invalid input. Keep the error state on login; test invalid and invited accounts separately. |
| M-02 | P1 | Click Forgot password and show a reset flow or actionable message. | No route, form, alert, or visible state change. | `/mobile/login`, Forgot password control. | Handler appears absent/no-op. Implement or remove the control; actual Expo App has no reset call. |
| M-03 | P2 | Launch the app from the simulated phone home. | JebelAI icon click was intercepted by the dock. | `phone-home-launch-control.png`. | Layering/pointer-event conflict in prototype; fix stacking/hit target. |
| M-04 | P1 | Keep the approved seeded driver and vehicle consistent on every screen. | Home/Profile show one supervisor/vehicle/terminal; Confirm shows a different driver/unit/location. | `profile-heading.png`, `confirm-action.png` (identity values withheld); D-02 in workbook. | Mockup uses inconsistent fixtures. Use one driver fixture throughout. |
| M-05 | P1 | Show only the driver's reports and status "Submitted · awaiting review"; counts match tabs. | Incidents lists many unrelated sample people, "Awaiting approval" / "Submitted for Insurance", and "13 open" alongside 13 submitted cards. | `incidents-tabs.png`; list screenshot withheld. | Static mock data conflicts with D-03 and ownership expectations. Replace with one consistent driver-only sample; do not infer an RLS failure. |
| M-06 | P1 | Injury follow-ups must not silently skip required safety questions. | Skip on "Was anyone hurt?" advanced to the next question without confirmation/unknown state. | `interview-injuries.png`. | Prototype Skip is unconditional. Enforce required/unknown policy and explicit state. |
| M-07 | P1 | Match workbook injury-kind/activity/cause types and options. | Injury kind is multi-select instead of single-select; activity and cause option sets differ. | `interview-injury-kind.png`, `interview-injury-followup.png`. | Mockup controls/options drift from Question Bank. Bind controls to approved versioned definitions. |
| M-08 | P1 | ER/hospital selection should ask the authored hospital-stay question; clinic follow-up only for clinic/doctor. | ER led to "Where were you treated?"; Skip led to a finger/toe/eye question instead of `serious_injury`. | Live interview path; no personal values retained. | Branch mapping is inconsistent with workbook conditions. Fix condition-to-node mapping and test each treatment path. |
| M-09 | P2 | Photos use standard capture; any AI check occurs after capture per D-04. | `/mobile/photos` renders LIVE Truck/Road feedback and coaching over a sample image. | `photos-live-overlay.png`. | Prototype contradicts the approved no-live-overlay decision; move optional checks after capture. |
| M-10 | P1 | Tap to sign must invoke OS-local biometric/passcode confirmation before stamping. | Tap immediately changed to Signed and enabled Submit for review; no prompt appeared. Submit was not clicked. | `review-submit-disabled.png` shows pre-sign state; live control behavior observed. | Prototype signature action is a local toggle. Add native authentication; do not treat a UI toggle as device authentication. |
| M-11 | P2 | Optional document screen should follow D-11 (upload-only, no OCR/expiry alerts). | Documents copy promises date reading and expiry heads-up. | `documents.png`; workbook D-11. | Copy/behavior conflicts with approved scope; remove or explicitly re-approve OCR/expiry work. |

## D. Missing backend operations and integrations

- **P0**: `process-incident-turn` returns 501; Groq transcription, OpenAI extraction, persisted proposals, retries, and provenance are absent.
- **P0**: `select-next-question` returns 501; deterministic eligibility, bounded model selection, authored prompt, and visible fallback are absent.
- **P1**: mobile calls now cover profile/trip/incident reads, `create_incident_draft`, `save_incident_answer`, and private driver-file upload/finalization; the submit Edge Function caller remains absent.
- **SOURCE**: Driver-file metadata writes intentionally use the existing owner-checked `create_user_file` and `finalize_user_file` RPCs rather than direct authenticated table writes.
- **P1**: the current text draft has a version-keyed local cache and server rehydration; full graph/retry/restart recovery remains unverified and incomplete.
- **SOURCE, DB runtime blocked**: a new migration validates saved field keys and JSON value types/options against the pinned form definition. The 14-assertion focused pgTAP test was added but cannot run without local Docker.

Affected files: [process-incident-turn](../../supabase/functions/process-incident-turn/index.ts), [select-next-question](../../supabase/functions/select-next-question/index.ts), [submit-incident](../../supabase/functions/submit-incident/index.ts), migrations, [supabase client](../../apps/mobile/src/lib/supabase.ts).

## E. Missing database capabilities

- **P1**: `organization_master_data` is described in architecture but absent from migrations and seed.
- **P1**: seed contains only 8 field entries across three forms; no complete 38-question graph/17-rule definition.
- **SOURCE**: Direct authenticated `user_files` table writes remain revoked; the approved owner-checked RPC upload path is used by the mobile app.
- **P1**: archived form-definition SELECT policy is active-only even though revision logic can pin archived versions (static access concern).
- **INFERRED P1**: answer/group functions allow keys/values not validated against the pinned JSON definition.
- **BLOCKED**: no live schema, grants, RLS, or bucket state inspection.

See [database/RLS/storage audit](./06-database-rls-storage-audit.md).

## F. Missing business rules

- **P0**: no 38-node graph/evaluator in mobile/seed; conditional behavior is not authoritative or fully testable.
- **P1**: no full field-level typed/enum/requiredness validation from approved definitions.
- **P1**: no rule-computed 80% form field coverage or full Auto/GL/WC review.
- **P1**: no deterministic severity/DOT/testing rule implementation in mobile or provider functions.
- **P1**: no documented no-cap/path-completion verification.
- **P2**: the 17th workbook condition count includes the photo screen's dynamic shot-list condition; only 16 distinct question-level expressions were found.

## G. Incomplete integrations

- Auth provider, profile screens, Home, and incident routes consume Supabase Auth and data APIs.
- Mobile draft creation/list/save/resume callers exist; evidence, submit, and post-submit callers do not.
- Incident/private evidence RLS exists in source but no UI upload/read integration or live test.
- User-file listing/upload is implemented in mobile source through owner-scoped queries, existing metadata RPCs, and private Storage; device/runtime behavior remains unverified.
- Mockup's "30 form fields filled for you" is not represented by the 8 seeded field entries.
- AI/provider and question-planner flows are not implemented.

## H. Other defects and verification risks

- **P0 verification gap**: actual mobile end-to-end workflow was not completed. The corrected dev bundle reached the profile gate, but hosted schema drift blocks Home; Android MCP fails its protocol handshake and an Android system/Play Store ANR blocked reliable visual verification.
- **P1 verification gap**: pgTAP's 53-assertion suite, the 14-assertion Phase 1 SQL suite, and the local concurrent-submit PowerShell smoke script are present but unexecuted; Docker engine was unavailable.
- **P1 migration-status gap**: remote migration listing is blocked because the network cannot connect to the project's direct IPv6 database endpoint. `SUPABASE_DB_URL` exists in Infisical, but its stored value is not a valid Postgres pooler URI and is not injected by `infisical run`.
- **P1 security/data correctness concern**: archived definitions may be unreadable to authenticated users; unverified at runtime.
- **TEST**: mobile TypeScript check and all 13 focused tests passed. The seeded-driver hosted Auth/SDK session check passed; Expo web export passed earlier. These do not prove a fresh Android sign-in or profile completion.

