# Engineer A — Mobile App Flow & Forms Implementation Plan

**Project:** JebelDAL Voice-to-Form Assistant  
**Mode:** Plan only; no application implementation performed  
**Planning baseline:** Repository inspection and product documents available in this checkout as of 2026-11-19

## 1. Project context and objective

Deliver the driver-facing Expo application flow from invited-driver sign-in through a server-confirmed incident submission and read-only report access. Engineer A owns mobile screens, navigation, client orchestration, form and interview presentation, and recovery states. The mobile app must consume the shared contracts owned by Engineers B and C; it must not duplicate persistence, authorization, deterministic business rules, AI processing, transcription, or upload machinery.

The target journey is:

`Sign in → Profile confirmation → Home → Create/resume incident → Filled for you → Interview → Confirm details → Evidence → Review & sign → Submitted · awaiting review`

The six implementation chunks below are dependency-ordered. UI structure can be planned before backend contracts are frozen, but contract-dependent integration must pause at the listed approval gates.

## 2. Source documents inspected

| Source | Use and status |
|---|---|
| [`docs/JebelAI_User_Stories (1).xlsx`](./docs/JebelAI_User_Stories%20(1).xlsx) | Workbook v3, dated 2026-11-18; Summary, User Stories, Question Bank, Decisions, Mockup Map, Browser Verification, and README sheets inspected. The workbook has an `Owner` column, but no `Engineer A` label. The story subset below is inferred by driver-flow theme, not an official owner assignment. |
| [`docs/mvp-user-flows-and-requirements.md`](./docs/mvp-user-flows-and-requirements.md) | Current MVP behavior, priority, and product boundaries. |
| [`docs/architecture.md`](./docs/architecture.md) | Technical boundaries, data model, evaluator, API/security contracts, and verification criteria. |
| [`docs/module-wise-implementation-plan.md`](./docs/module-wise-implementation-plan.md) | Engineer A/B/C ownership and shared integration responsibilities. |
| [`docs/development-runbook.md`](./docs/development-runbook.md) | Environment and documented validation/start commands. |
| [`docs/Jebel_Browser_Verification_Gap_Report.md`](./docs/Jebel_Browser_Verification_Gap_Report.md) | Prototype-only regression observations. It does not establish production backend, RLS, or native-mobile defects. |
| [`docs/Hack-a-thon JebelAI M3 (1).pdf`](./docs/Hack-a-thon%20JebelAI%20M3%20(1).pdf) | Two-page product/challenge context; not a legal or carrier-form authority. |
| `engineer-a-feature-implementation-plan.md` | **Missing.** No matching file was found at repository root or under `docs/`; the six-chunk material in the supplied planning prompt is used instead. |

### Source hierarchy and conflict handling

Use the workbook’s decisions and Question Bank as detailed story/question sources, the current MVP requirements as product boundary, architecture as technical contract, module plan for ownership, and runbook for environment commands. Treat browser findings as prototype observations. Do not silently resolve conflicts: record them, ask the owner named below, and do not implement dependent behavior against an assumed contract.

The workbook does not explicitly assign stories to Engineer A. This plan maps the 39 driver-flow stories listed in §5 by theme and marks that mapping as inferred. The workbook’s “Brief ref” values are references, not a separate implementation-dependency field.

## 3. Engineer A scope and explicit ownership boundaries

### Engineer A owns

- Mobile navigation and authenticated app shell.
- Driver-facing Auth, Profile, Home, Incidents, and approved Files screens.
- Draft creation/resume UI and client-side workflow orchestration.
- Reusable, version-aware form renderer and field controls.
- Interview question/answer presentation, progress, back/skip/unknown states, and proposal review.
- Confirm Details, evidence presentation, Review, device-confirmation UI, and submitted/read-only screens.
- Client-side validation presentation and loading, empty, error, conflict, permission, retry, and unsynced states.
- A small local cache for current unsynced/in-progress UI input; not a second persistence system.
- UI tests/manual checks and the mobile TypeScript check.

### Engineer B owns

Database schema/migrations/seeds/RLS; authoritative persistence and answer conflict/version semantics; profile-completion persistence and editable-field allowlist; canonical form schema/key mapping; deterministic evaluation and completeness/required-evidence rules; report projections; submission validation, signature-reference lifecycle, idempotency, and report reference.

### Engineer C owns

Audio capture/transcription and provider integration; AI proposals/confidence/evidence provenance; bounded question planning; evidence capture/upload/retry, metadata, and shot-list behavior as agreed with B.

### Explicitly out of scope for Engineer A

- Manager/supervisor dashboards, queues, approval decisions, change requests, or insurer workflows.
- Backend persistence, RLS, direct status/signature writes, deterministic evaluator or question-eligibility logic, AI/provider calls, transcription, or private Storage authorization/retry implementation.
- Self-sign-up, full offline operation, or an independent persistence layer.
- Spanish, 3D damage, contradictions, video, and other optional work ahead of Must flows.
- Treating local biometric/passcode confirmation as legal signature or identity verification.

## 4. Repository baseline

### Existing

