# 07 - End-to-End Driver Flow Matrix

Audit date: 2026-11-19

## Evidence legend

**MOCKUP** = prototype; **MOBILE** = Expo/Android; **SOURCE** = code/contracts; **TEST** = automated test; **INFERRED** = not runtime-proven; **BLOCKED** = not tested; **MISSING** = absent.

No Supabase write, deployment, actual report submission, file upload, or real authentication attempt was made during this audit. The mockup accepted only a reserved `.invalid` address and a fake password; the emulator was observed in an already-authenticated Expo Go session.

| # | Driver step | Mockup evidence | Actual mobile evidence | Backend/source evidence | Integration result |
|---:|---|---|---|---|---|
| 1 | Driver authentication | **MOCKUP FAIL**: invalid reserved-domain credentials advanced to Profile instead of showing an error. Forgot password had no visible result. | **PARTIAL**: emulator initially targeted unreachable local `10.0.2.2:55421`; after starting with Infisical `dev`, the app restored a session and reached the profile gate. A fresh device login was not independently completed. | **TEST**: existing seeded driver's password grant returned HTTP 200/session using the hosted dev URL; the Supabase JS client persisted and restored that session in a storage test. | **HOSTED AUTH PASS; DEVICE FLOW PARTIAL** |
| 2 | Profile confirmation | **MOCKUP MISMATCH**: Home/Profile identify a different driver/vehicle/terminal than Confirm details. | **BLOCKED**: profile screen reports unavailable after the dev bundle reaches Supabase. | Hosted PostgREST returns SQLSTATE `42703` for missing `profiles.employee_id`; `profile_completed_at` is also absent. Checked-in migrations add both; remote migration status could not be read because the CLI's direct DB connection requires IPv6 on this network. | **HOSTED SCHEMA BLOCKER** |
| 3 | Home dashboard | **MOCKUP**: demo score, route, pre-trip, setup checklist and actions render. | **SOURCE**: Home route loads latest trip data and exposes incident actions; not launched on emulator. The score is explicitly demo data; setup checklist and document/photo actions are absent. | `trip_records` query filters by signed-in driver ID; trip mapping has unit/location fallbacks. | **PARTIAL / RUNTIME BLOCKED** |
| 4 | Create incident draft | Home CTA reaches Interview in the mockup; no server write observed. | **SOURCE**: Home and Incidents call `create_incident_draft` and navigate using the returned revision ID; not run against Supabase. | Existing `create_incident_draft` RPC contract is used; malformed IDs and RPC failures have unit coverage. | **SOURCE IMPLEMENTED / BACKEND TEST BLOCKED** |
| 5 | Prefill driver/truck/time/location | Mockup provides sample data; Confirm details is editable, but identity differs between screens. | **PARTIAL SOURCE**: Home displays profile/vehicle and latest trip summary. Incident Confirm-details route is absent. | Profile, vehicle, and trip queries exist; `save_incident_details` has no mobile caller. | **PARTIAL** |
| 6 | Voice or text incident description | Typed fictional text advanced to the next mockup question. Mic flow showed a canned partial/full transcript. | **MISSING** audio/text UI. | `begin_incident_turn` exists; `process-incident-turn` returns 501. | **MOCKUP ONLY** |
| 7 | Transcript and field proposals | Canned transcript was visible; real transcription/provenance was not. | **MISSING** | No Groq/OpenAI implementation in the Edge Function stub; turn-result RPC stores caller values. | **BLOCKED / MISSING** |
| 8 | Dynamic interview and branching | Some vehicle/injury paths and back navigation were exercised. Injury Skip bypassed the question; several answer sets differ from workbook. | **MISSING** | 38-node workbook source; no graph seed/mobile evaluator; `select-next-question` returns 501. | **PARTIAL MOCKUP ONLY** |
| 9 | Confirm driver/truck/time/location | Four editable mockup rows render; date/time edit enters interview with a back parameter. | **MISSING** | `save_incident_details` RPC exists; no caller. | **MOCKUP ONLY** |
| 10 | Evidence capture/upload | Camera UI and photo screen inspected. No photo/video taken or uploaded. Live AI-style overlay contradicts the no-live-overlay decision. | **MISSING**; no camera/media dependencies. | Incident evidence RPC, private bucket and finalize RPC exist; no client caller. User-file writes are unavailable. | **BLOCKED** |
| 11 | Review report | Mockup review displays sample answers and claims 30 prefilled form fields. | **MISSING** | Seed defines 8 minimal field entries, not the full report/forms. Submit RPC can check required fields from definitions. | **MOCKUP/SOURCE MISMATCH** |
| 12 | Device authentication/signature | Tap to sign immediately stamped the sample driver; no biometric/passcode prompt. | **MISSING** local-auth implementation. | Submit RPC accepts auth method/device description; architecture describes this as a UI confirmation, not device attestation. | **MOCKUP DEFECT; mobile missing** |
| 13 | Submit incident | Submit was not clicked. It was disabled before sign and enabled after the immediate mock sign. | **MISSING** | Submit Edge Function and RPC exist; no mobile caller. | **BLOCKED** |
| 14 | Submitted confirmation/reference | No real success flow was reached or submitted. | **MISSING** | RPC constructs reference and `Submitted · awaiting review`; test source covers idempotency. | **SOURCE ONLY** |
| 15 | Incident history/detail | Mockup lists 4 drafts/13 submissions and opens a carrier-form/question-flow sheet. Sample records include other drivers and manager/insurance states. | **PARTIAL SOURCE**: owner-visible Drafts/Submitted lists and status summaries exist; no submitted-report detail route. Not run against Supabase. | Mobile queries incidents, active revisions, confirmed narrative summaries, and triggered forms; RLS behavior remains unexecuted. | **PARTIAL / RLS UNVERIFIED** |
| 16 | Resume draft | Clicking a sample draft opened a generic interview state without the tested narrative visible. | **SOURCE**: draft cards navigate by active revision ID; the narrative route loads the pinned Auto definition and server answer, then conditionally restores a version-matched AsyncStorage cache. Not runtime-tested. | `save_incident_answer` checks expected version and pinned field/value; unit coverage verifies RPC arguments and response errors. | **SOURCE IMPLEMENTED / RUNTIME BLOCKED** |
| 17 | Network/provider/upload failure recovery | No network interruption, provider retry, upload retry, or app restart test was run. | **BLOCKED**; no end-to-end feature. | Contracts and SQL fields support states/versioning; provider functions are stubs. | **NOT VERIFIED** |

## Overall journey status

- **MOCKUP**: routes and selected UI paths render; prototype behavior is not a backend pass.
- **SOURCE**: Home, incident list/create, profile, and narrative draft save/resume implementations exist. The full interview and submit journey remain missing.
- **MOBILE**: ADB loaded the Infisical `dev` bundle and reached the profile gate. The profile query exposes hosted schema drift; the Android MCP handshake failed, and a system/Play Store ANR prevented reliable screenshot capture.
- **SOURCE**: persistence/submission primitives exist, but key functions, seed definitions, app screens, and callers are missing.
- **TEST**: mobile typecheck and all 13 focused tests pass. Expo web export passed earlier; the hosted Auth SDK login/session test passed. The 53-assertion pgTAP suite, 14-assertion Phase 1 SQL suite, and local concurrent-submit script remain unrun because Docker is unavailable.
- **BLOCKED**: no claim is made for a fresh device login, profile completion, Home, RLS, local cache recovery, provider, Storage, or submission.