- [`apps/mobile/App.tsx`](./apps/mobile/App.tsx) is the only mobile screen. It restores a Supabase session, subscribes to auth changes, signs in with email/password, signs out, and renders a basic sign-in/signed-in view using React Native Paper.
- [`apps/mobile/src/lib/supabase.ts`](./apps/mobile/src/lib/supabase.ts) is the single mobile Supabase client. It persists native sessions through AsyncStorage and uses web-specific storage behavior; reuse it.
- [`apps/mobile/src/config/env.ts`](./apps/mobile/src/config/env.ts) validates the Supabase URL and publishable key at startup. [`apps/mobile/.env.example`](./apps/mobile/.env.example) documents the two client-safe `EXPO_PUBLIC_*` values.
- [`apps/mobile/index.ts`](./apps/mobile/index.ts) registers the Expo root and URL polyfill. [`apps/mobile/app.json`](./apps/mobile/app.json) configures app appearance and platform assets.
- Root and mobile package scripts include `mobile:typecheck` / `typecheck`; the mobile TypeScript config is strict. There is no mobile test, lint, or build script and no test/spec or Jest/Vitest configuration was found.
- Supabase migrations define a versioned form-set/definition data model, incident/revision/answer/turn/evidence/signature tables, and owner-scoped policies. The seed includes a `default` form set and fictional organization/vehicle fixtures.
- Edge Function request schemas exist in `supabase/functions/_shared/schema.ts`.

### Partial or missing

- No mobile navigation system, product screens, reusable components/theme, domain types, API client, or data-bound flow exists.
- There are no mobile calls to incident RPCs, tables, or Edge Functions.
- The mobile auth view is a scaffold, not the complete profile/home/product workflow.
- No seeded form definitions or evaluator implementation were found; form-set data alone is insufficient to render forms.
- The three named Edge Functions are scaffolds that return HTTP 501. No integrated audio, evidence-upload, or submission flow exists.
- A profile row/schema exists, but a profile-completion marker and approved editable-field allowlist are not established.
- Runbook local Supabase execution is reported as blocked/not verified due to Docker/CLI availability. Do not infer this checkout can run the local backend.

### Baseline state and verification

The orchestrator’s initial `git status --short --branch` reported `Feat/Aarti/Engineer-A...origin/Feat/Aarti/Engineer-A` with no changes. No application file was changed for this plan. No typecheck, test, Expo startup, hosted Supabase command, migration, or deployment was run.

## 5. User-story coverage matrix

The workbook has no Engineer A ownership label; the assignment below is an **inferred UI responsibility**, not an official team assignment. `Brief ref` is transcribed as a workbook reference, not treated as an implementation dependency. Backend/service work named in acceptance criteria remains owned by B/C.

| Story | Priority; brief ref | Inferred mobile chunk / integration | Acceptance criteria (workbook summary) | Current repository status |
|---|---|---|---|---|
| **ST-01 — Sign in with work email** | Must; `-` | 1; Supabase Auth | Email/password, visibility toggle, inline invalid-credential error, persisted session, password reset, no self-signup and invited-driver copy, seeded driver sign-in. | Partial auth scaffold; verify exact UI/error behavior during implementation. |
| **ST-02 — Sign in with Face ID / fingerprint** | Should; `-` | 1/6; device-local auth | Show only when enrolled/enabled; LocalAuthentication with passcode fallback; restore stored session; cancel/failure returns to login without error banner. | Missing; optional, after Must path. |
| **ST-03 — Confirm my profile from the fleet roster** | Must; `-` | 1; B profile fields/completion | Step 1/4; show roster identity and assigned unit/plate; editable values saved to profile; “Looks right” continues; back signs out. | Missing mobile UI; profile completion/allowlist contract unresolved. |
| **ST-04 — Enrol biometrics for signing** | Should; `-` | 1/6; device-local auth | Step 2/4; local scan sets local biometric-enabled state; “Not now” continues with passcode; auto-skip when unavailable. | Missing; optional and must not delay Must flow. |
| **ST-05 — Add compliance documents** | Could; `US-06` | 1; C upload, B authorization | Step 3/4, four upload cards, picker/camera, upload status, count and skip. | Missing; defer. |
| **ST-06 — Baseline walk-around photos of my unit** | Could; `US-06` | 1; C upload, B metadata | Step 4/4; four vehicle-side tiles; timestamp/GPS/vehicle association; finish/skip; successful photos appear in Files. | Missing; defer. |
| **ST-07 — Home screen with a one-tap report** | Must; `US-01` | 1; B read contract | Date/name/avatar; display-only score and seeded assignment cards; report action starts ST-09; add-document action; Home/Files/Incidents tabs. | Missing; no approved Home read shape. Omit unconfirmed data. |
| **ST-08 — See my documents and photos** | Could; `US-06` | 1/5; B/C Files/evidence contracts | Documents/Photos; rows/status/removal confirmation; successful walk-around and incident photos appear newest-first; empty state/add action. | Missing; defer unless approved. |
| **ST-09 — Start a new report** | Must; `US-01` | 2; B draft RPC, C interview | Create draft with caller’s driver/vehicle; capture time and request location; start “Filled for you” then “What happened?”; location denial must not block. | RPC/schema exists; mobile caller absent; location and product contract need confirmation. |
| **ST-10 — See my reports** | Must; `US-05` | 2; B list/detail and RLS | File-report action; Drafts/Submitted tabs/counts; report cards with supported fields; RLS-own-only; exact submitted label `Submitted · awaiting review`. | Owner-scoped schema/RLS exists; mobile projection/list UI absent. |
| **ST-11 — Resume a draft** | Must; `-` | 2; B read/write/version, C media | Autosave server-side; cache last state; resume next unanswered question with answers/audio/photos; survive restart; confirmed draft deletion only. | Missing mobile workflow; persistence/resume contract partial. |
| **ST-12 — Basics filled for me** | Must; `US-04` | 2/3; B trusted profile/vehicle, evaluator | Derive driver/unit/time/location with provenance; show “You” done and ask only missing data; story time/place wins and is confirmed. | Missing; definition and provenance contracts needed. |
| **ST-13 — Tell what happened by voice** | Must; `US-01` | 4; C audio/transcription | Speak authored first prompt; record/stop with timer/waveform; upload/transcribe after stop; transcript appears as answer; stored audio linked to incident/question; text fallback; 3-minute cap; extraction follows. | Missing; function stub and no audio flow. |
| **ST-14 — One clear question at a time** | Must; `US-02` | 4; C authored prompt/planner | One question card with helper/TTS; header/language/mute controls; prior answer can be reopened; back/forward; correct bottom actions by question type. | Missing; question service is a stub. |
| **ST-15 — Answer by tapping or by voice** | Must; `US-02` | 4; C speech mapping, B save | Single select saves/advances; multi-select requires Done; spoken choice maps to valid options; unmatched speech leaves question visible with heard response. | Missing; no answer API/turn processing. |
| **ST-16 — Quick “none” replies** | Should; `US-02` | 4; B/C definition/evaluator | Show only when definition has a none value; save and advance; value counts as answered. | Missing; depends on canonical form/question definitions. |
| **ST-17 — Skip a question** | Must; `-` | 4/5; B evaluator | Save explicit `skipped`; required skipped fields block review/submit; injury questions cannot be silently skipped and offer answer/“Not sure”. | Missing; state model exists partially; evaluator/API absent. |
| **ST-18 — See progress and time left** | Must; `-` | 4; C planner metadata | Five sections come from definition metadata; recompute `n of N` after each answer with N changing; no fixed question cap; visual segment state. | Missing; must use server-returned path/metadata. |
| **ST-19 — Mark damage on a 2D truck diagram** | Must; `US-04` | 4; B/C answer definition | Tappable tractor/trailer zones including trailer-mid; explicit No damage; empty selection is not No damage; narrative may preselect zones; targets ≥48dp. | Missing; implement 2D as Must. |
| **ST-20 — Save and leave** | Must; `-` | 2/4; B draft persistence | Close asks “Save as draft?” with Save/Discard; Home keeps the draft; draft appears in Incidents → Drafts. | Missing; include in draft lifecycle. |
| **ST-21 — Example answers** | Should; `US-02` | 3/4; B form definition | Example text comes from field `hint` in form JSON and appears in a quote pill. | Missing; definition schema absent from seed. |
| **ST-23 — Pick the right forms automatically** | Must; `US-04` | 3/5; B evaluator, C extraction | AI classifies narrative, but deterministic rules select Auto/GL/WC; multiple forms may apply; reevaluate after changed answers; persist selected forms. | Missing evaluator/data definitions; mobile must only display returned evaluation. |
| **ST-24 — Fill fields from what I say** | Must; `US-04` | 3/4; C proposals, B persistence | Runtime extraction schema from active definitions; value includes exact quote/confidence/voice source; low confidence is asked/confirmed; edited values are never overwritten; schema tests. | Missing; C processing stub; UI must keep proposals unconfirmed. |
| **ST-25 — Only ask what’s missing** | Must; `US-02` | 3/4; B evaluator, C planner | Rule-based gaps use required/required_if/min confidence/media count; safety-first then section order; filled values not re-asked; extracted option can be confirmed; no hard cap; unit tests for conditions/order. | Missing evaluator/planner; do not duplicate rules in client. |
| **ST-26 — See why a question is asked** | Should; `-` | 4; B/C definition metadata | Tag lists display names of forms needing field; omit for core questions needed by every form. | Missing; depends on canonical form metadata. |
| **ST-27 — Fill in context automatically** | Should; `-` | 3/5; B/C derived-data contract | Weather/daylight and dispatch/time-derived values carry a source badge and `derived` provenance; driver can change them. | Missing; defer until source and correction contracts exist. |
| **ST-28 — Severity and DOT recordable** | Should; `US-05` | 5; B deterministic rules | Rule-derived severity/DOT and test requirement; show on Review/Incidents; rules are unit-tested by owner. | Missing; display only B’s returned values. |
| **ST-29 — Catch contradictions** | Could; `US-05` | 5; C check, B answer ownership | Before Review, compare narrative and structured answers; show contradiction with Fix; driver can correct or dismiss. | Missing; defer; do not implement client-side duplicate AI/rules. |
| **ST-30 — Written description generated** | Must; `US-04` | 5; C generation, B field schema | Factual 2–4 sentences per form, first-person driver language, no added fault admissions, sourced facts only, editable on Review. | Missing; integrate only with approved proposal/field contract. |
| **ST-32 — Get asked for the right photos** | Must; `US-03` | 5; C shot list/upload, B required-media result | Photos only when damage/injury reported; display generated shot list; standard camera/library without live overlay; show count; skipping allowed but required minimum remains incomplete. | Missing; evidence service contract absent. |
| **ST-33 — Photo checked after I take it** | Should; `US-03` | 5; C post-capture analysis | Optional post-capture labels/coaching; no live overlay; extracted facts show photo provenance. | Missing; defer behind Must upload/review. |
| **ST-35 — Keep my voice recordings** | Must; `US-06` | 4/5; C storage/link, B metadata | Store each recording in Storage linked to incident and question; playable from Review. | Missing; audio service and association contract unresolved. |
| **ST-36 — Review my report** | Must; `US-04, US-05` | 5; B evaluator, C evidence | Form chips switch generated forms; list every field/value/source; tap to edit by voice/text; missing required items link to exact question; show photos and voice clips. | Missing; no review projection/evaluator. |
| **ST-37 — Can’t submit an incomplete report** | Must; `US-05` | 6; B authoritative validation | Disable submit with missing-field/photo reason; enable when evaluator reports zero missing; same completeness check occurs server-side. | Missing; server validation contract absent. |
| **ST-38 — Sign and submit for review** | Must; `US-04, US-05` | 6; B submit/signature | Local biometric/passcode prompt; on success server stores stamp/status and locks forms; show reference and Home action; cancel/failure leaves draft. | Submit stub; signature/reference semantics unresolved. |
| **ST-39 — See the completed forms** | Should; `US-04` | 6; B read-only projection | Success lists Auto/GL/WC; open read-only rendered form (PDF optional); access from submitted incident list. | Missing; depends on submission/detail projection. |
| **ST-40 — Check details before photos** | Must; `US-04` | 5; B trusted profile/vehicle and correction contract | Show driver/unit/time/location; map/accuracy only with supported data; allow voice/text correction with `edited` provenance; confirmation advances to Photos after Witnesses. | Missing; correctability/authoritative data contract unresolved. |
| **ST-41 — Mark damage on a 3D truck** | Should; `US-04` | 4; approved asset/renderer | 2D/3D edits the same zone list; drag/pinch/tap; licensed asset; failure falls back to working 2D and preserves selection. | Missing; defer until 2D Must flow works and asset/license is approved. |
| **ST-42 — Questions change with my answers** | Must; `US-02` | 4; B/C graph/planner | 38-node/17-condition graph; reevaluate after answers; branch changes affect current path; changing earlier answer replans; branch answers hidden, not deleted; test every condition on/off; no flow-explorer UI or question cap. | Missing; no planner implementation; mobile consumes returned path and must not build a competing evaluator. |

**Not in inferred Engineer A set:** ST-22 Spanish (Could; MVP English is required), ST-31 new-forms bonus, and ST-34 video. ST-05/06/08, ST-29, and ST-41 remain in the matrix because their driver-facing stories exist, but their Could/Should priority means they cannot delay Must flows. Non-functional `NF-*` rows are not counted as user stories and must still inform accessibility/recovery planning.

## 6. Six-chunk implementation roadmap

### Chunk 1 — Auth, Profile, Home, and navigation

**Outcome:** Restored sessions route to the correct authenticated screen; invited drivers can sign in, complete the agreed profile step, and reach a trustworthy Home.

**Execution order**

1. Retain the single existing Supabase client, validated env, session restoration, auth subscription cleanup, AsyncStorage/native-vs-web storage behavior, and error path.
2. Select the smallest Expo-compatible navigation setup after verifying compatibility; add one navigator only.
3. Implement explicit app states: session loading, signed out, signing in, authenticated, profile loading/incomplete, Home, and recoverable error.
4. Build login with email/password, visibility toggle, inline invalid-credential error, reset request, loading/disabled states, and invited-driver copy. Do not add sign-up.
5. Add the profile confirmation screen against B’s approved field allowlist and completion transition. Until confirmed, only build non-persisting presentation; do not infer completion from profile-row existence.
6. Build Home with report-entry point. Show trip/score/pre-trip panels only if B confirms a seeded read contract; otherwise omit them or use an explicitly approved empty/demo state.
7. Keep optional biometric enrollment, documents, and walk-around setup out of the Must path.

**Reuse:** `apps/mobile/App.tsx`, `apps/mobile/src/lib/supabase.ts`, `apps/mobile/src/config/env.ts`, `apps/mobile/index.ts`, `apps/mobile/app.json`.

**Proposed paths (not created):** `apps/mobile/src/navigation/RootNavigator.tsx`; `apps/mobile/src/screens/auth/*`, `profile/*`, `home/*`; shared screen-state and UI components under `apps/mobile/src/components/`.

**Dependencies / gates:** B confirms profile completion persistence, trusted profile values, editable fields, and Home read shape. Confirm navigation/library compatibility before dependency changes.

**Acceptance / verification:** session persists; invalid credentials remain on login with inline error; reset uses Supabase; no sign-up route; signed-out users cannot reach authenticated screens; profile gate follows confirmed state; Home contains only contract-backed data; `npm run mobile:typecheck` passes.

**Risks / rollback:** Profile and seeded Home assumptions can create false data or unlock filing incorrectly. Keep those panels/state transitions isolated behind the agreed contract; rollback UI wiring without changing auth/session owner.

### Chunk 2 — Incidents, draft creation, list, and resume

**Outcome:** Driver can create a server-backed draft, see only their own reports, leave safely, and resume without losing newer server data.

**Execution order**

1. Obtain B’s list/detail projection, active revision, status, answer/turn retrieval, editability, version, stale-write, and deletion contracts.
2. Build Drafts/Submitted tabs with loading, empty, error, stale, and retry states. Use authenticated RLS-scoped reads.
3. Wire Home and Incidents “file report” actions to the existing `create_incident_draft(p_form_set_key, p_form_set_version, p_language)` RPC.
4. Use returned revision UUID and pinned form-set key/version for subsequent interactions; confirm that `default` v1 / `en` is the intended contract before using it.
5. Capture device time/location only as agreed. Location denial must not block creation; retain manual location correction.
6. Implement Save/Discard/Home draft-exit UX and a small local cache for unsynced input; reconcile against server state on restart without silent overwrite.
7. Implement resume/delete only to the confirmed API contract. Submitted rows are read-only and use exact label `Submitted · awaiting review`.

**Reuse:** Supabase singleton and draft RPC/migration; no current mobile report implementation exists.

**Proposed paths (not created):** `apps/mobile/src/screens/incidents/*`, `apps/mobile/src/screens/incident/*`, `apps/mobile/src/features/incidents/*` for client orchestration/types, subject to existing module patterns established during implementation.

**Dependencies / gates:** B confirms draft RPC arguments, list/detail read shape, answer/turn retrieval, active revision, editability, version/conflict rules, deletion authorization, and supported card fields.

**Acceptance / verification:** creation uses returned identifiers; own-record access relies on RLS; draft/submitted are distinct; retry does not create duplicates; app restart reconciles local/server state; failed saves remain explicitly unsynced; submitted report cannot be edited.

**Risks / rollback:** No “saved” display before server confirmation. Do not add direct table writes, client-side ownership filtering as an RLS substitute, or row deletion based on UI assumptions.

### Chunk 3 — Data-driven Auto/GL/WC form renderer

**Outcome:** One reusable renderer presents all fields from pinned, versioned definitions with truthful provenance and safe editing.

**Execution order**

1. Obtain B’s canonical definition JSON schema, form-set activation shape, keys, versions, and seeded Auto/GL/WC definitions. Resolve `auto` / `general_liability` / `workers_comp` versus `JAI-AUTO-01`-style identifiers.
2. Build section/field renderer and controls for `text`, `long_text`, `boolean`, `number`, `currency`, `date`, `datetime`, `enum`, `multi_enum`, `phone`, `email`, `address`, `media`, and `repeated_group`.
3. Render every declared field/section and group child. Unsupported types remain visible and editable through a safe generic text fallback.
4. Render helper/hint/options/order/repeatable entries and required/conditional indicators from the definition plus evaluator response; do not locally evaluate `visibleWhen`, `requiredWhen`, activation, or eligibility.
5. Display only returned source/provenance values; persist explicit driver-confirmed values through B’s approved write contract.
6. Measure coverage over scalar fields recursively, including repeated-group children and excluding containers. Reach at least 80% with typed input, persistence, editing, validation, conditional behavior, and review display.

**Reuse:** Supabase client/env; `supabase/functions/_shared/schema.ts` is the current shared function-request validation owner, not a mobile form-definition contract.

**Proposed paths (not created):** `apps/mobile/src/features/forms/` for renderer, field controls, definition types, and tests, pending confirmation of the eventual shared contract location.

**Dependencies / gates:** B confirms form-definition schema, active forms, key mapping, version pinning, answer states/source values, repeated-group identity/upsert semantics, and evaluator responses.

**Acceptance / verification:** all fields render; supported controls are typed; unsupported controls remain editable; repeatable entries edit correctly; provenance is truthful; evaluator owns visibility/requiredness; ≥80% scalar-field target is measured, not estimated.

**Risks / rollback:** Do not create a parallel form schema or silently omit unknown fields. If contract changes, keep the renderer generic and pause data binding rather than forking definitions.

### Chunk 4 — Interview and answer workflow UI

**Outcome:** Driver moves through authored questions and confirmed answers while planner, evaluator, recording, and proposal behavior remain service-owned.

**Execution order**

1. Define the client boundary for current question, eligible path/progress/section metadata, answer state, turn ID, fallback flag, and interview-complete signal with B/C.
2. Build one-question-at-a-time UI for text, tap, voice states, single/multi-select, explicit none, unknown/declined/skipped, back/edit, and retry.
3. Use only authored prompt/options from pinned definitions or question service. Show transcript after processing; preserve a text fallback.
4. Present proposals separately with supplied field/value/evidence quote/confidence and explicit accept/edit/reject. Never overwrite confirmed or edited values.
5. Generate/use stable client turn ID per shared contract and reuse it on retry. Do not create local questions or a hard question cap.
6. Display dynamic count/sections from service metadata, planner fallback, and injury-required blocking guidance. Re-request path/evaluation after earlier answers change.
7. Add 3-minute recording UI only against Engineer C’s approved capture interface; typed answers remain available if microphone permission is denied.

**Reuse:** Shared function request schemas under `supabase/functions/_shared/schema.ts` as input contract evidence, not proof the response contract is complete; no mobile interview code exists.

**Proposed paths (not created):** `apps/mobile/src/features/interview/*`, including interview screen, answer controls, turn/proposal presentation, and focused UI tests.

**Dependencies / gates:** C confirms transcript/proposal response, evidence quote/confidence, turn status/errors/retry, authored question response, eligible-set enforcement, fallback indicator, and audio capture integration. B/C confirm answer states/source values, save/version behavior, audio evidence association, and stable retry identity.

**Acceptance / verification:** authored one-question flow; no hard cap; path count changes; no vs unknown vs declined vs skipped remain distinct; injury blockers cannot be silently skipped; proposals remain unconfirmed; retry reuses same turn ID; edits refresh server path.

**Risks / rollback:** Current functions return 501. Keep interaction components usable with clearly isolated visual fixtures only; disable fixtures for integrated flows and do not present them as production data.

### Chunk 5 — Confirm Details, evidence, and Review

**Outcome:** Driver sees trusted incident context, evidence status, applicable forms, all values/provenance, and exact unresolved blockers.

**Execution order**

1. Build Confirm Details from trusted driver/vehicle/time/location values; allow only contract-approved corrections and manual location when GPS is unavailable.
2. Show map/accuracy only when supported location data and a map component are available.
3. Render Engineer C’s shot list, evidence metadata and upload states (pending/uploaded/failed) and retry action; do not implement Storage authorization or upload machinery.
4. Render all applicable forms and triggered/not-triggered status from B’s deterministic evaluation.
5. Build Review with every defined field, repeatable entry, provenance, media, missing requirements, and field-keyed blockers; “Answer now” navigates to exact edit location.
6. Refresh evaluator/review projection after corrections; never clear blockers locally.
7. Display driver-readable labels for unknown/not-provided; do not leak internal tokens such as `DEMO_CARGO`.
8. Add Should/Could features (severity display, contradictions, photo analysis) only after Must review and owner contracts are complete.

**Reuse:** Form renderer from Chunk 3 and interview answers from Chunk 4; no current review/evidence screens exist.

**Proposed paths (not created):** `apps/mobile/src/features/review/*`, `features/evidence/*`, and `screens/incident/ConfirmDetailsScreen.tsx`, subject to final project structure.

**Dependencies / gates:** B confirms trusted context/correction and evaluator/blocker contracts; C confirms evidence metadata, shot list, upload state/retry and provenance; B/C agree who owns required-photo result.

**Acceptance / verification:** consistent driver/vehicle/time/location; GPS denial still permits manual correction; all forms/fields/provenance visible; exact blocker navigation; evidence states truthful; no raw internal tokens; no local completeness or required-photo decisions.

**Risks / rollback:** Avoid claiming upload success or report completeness from client state. If services are unavailable, show an explicit unavailable/retry state, not a mock success.

### Chunk 6 — Device confirmation, submit handoff, submitted/read-only

**Outcome:** Local device confirmation precedes an authoritative, idempotent B-owned submission; server success yields a locked, readable report.

**Execution order**

1. Confirm Expo-compatible LocalAuthentication support and OS behavior before adding a dependency.
2. Show biometric/device-passcode confirmation as a local UI stamp only. Cancellation/unavailability preserves the draft and allows retry/exit.
3. Send only the agreed revision ID, expected version, and confirmation reference to B’s submit endpoint; do not write status, signature, organization, reporter, or submitted snapshot from mobile.
4. Handle server field-validation and stale-version errors with navigation to the right edit point.
5. Reuse the same submission identity/context on uncertain network retry and display existing result if already submitted.
6. On server success, show report reference and exact `Submitted · awaiting review`; lock editing and expose read-only form access from success and Incidents.

**Reuse:** Supabase client and current `submit-incident` request schema as incomplete contract evidence; no client submission flow exists.

**Proposed paths (not created):** `apps/mobile/src/features/submission/*` and submitted report/detail screens.

**Dependencies / gates:** B resolves signature reference mapping, trusted stamp creation, atomic/idempotent transition, expected-version behavior, validation response, report reference, and read-only projection.

**Acceptance / verification:** cancel leaves draft; server remains authoritative; stale-version errors are surfaced; retries do not duplicate reports; success has reference and exact status; submitted reports are immutable/read-only.

**Risks / rollback:** The current submit function returns 501 and signature identifiers conflict. Do not wire a success-shaped fallback or direct database update while the contract is unresolved.

## 7. Per-chunk proposed file strategy

All paths in §6 are proposals, not existing files. Keep `App.tsx` as the app entry/shell only after the navigator is introduced. Reuse the existing Supabase singleton and env validator. Do not add redundant clients, navigation systems, local persistence owners, form schemas, evaluator logic, or API response models that diverge from frozen shared contracts. Add focused tests in the eventual established test setup; no test framework is currently declared.

## 8. Component and navigation architecture proposal

1. Keep the existing Expo entry and Supabase client as the sole owners of app registration and mobile session configuration.
2. Introduce one authenticated root navigator with explicit signed-out/authenticated/profile-gate states. Choose an Expo-compatible navigation dependency only after checking package compatibility; no navigation library is currently declared.
3. Separate screen presentation from feature orchestration: Auth/Profile/Home/Incidents screens; incident workflow components; shared forms/interview/review/evidence/submission features.
4. Use typed feature boundaries for Supabase RPC/table reads and Edge Function invocation, but derive request/response types from owner-approved contracts. Do not duplicate backend schemas by guessing.
5. Keep UI draft/cache state minimal and clearly mark unsynced values. Server response remains authoritative for saved, evaluated, submitted, and read-only status.
6. Treat forms and question graph as versioned data, not separate hardcoded Auto/GL/WC screens or a local interview evaluator.

This structure is intentionally a proposal because the present app has no screen/component/module architecture to extend.

## 9. API/data-contract inventory

| Area | Repository evidence | Status / required action |
|---|---|---|
| Mobile Supabase client/session | `apps/mobile/src/lib/supabase.ts`; auth flow in `apps/mobile/App.tsx` | Existing owner; preserve singleton, native AsyncStorage persistence, refresh, listener cleanup. |
| Environment | `apps/mobile/src/config/env.ts`, `.env.example` | Existing; mobile receives only URL and publishable key. Never bundle service-role or provider secrets. |
| Draft creation | `create_incident_draft` in initial migration; architecture API section | RPC exists; confirm form-set/version/language and returned revision contract before UI integration. |
| Report list/detail | Incident/revision tables and owner-scoped RLS in migration | Partial; query/projection, status/card fields, active revision and resume contract need B. |
| Profile completion | Profile schema and RLS in initial migration; architecture profile requirements | Partial/missing completion marker and confirmed editable-field allowlist. |
| Answer states/upsert/version | Answer/turn/revision schema in migration; architecture persistence model | Partial; no mobile writer or complete upsert/version/stale-write contract. Nullable `group_instance_id` requires a reliable key. |
| Form definitions | Versioned form tables in migration; `seed.sql` seeds a form set but not form definitions | Missing runtime definition data and canonical keys; reconcile `auto`/`general_liability`/`workers_comp` with architecture-style keys. |
| Deterministic evaluator | Architecture evaluation contract | Missing implementation/response; B owns, C may share question integration. Mobile only renders results. |
| Turn processing | `_shared/schema.ts`; `process-incident-turn/index.ts` | Request validation partial; handler returns 501; transcript/proposal/error/retry response absent. C owns. |
| Question planning | `select-next-question/index.ts`; architecture planner contract | Handler returns 501; authored prompt, eligible set, dynamic progress, fallback and completion response absent. C/B contract needed. |
| Audio association | Shared turn request accepts `audio_evidence_id`; persistence model needs matching association | Unresolved; B/C agree persisted link and stable retry behavior. |
| Evidence | Evidence table and private bucket/policies in migration; architecture evidence contract | Metadata/policies partial; no mobile upload service contract, shot list, completion/failure/retry or required-photo response. C owns service; B authorization/schema. |
| Submission | Signature table and submit request schema; `submit-incident/index.ts` | Handler returns 501. Signature-reference UUID vs revision-ID primary key conflict; B must specify trusted stamp lifecycle, atomic/idempotent outcome, stale/version error, validation keys, reference, read-only result. |

### Confirmed blockers and owner questions

| Blocker | Owner | Blocks | Exact question |
|---|---|---|---|
| Profile completion and editable allowlist | B | Chunk 1 integration | Which fields are editable, and what persisted state/API transition definitively means profile complete? |
| Home seeded data/read shape | B | Chunk 1 data panels | Are trip/score/pre-trip fixtures and a supported read projection available? If not, should those panels be omitted? |
| Report list/detail and resume | B | Chunk 2 integration | What projection/statuses, active revision, and answer/turn retrieval should mobile use? |
| Answer upsert, group identity, states and versioning | B | Chunks 2–4 | What is the conflict key, allowed states/source, draft-only edit rule, and which writes increment revision version? |
| Form definitions and key mismatch | B | Chunk 3 data binding; Chunks 4–5 | What canonical definition schema, form-set activation shape, keys, versions, and seeded Auto/GL/WC data should clients consume? |
| Evaluator output | B + C | Chunks 3–5 | What response contains active forms, visible/required fields, eligible unanswered questions, completion and field-keyed blockers? |
| Turn processing | C | Chunk 4 live integration | What are persisted turn states, transcript/proposal fields, evidence quote/confidence, errors and retry semantics? |
| Question planner | C | Chunk 4 live integration | What response carries authored prompt/key, eligible-set validation, fallback, path metadata and interview-complete signal? |
| Audio evidence association | B + C | Chunks 4–5 | How is audio linked to turns/answers, and what stable client ID is reused on retry? |
| Evidence upload/retry | C; B for storage authorization | Chunk 5 integration | Is upload direct to Storage or server-mediated, and what contract confirms object path, completion, retry, media constraints and required-photo result? |
| Signature reference and submit | B | Chunk 6 integration | Which trusted flow creates/verifies the device stamp, how does it map to `signature_reference`, and what idempotent success/conflict/validation response returns? |
| Local/hosted development target | Project owner | Any integration validation | Should implementation target hosted-first per runbook or local Supabase scaffold where the docs differ? What is the approved non-production validation environment? |

## 10. Engineer B/C dependency register

- **B first:** profile completion and edit allowlist; Home/list/detail projections; RPC and revision lifecycle; answer upsert/version/stale semantics; canonical forms and evaluator; submission/signature/idempotency/read-only contracts.
- **C first:** audio capture/transcription interface; turn response/proposal fields and retry; question-planner response/fallback/path semantics; evidence capture/upload/shot-list and upload retry.
- **Shared B/C:** evaluator output used by form/interview/review; answer source/state semantics; stable client-turn ID and audio-to-turn association; evidence metadata and required-photo evaluation.
- **Approval rule:** contract-dependent implementation begins only after response/schema and ownership are documented and match deployed implementation. UI composition can proceed with explicitly labeled isolated visual fixtures; fixtures must not masquerade as integrated production flows.

## 11. Browser-verification regression matrix

All findings below are prototype observations. Browser verification does not prove a mobile, backend, RLS, or production defect.

| Gap | Planned regression check | Chunk | Boundary |
|---|---|---|---|
| G-01 invalid login advanced to Profile | Invalid credentials show inline error and stay on login. | 1 | Verify actual Supabase auth behavior. |
| G-02 inconsistent driver/vehicle identity | Same trusted driver/vehicle values across Profile, Home, Confirm Details, Review. | 1, 5 | Use B’s trusted profile/assignment. |
| G-04 other drivers/incorrect statuses | Only caller-owned list via RLS; exact submitted label. | 2 | UI filtering is not a substitute for B’s RLS validation. |
| G-05 injury controls/options/skip | Match authored Question Bank; injury cannot be silently skipped. | 4 | C/B authored prompt and evaluator blocker. |
| G-06 damage zones/No damage | Trailer-mid zones present; explicit No damage; empty selection does not imply No damage. | 4 | Persist as distinct authored state. |
| G-07 form/review contradiction | Review uses evaluator’s active forms and field-keyed warnings; no local contradictory classifier. | 3, 5 | C/B contract required. |
| G-08 live camera overlay | Use standard camera/library flow, no live overlay. | 5 | C capture service owns capture details. |
| G-10 raw `DEMO_CARGO` | Driver-facing labels never expose internal/demo tokens. | 5 | Map only approved display values. |
| G-11 submit status/reference | Server-confirmed reference and exact `Submitted · awaiting review`. | 6 | B endpoint authoritative. |
| G-12 submitted form not read-only | Submitted list/detail and form views cannot edit. | 6 | B status/projection contract plus UI lock. |
| G-09 injury follow-up silently skipped | Injury follow-up blocking behavior and explicit “Not sure” path. | 4 | Verify service response, not only UI. |

## 12. Testing and verification strategy

### Automated

- After each integrated slice, run `npm run mobile:typecheck`.
- There is no existing mobile test runner/config. During implementation, add focused tests only after choosing a compatible test setup and only for introduced behavior: auth state routing, form control/render fallback, state distinction, dynamic path/progress rendering, exact blocker navigation, and submission retry/read-only transitions.
- B owns tests for migrations, RLS, deterministic evaluator, completeness, and submission semantics. C owns planner/turn/audio/evidence service tests. Mobile tests cannot stand in for these.
- Do not run hosted Supabase mutation commands as part of this plan. The runbook’s local `npx supabase db reset` is destructive even though intended for a local DB; do not run without an explicitly isolated approved local target.

### Manual/mobile checks

1. Signed-out launch; invalid credentials; password reset; session restart; sign-out.
2. Profile loading, permitted edits, completion gate, no profile-row inference.
3. Home shows only approved data; report entry from Home and Incidents.
4. Own-report list; loading/empty/error/retry; create, save/leave, resume, restart reconciliation, stale version.
5. All three forms; all supported controls; unsupported type fallback; repeated groups; field validation and provenance.
6. Voice/text/tap; proposal accept/edit/reject; transcript/error/retry; stable turn ID; dynamic question path/count; back/skip/unknown/declined; injury branch and fallback display.
7. Damage zones including trailer-mid and explicit No damage; location permission granted/denied; manual correction.
8. Evidence pending/uploaded/failed; retry; review field values/provenance; exact blocker navigation.
9. Submit cancel, server validation, stale version, uncertain-response retry, reference/status, and read-only submitted form.
10. Driver isolation validated with B’s RLS tests. Never claim backend isolation from UI filtering alone.
11. iOS and Android physical-device checks for local authentication, microphone, location, camera/library, OS permissions, and font scaling.

### Commands and checks not performed

Documented, non-hosted mobile validation is `npm run mobile:typecheck`. It was not run because this is plan-only and no implementation changes were made. No manual app/device, Supabase, Edge Function, migration, hosted, or test-runner checks were performed. Runbook commands that contact hosted services or mutate a local database require an approved environment and are not part of this planning pass.

## 13. Security, privacy, accessibility, permissions, and recovery

- Mobile gets only Supabase URL and publishable key; no service-role or provider credentials.
- Use authenticated RLS-scoped reads; never bypass RLS or retry with elevated credentials.
- Do not log raw transcript, audio, signature, or complete report payload.
- Use fictional data in visual fixtures; keep fixtures isolated from integrated flows.
- Do not display “saved” before server confirmation; visibly label unsynced state and offer retry.
- Preserve user input on transient failure; reconcile cache/server without silent overwrite.
- Microphone denial offers text fallback/settings guidance; location denial permits manual location and report creation.
- Camera/storage states must reflect actual service status; no success-shaped fallback.
- Submitted report is server-confirmed and immutable in UI.
- Follow existing theme tokens where introduced; target tap areas ≥48dp, primary actions ≥56dp, readable contrast, visible focus/disabled/loading/error states, and system font scaling to 130% without clipping.
- Device biometrics/passcode are a local confirmation stamp, not identity proof or a legally authoritative signature.

## 14. Risks, assumptions, open questions, and non-goals

### Risks / assumptions

- The workbook user-story subset assigned to Engineer A is inferred because there is no Engineer A owner label.
- Mobile scaffold is intentionally small; navigator, feature layout, test setup, and domain client structures are proposals.
- The current form set and function request schemas do not establish complete operational contracts.
- Several acceptance criteria mention behavior currently owned by B/C. Mobile work can display and orchestrate it only after contracts are confirmed.
- The development runbook’s hosted-first direction and the module plan’s local scaffold references need an owner decision.
- The manager seed/account in the runbook is not a reason to create a manager UI; current MVP is driver-only.

### Explicit non-goals

No manager/supervisor/insurer UI, self-sign-up, direct provider calls, local deterministic evaluator, full offline mode, client-owned backend persistence, legal signature, invented Home data, mock production behavior, or optional Day 3 work ahead of Must requirements.

## 15. Definition of Done for Engineer A

- Authenticated navigation and required Profile/Home flow work against confirmed contracts.
- No self-signup or manager workflow exists.
- Draft creation/list/resume and local retry integrate with B’s contracts and preserve server authority.
- One reusable renderer supports approved versioned Auto/GL/WC definitions; all fields remain visible; ≥80% of scalar fields meet typed/persisted/editable/validated/conditional/reviewable target.
- Interview UI consumes authored questions and server-computed eligible path/results; AI proposals stay separate until explicit driver confirmation.
- Dynamic progress, back, skip, unknown/declined, fallback and retry semantics work; no hard question cap.
- Confirm Details and Review show trusted values, provenance, evidence, and exact blockers.
- Evidence state is truthful and supplied by the owning service.
- Submission uses device-local confirmation and B’s authoritative endpoint; success shows report reference and `Submitted · awaiting review`.
- Submitted records are read-only.
- Loading, empty, validation, permission, network, stale-version and retry states are covered.
- `npm run mobile:typecheck` passes; manual/device checks and unavailable dependencies are documented.

## 16. Recommended sequence and approval gates

1. **Approve this plan and resolve contract ownership questions.** Confirm inferred story scope, environment target, and which optional stories are deferred.
2. **Freeze cross-owner contracts** for profile, Home/list/detail, answer/version, form definitions/evaluator, interview/audio, evidence, and submission. Record schema/response shape and owner.
3. **Implement Chunk 1 shell/auth** with profile and Home data behind confirmed contracts.
4. **Implement Chunk 2 lifecycle** after B confirms RPC/list/resume/conflict semantics.
5. **Implement Chunk 3 renderer** after definitions, keys, versions, evaluator and save contracts are available.
6. **Implement Chunk 4 interview** after B/C confirm question/turn/answer/audio contracts.
7. **Implement Chunk 5 Confirm Details/evidence/Review** after evaluator and evidence contracts are available.
8. **Implement Chunk 6 submit/read-only** only after B confirms signature mapping, trusted confirmation, idempotency and validation response.
9. **Validate each integrated slice**, then perform cross-platform manual checks and B/C-owned backend validation.

**Approval gate:** This document is a plan only. No application code, dependencies, configuration, migration, seed, or Edge Function changes have been made. Wait for explicit approval before starting Chunk 1.
