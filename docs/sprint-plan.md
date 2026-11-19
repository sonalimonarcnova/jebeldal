# JebelDAL — Sprint plan to demo (Wed 18 Nov 17:30 → Thu 19 Nov 19:00 IST)

Owner: Sonali (tech lead). This file overrides older docs where they conflict. Every Claude Code session starts with: *"Read CLAUDE.md and docs/sprint-plan.md, then do task <ID>."*

## 1. Where we are (audit of `main` @ 553f813)

| Area | Status |
|---|---|
| Docs (architecture, flows, runbook, workbook v3) | Done, detailed |
| Supabase schema + RLS + bucket | Good base. 3 bugs (below). No form definitions seeded. Seed data is wrong demo driver. |
| Edge Functions | 3 stubs returning 501 |
| Mobile app | One `App.tsx` sign-in shell. No router, no screens, no device libs installed |
| Form engine / 38-question graph | Not started |
| Voice (record → STT → extract) | Not started |
| Mockups in repo | Missing (`design/mockups/` doesn't exist) |

**Bugs to fix in DB v2**
1. `incident_answers` unique key includes nullable `group_instance_id` → NULLs are distinct, so duplicates are allowed and upsert can't target it. Use `unique nulls not distinct`.
2. Client can `update` `incidents.status` (grant + policy) → a driver could mark a report submitted without validation. Status changes must only happen in `submit-incident`.
3. Answers/evidence stay writable after submission. Writes must require revision `status = 'draft'`.
Also: hosted Auth has `enable_signup = true`; turn signups off (invite-only, ST-01).

## 2. Scope decisions for the deadline (D-23 … D-31)

| ID | Decision | Why |
|---|---|---|
| D-23 | Answers are stored once per **question key** (`form_key='interview'`). Auto/GL/WC are views built from answers + derived data. | One source of truth; no sync between 3 forms. |
| D-24 | **Next question is computed by the engine on the phone** (deterministic, instant). No LLM question planner; delete `select-next-question`. | Removes a second LLM call per turn (latency), fully testable. AI still removes questions via extraction. |
| D-25 | After each voice/typed answer, extraction proposals with **confidence ≥ 0.8 and an evidence quote found in the transcript** are saved as answers (`source='voice'`), so their questions are skipped. Lower confidence → the option is pre-selected with a "from your story" badge (one-tap confirm). The driver confirms everything on Review before signing. | Replaces per-field accept/reject after every turn (not in mockups, slow for drivers). Scores on judging #1, #5. |
| D-26 | Signature stamp is written inside `submit-incident` (auth method + device + driver name). | One atomic, idempotent call. |
| D-27 | Critical path onboarding = Profile only. Face ID enrolment, documents, walk-around, Files tab = placeholders unless time. Biometric/passcode prompt at submit = Must. | Time. |
| D-28 | Confirm screen: address text + GPS accuracy badge = Must; map = Should. | Expo Go map setup risk. |
| D-29 | Photo shot list is rule-based (engine), no vision call. Video, 3D, Spanish, weather, contradiction check: only if all Must done by Thu 15:00. | Time. |
| D-30 | Seed: Northwind Freight, Marcus Reyes, Unit 4471 · TX 8KLM-221 (replaces Dev Driver / TRK-101). | Matches mockups (D-02). |
| D-31 | Code freeze **Thu 19:00 IST**. Demo = Expo Go on phones against hosted Supabase. Record a backup video at 18:30. | Safety net. |

## 3. Shared contracts (freeze these; change only via the lead)

### 3.1 Engine types — `supabase/functions/_shared/engine/types.ts`
```ts
export type FormKey = 'auto' | 'gl' | 'wc';
export type Section = 'you' | 'scene' | 'people' | 'damage' | 'wrapup';
export type Condition =
  | { all: Condition[] } | { any: Condition[] } | { not: Condition }
  | { q: string; eq: string } | { q: string; in: string[] }
  | { q: string; has: string }          // multi-select contains
  | { q: string; answered: true }
  | { rule: 'dot_drug_test' };
export type Option = { value: string; label: string; icon?: string };
export type QuestionNode = {
  key: string; order: number; section: Section;
  prompt: string; helper?: string; hint?: string;            // hint renders as: Try: "…"
  ui: 'derived' | 'voice_open' | 'single' | 'multi' | 'truck_diagram';
  options?: Option[]; quickReplies?: Option[];
  showIf?: Condition; forms: FormKey[]; required: boolean; safety?: boolean;
  extract: { type: 'text' | 'enum' | 'enum_list'; description: string };
};
export type AnswerState = 'confirmed' | 'unknown' | 'declined' | 'not_applicable' | 'skipped';
export type AnswerSource = 'derived' | 'voice' | 'typed' | 'tap' | 'photo' | 'edited';
export type Answer = { key: string; value: string | string[] | null; state: AnswerState;
  source: AnswerSource; confidence?: number; evidenceQuote?: string; turnId?: string };
export type Answers = Record<string, Answer>;
```

### 3.2 Engine API — `supabase/functions/_shared/engine/index.ts`
```ts
visibleQuestions(answers): QuestionNode[]          // ordered, showIf true
nextQuestion(answers): QuestionNode | null         // first visible node with no answer; ui:'derived' nodes only when value missing
progress(answers, currentKey): { index: number; total: number; section: Section; minutesLeft: number }
formsFor(key): FormKey[]                           // for the "Follow-up · Auto, GL" tag
activeForms(answers): FormKey[]                    // auto always; gl if third-party property/delivery; wc if a worker is hurt
missingRequired(answers): { key: string; forms: FormKey[] }[]
severity(answers): 'low' | 'medium' | 'high'
dotRecordable(answers): boolean                    // 49 CFR 390.5 demo rule
drugTestRequired(answers): boolean                 // 49 CFR 382.303 demo rule
shotList(answers): { key: string; label: string; min: number }[]
formView(form: FormKey, answers, derived): { section: string; label: string; value: string | null; source: AnswerSource | null; missing: boolean }[]
```

### 3.3 Edge Functions
**`POST /functions/v1/process-incident-turn`** (JWT required)
```jsonc
// request — exactly one of audio_evidence_id | text
{ "incident_revision_id": "uuid", "client_turn_id": "uuid", "question_key": "what_happened",
  "audio_evidence_id": "uuid", "text": "…" }
// 200
{ "turn_id": "uuid", "status": "completed", "transcript": "…",
  "applied":   [{ "key": "involved", "value": ["another_vehicle"], "confidence": 0.93, "evidence_quote": "a silver sedan cut in front of me" }],
  "suggested": [{ "key": "weather_road", "value": ["fog"], "confidence": 0.6, "evidence_quote": "it was foggy" }],
  "latency_ms": { "stt": 820, "llm": 1400 } }
// error
{ "code": "PROVIDER_UNAVAILABLE" | "VALIDATION_FAILED" | "NOT_ALLOWED" | "INCIDENT_NOT_DRAFT", "message": "…", "retryable": true }
```
Idempotent on `(incident_revision_id, client_turn_id)`. Writes `applied` into `incident_answers` (never over `tap` / `typed` / `edited`).

**`POST /functions/v1/submit-incident`** (JWT required)
```jsonc
{ "incident_revision_id": "uuid",
  "auth_method": "biometric" | "device_passcode", "device_description": "Pixel 8 · Android 16" }
// 200 { "status": "submitted", "reference": "JDL-1119-0042", "submitted_at": "…", "active_forms": ["auto","gl"] }
// 422 { "code": "VALIDATION_FAILED", "missing": [{ "key": "police_report_no", "forms": ["auto","gl"] }] }
// 409 { "code": "INCIDENT_NOT_DRAFT" }   // only if the revision was changed by something else; a repeat call after success returns the same 200
```

**`POST /functions/v1/generate-summary`** (Thu, Should) → `{ "descriptions": { "auto": "…", "gl": "…", "wc": "…" } }` saved to `incident_revisions.summary`.

### 3.4 Storage
Bucket `incident-evidence`, path `{organization_id}/{revision_id}/{evidence_id}.{m4a|jpg|mp4}`. Evidence row first (`upload_status='pending'`), upload, then mark `uploaded`.

## 4. Owners and timeline

| Block | Anupam — engine/platform | Eng A — mobile UI | Eng B — backend/data | Eng C — voice/AI | Sonali — lead |
|---|---|---|---|---|---|
| **Wed 17:30–19:00** | T0 review of this plan | **A1a** deps + router skeleton (merge first!) | **B1** migration v2 (start) | **C1** function skeleton | **L0** commit CLAUDE.md, plan, mockups; Supabase secrets |
| **Wed 19:00–24:00** | **E1** engine + 38-node graph + forms + tests + seed-forms | **A1b** theme, login, profile, home, incidents UI, interview components (sample data) | **B1** migration v2 + seed (Marcus) + **B2** submit-incident | **C1** recorder hook, upload, process-incident-turn (Groq + OpenAI), dev voice screen | Merge PRs, deploy, smoke test |
| **Wed 23:30** | ✅ Checkpoint 1: on a phone, log in as Marcus → Home → Incidents; `npm test` green; curl `process-incident-turn` returns transcript + proposals from a real recording. |||||
| **Thu 09:00–13:00** | **E2** report start (draft + derived answers + GPS) & photos screen | **A2** interview wired to engine (with C) | **B3** incidents list RPC, seeded past reports, RLS tests | **C2** interview voice integration (with A) | **L1** integration testing, triage |
| **Thu 13:00** | ✅ Checkpoint 2: Scenario B spoken end to end through the interview on a phone. |||||
| **Thu 13:00–17:00** | **E3** biometric + submit wiring + done screen | **A3** confirm + review screens | **B4** submit hardening, deploy, hosted seed | **C3** generate-summary, latency tuning, error/retry UX | **L2** scenarios A/B/C on 2 phones |
| **Thu 17:00–19:00** | Bug fixes | Mockup polish | Bug fixes | Bug fixes | **L3** demo script, rehearsal, backup video 18:30 |
| **Thu 19:00** | 🔒 Code freeze |||||

Merge order rule: A1a (package.json/deps) must be merged before anyone else adds dependencies. Only Eng B runs `db push` / function deploys to hosted; others use their own local Supabase or ask B.

---

## 5. Claude Code prompts

Paste each prompt into Claude Code in VS Code at the repo root, on a fresh branch from `main`.

### L0 — Sonali, now (before anyone starts)
```
Read CLAUDE.md and docs/sprint-plan.md.
1. Create design/mockups/ and add a README.md listing the expected file names from the "Mockup Map" sheet of docs/JebelAI_User_Stories (1).xlsx (I will drop the PNGs in).
2. Add "vitest" as a root devDependency and a root "test" script: "vitest run". Add vitest.config.ts that includes supabase/functions/_shared/**/*.test.ts.
3. Delete supabase/functions/select-next-question (decision D-24) and remove it from the root "supabase:functions:deploy" script.
4. Run npm install at root; commit on branch chore/plan-and-rules; open a PR.
```
Then: drop the mockup PNGs into `design/mockups/` using the Mockup Map names; set hosted secrets: `npx supabase secrets set GROQ_API_KEY=… OPENAI_API_KEY=… OPENAI_MODEL=<model id>`; in the hosted dashboard turn **Auth → Sign-ups off**.

### A1a — Eng A, first 45 min (merge before 19:00)
```
Read CLAUDE.md and docs/sprint-plan.md. Task A1a: dependencies + router skeleton only.
1. In apps/mobile run `npx expo install expo-router expo-linking expo-constants expo-status-bar react-native-svg expo-audio expo-speech expo-image-picker expo-location expo-local-authentication expo-haptics expo-crypto expo-device @react-native-async-storage/async-storage` and `npm i @tanstack/react-query`.
2. Switch to Expo Router: package.json "main": "expo-router/entry"; app.json add "scheme": "jebeldal", plugins for expo-router, expo-audio (microphonePermission), expo-image-picker (cameraPermission, photosPermission), expo-location (locationWhenInUsePermission), expo-local-authentication (faceIDPermission). Move the current sign-in UI into app/(auth)/login.tsx; delete App.tsx/index.ts usage.
3. Create every route in CLAUDE.md "Routes" as a placeholder screen with its title. Root layout: PaperProvider + QueryClientProvider + auth gate (no session → login; session → (tabs)/home).
4. metro.config.js: add watchFolders for ../../supabase/functions/_shared so the app can import the engine; tsconfig: "allowImportingTsExtensions": true, path alias "@engine/*" → "../../supabase/functions/_shared/engine/*".
5. Verify: typecheck passes; app boots on Expo web and Expo Go; login → placeholder Home.
Branch feat/mobile-router; PR; tell the lead to merge immediately.
```

### A1b — Eng A, Wed evening
```
Read CLAUDE.md and docs/sprint-plan.md. Task A1b (stories ST-01, ST-03, ST-07, ST-10, ST-14, ST-15, ST-16, ST-18, ST-19, NF-01, NF-02).
1. Open every PNG in design/mockups/. Create src/theme/tokens.ts (colors, spacing, radius, typography, touch sizes) from them. Starting values to verify against the mockups: primary #111111 (black buttons), accent #0A7AFF (blue progress/links), surface #F2F2F7, card #FFFFFF, border #E5E5EA, textPrimary #111111, textSecondary #6B6B70 (darker than mockup grey for AA), recording #FF3B30, success #34C759, warningBg #FFF4E5. Wire it into a Paper MD3 theme.
2. Build screens to match mockups: login (01-login), onboarding profile (02-onboard-profile; reads/updates profiles row; "Looks right" sets onboarding_completed_at), home (06-home; seeded data from profiles.demo_home; "File an incident report" calls a `useStartReport()` hook stub that will be implemented by E2), incidents (08-incidents; Drafts/Submitted tabs; card UI; use mock data behind a `useMyIncidents()` hook with the card type from B3: {revision_id, status, created_at, active_forms, severity, location_text, vehicles, injuries}).
3. Build interview components in src/components/interview/ using the QuestionNode type from docs/sprint-plan.md §3.1 (import from @engine/types.ts; if the engine PR is not merged yet, copy the type file verbatim into src/features/interview/types.ts with a TODO):
   SectionProgress (5 segments + labels), QuestionHeaderBar ("Question n of N · about x min left", back/forward chevrons, Follow-up tag), PrevAnswerChip (✓ + text, tap to go back), QuestionCard (icon, title, helper, Hear it again → expo-speech), HintPill (Try: "…"), OptionList (single auto-advances; multi with Done), QuickReplyChip, MicButton (idle black / recording red with timer / processing spinner; props only, no recording logic), BottomBar (Home, mic, Type, Skip; and the choice variant: menu, mic, Done, skip), TypeSheet (text input bottom sheet), TruckDiagram2D (react-native-svg top-down tractor-trailer, tappable zones cab_l, cab_r, trailer_front_l, trailer_front_r, trailer_mid_l, trailer_mid_r, trailer_rear_l, trailer_rear_r, rear, front_bumper; selected = red; 2D/3D toggle with 3D disabled "coming soon").
4. Render report/[revisionId]/interview.tsx with a local array of 6 sample QuestionNodes (what_happened voice_open, involved multi, trip single, police_report_no voice_open with quick reply, truck_damage truck_diagram, injuries single safety) and local answer state, so the screen is fully clickable without backend.
5. Verify: typecheck; Expo web screenshots vs mockups 01, 02, 06, 08, q-what-happened, q-involved, q-truck-damage-2d — list differences and fix; then Expo Go on a phone (tap targets, speech).
Branch feat/mobile-screens; PR with screenshots.
```

### E1 — Anupam, Wed evening (critical path)
```
Read CLAUDE.md and docs/sprint-plan.md. Task E1: the form engine (stories ST-18, ST-23, ST-25, ST-28, ST-42, ST-37, ST-32).
1. Read docs/JebelAI_User_Stories (1).xlsx sheet "Question Bank" (python3 + openpyxl, or `npx --yes xlsx-cli`). Every non-screen row is a QuestionNode.
2. Create supabase/functions/_shared/engine/ with: types.ts (exactly §3.1), graph.ts (all 38 question nodes in workbook order + the 4 'derived' You nodes driver/vehicle/incident_time/location with fallback prompts "What is your name?", "What is your truck number or license plate?", "When did it happen?", "Where did it happen?"), forms.ts, conditions.ts, rules.ts, index.ts (API exactly §3.2). Pure TS, relative imports with .ts extensions, no dependencies.
   - Use snake_case option values (e.g. another_vehicle, object, delivery_claim, just_my_truck) and the workbook labels.
   - Translate every "Show if" into the Condition DSL. Must total 17 distinct branch conditions; the drug test node uses { rule: 'dot_drug_test' }.
   - Rules below reference these exact option values — use them: involved: another_vehicle, object, delivery_claim, just_my_truck; place_type: customer_site, our_yard, public_road, job_site; injuries: no_one, me, someone_else, me_and_someone; other_person_type: coworker, other_driver, passenger, pedestrian, customer, child; driver_treatment: none, first_aid, doctor_or_clinic, er_or_hospital, going_later; their_treatment: none, first_aid, ambulance, doctor_or_er, not_sure; drivable: can_drive, needs_tow; leak_spill: no_leak, yes_hazmat, yes_not_hazmat, not_sure; police: came, on_the_way, no_police, not_sure; tickets: no_tickets, me, other_driver, both, not_sure; serious_injury: released, admitted, still_er, not_sure.
   - injuries is safety:true. truck_damage has quick reply no_damage. Quick replies from the workbook "Quick reply" column.
   - forms.ts: Auto / GL / WC field lists (trimmed ACORD 2/3/4): each field = { section, label, from: questionKey | 'derived.<name>' | 'org.<name>' | 'vehicle.<name>', required }. Aim for 15–25 fields per form. activeForms: auto always; gl if (involved has object AND place_type ≠ our_yard) OR involved has delivery_claim OR other_person_type in (pedestrian, customer); wc if injuries in (me, me_and_someone) OR other_person_type = coworker.
   - rules.ts: dotRecordable = fatality OR injury treated away from scene (driver_treatment in doctor_or_clinic, er_or_hospital OR their_treatment in ambulance, doctor_or_er) OR drivable = needs_tow. drugTestRequired = fatality OR (tickets not in no_tickets/not_sure AND (treated away OR tow)). severity: high if tow, hazmat leak, ER/hospital or ambulance; medium if any injury, police came, or other vehicle/property; else low. shotList: truck damage zones → "Damage on your truck" (min 1); another_vehicle → "Other vehicle and its plate" (min 1); object → "What got damaged" (min 1); injuries ≠ no_one → "The injury, if you're okay to" (min 0); always "The scene / road" (min 0).
   - progress.minutesLeft ≈ ceil(remaining * 0.2).
3. Tests (vitest, *.test.ts next to the code): each of the 17 conditions on/off; nextQuestion never returns an answered node; derived nodes skipped when present; the three scenario paths — A (brief's bollard while reversing in our yard: involved=object, place_type=our_yard, truck damage rear, no injury, no police), B (I-35 rear-end that also clipped a gas-station fence: another_vehicle + object, place_type=public_road, police came, no injury), C (pallet hits foot while unloading at a customer dock: just_my_truck, injuries=me) — produce expected activeForms (A: auto; B: auto+gl; C: auto+wc) and reach nextQuestion() === null when all answered; missingRequired lists skipped required keys; rules truth tables.
4. scripts/seed-forms.ts (run with `npx tsx`): upserts form_definitions rows (form_key 'interview' with the graph, 'auto', 'gl', 'wc') version 1 status active, using SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from env.
5. Verify: `npm test` green, `npm run mobile:typecheck` green (the app imports @engine/index.ts somewhere trivial to prove Metro resolution), seed-forms runs against local Supabase.
Branch feat/engine; PR listing the 38 keys and 17 conditions.
```

### B1 + B2 — Eng B, Wed evening
```
Read CLAUDE.md and docs/sprint-plan.md. Task B1 (DB v2) then B2 (submit-incident). Use the supabase and supabase-postgres-best-practices skills in .agents/skills.
B1 — new migration file (never edit the existing one):
 a. incident_answers: drop the existing unique constraint (look up its name in pg_constraint) and add UNIQUE NULLS NOT DISTINCT (incident_revision_id, form_key, field_key, group_instance_id). Add evidence_quote text. answer_state check: add 'skipped'.
 b. profiles: add employee_id text, home_terminal text, role_title text, onboarding_completed_at timestamptz, demo_home jsonb.
 c. incident_revisions: add active_forms text[] default '{auto}', severity text, dot_recordable boolean, drug_test_required boolean, summary jsonb, reference_no text unique, location_text text.
 d. evidence: add question_key text, shot_key text.
 e. Lock down: recreate create_incident_draft as SECURITY DEFINER (set search_path = public, keep the auth.uid() profile check) because it updates incidents.active_revision_id; then revoke UPDATE on public.incidents from authenticated; on incident_revisions grant UPDATE only on (occurred_at, location, location_text, language). incident_answers / evidence / conversation_turns insert+update policies additionally require the revision status = 'draft'. Drop the client signatures insert/update policies (submit-incident writes them with the service role).
 f. RPC list_my_incidents() security invoker returning: revision_id, incident_id, status, created_at, submitted_at, active_forms, severity, location_text, reference_no, vehicles_involved int, injuries int (derive the two counts from answers 'involved' and 'injuries').
 g. Seed (supabase/seed.sql): organization 11111111-… renamed "Northwind Freight"; vehicles: Unit 4471 plate "TX 8KLM-221" Freightliner Cascadia (id 22222222-…-221) and Unit 1842 for driver 2. Update scripts/seed-hosted-dev-accounts.mjs: accounts = Marcus Reyes marcus.reyes@northwindfreight.com (employee NW-20417, Austin, TX, role_title "Driver", vehicle Unit 4471, demo_home {score:92, rank:"Top 15% at Austin", trend:"+3 points in 30 days", route:"Austin → San Antonio", miles:80, depart:"6:30 AM", pretrip_due:"6:00 AM"}) and a second driver for RLS tests; remove the manager account. Passwords come from env (DEMO_PASSWORD) — never hard-code.
 h. Write supabase/tests/rls.sql or a node script proving driver 2 cannot read Marcus's incident, answers or storage objects, and that a driver cannot update incidents.status.
B2 — update submitIncidentSchema in supabase/functions/_shared/schema.ts to match §3.3 (remove expected_version and signature_reference; add auth_method, device_description). supabase/functions/submit-incident per docs/sprint-plan.md §3.3: verify JWT (user client), load revision + answers, compute missingRequired/activeForms/severity/dotRecordable/drugTestRequired with the engine (import ../_shared/engine/index.ts), then with a service-role client in one RPC or transaction: insert signature, set status submitted on revision+incident, submitted_snapshot (answers + formView per active form), reference_no JDL-MMDD-#### , submitted_at. Idempotent. Add scripts/curl/submit-incident.sh.
Verify locally (supabase start, db reset, seed scripts), then push to hosted and deploy (you are the only one who does this). Branch feat/db-v2; PR with test output.
```

### C1 — Eng C, Wed evening
```
Read CLAUDE.md and docs/sprint-plan.md. Task C1: voice pipeline (ST-13, ST-24, ST-25, ST-35).
1. Add question_key (string, required) to incidentTurnSchema in supabase/functions/_shared/schema.ts. supabase/functions/process-incident-turn per §3.3:
   - user-scoped supabase client from the Authorization header; verify the revision belongs to the caller and is draft; idempotency on client_turn_id (return stored result).
   - audio: download from storage (evidence row → object_path), POST to Groq https://api.groq.com/openai/v1/audio/transcriptions model "whisper-large-v3-turbo", language "en", response_format "json". text: use as transcript.
   - extraction: OpenAI Responses API (model from env OPENAI_MODEL) with a strict JSON schema: { proposals: [{ key: enum(all non-derived question keys), value: string | string[], confidence: number, evidence_quote: string }] }. Build the prompt from the engine graph (import ../_shared/engine/graph.ts): for each question send key, prompt, extract.type/description and allowed option values. Tell the model: the current question is <question_key> — answer it first; also extract any other question answered in the transcript; never guess; evidence_quote must be copied verbatim from the transcript; for enum keys use only allowed values.
   - validate every proposal: key exists, values ∈ options, evidence_quote is a substring of the transcript (case-insensitive), confidence 0–1. Split into applied (≥0.8) and suggested. Upsert applied into incident_answers (form_key 'interview', source 'voice', state 'confirmed', evidence_quote, transcript_turn_id) unless the existing answer's source is tap/typed/edited.
   - always also save the current question's own answer: if no valid proposal for question_key and the question is voice_open, save the transcript itself as its value (source voice).
   - persist the turn (status, transcript, proposals jsonb, error_code); return latency_ms. Timeouts: 20 s per provider; on failure mark turn failed and return { code:'PROVIDER_UNAVAILABLE', retryable:true }.
2. Mobile: src/features/voice/useRecorder.ts (expo-audio: permissions, prepare + record with metering enabled, stop, 3-minute cap, expose { state, seconds, levels: number[] (last 40 normalised metering values), uri }); src/lib/evidence.ts uploadEvidence({revisionId, uri, mediaType, questionKey}) (insert evidence row → upload to storage path §3.4 → mark uploaded; returns evidence id); src/lib/api.ts processTurn(...) and submitIncident(...) typed with the §3.3 contracts (zod parse of responses).
3. Dev screen app/dev/voice.tsx: record → upload → processTurn against a draft created via rpc create_incident_draft → show transcript, applied, suggested, latency. Hidden route for testing on a phone.
4. scripts/curl/process-incident-turn.sh (text mode) with Scenario B text: "A silver sedan cut in front of me from the right lane on I-35 north near exit 235 and braked hard. I couldn't stop, hit the back of it at low speed and my trailer clipped the fence of the gas station. Police came. Nobody was hurt. Front bumper is bent."
5. Verify: curl returns applied answers for involved (another_vehicle + object), police, injuries, truck_damage; on a phone the dev screen shows a transcript within ~3 s for a 30 s clip (report the measured numbers in the PR).
Branch feat/voice-pipeline; PR.
```

### E2 — Anupam, Thu morning
```
Read CLAUDE.md and docs/sprint-plan.md. Task E2 (ST-09, ST-12, ST-32, ST-40).
1. src/features/report/useStartReport.ts: rpc create_incident_draft → upsert derived answers driver (profile display_name), vehicle ("Unit 4471 · TX 8KLM-221" from assigned vehicle), incident_time (now, ISO), location (expo-location current position + reverseGeocodeAsync → "I-35 N near exit 235, Austin, TX"-style text; store lat/lng/accuracy in incident_revisions.location and location_text). If location permission is denied, leave location unanswered so the engine asks "Where did it happen?" with the "Use where I am now" quick reply. Navigate to interview.
2. src/features/report/useReport.ts: TanStack Query hooks to load revision + answers into the engine Answers map, saveAnswer(key, value, source, state) with optimistic update + AsyncStorage cache per revision, and resume on reopen (ST-11).
3. report/[revisionId]/photos.tsx per mockup "photos": header with Skip, engine shotList(answers) as checklist, Take photo (expo-image-picker camera) / pick from library, upload via uploadEvidence(mediaType 'photo', shot_key), thumbnails with retry on failure, Continue → review. Standard camera only (D-04).
4. Verify on a phone: start report with and without location permission; photo upload appears in storage and evidence table.
Branch feat/report-start-photos; PR.
```

### A2 + C2 — Eng A and Eng C together, Thu morning (pair)
```
Read CLAUDE.md and docs/sprint-plan.md. Task A2/C2: wire the interview to the engine and voice (ST-13…ST-18, ST-21, ST-25, ST-26).
1. Replace the sample questions with @engine: current = nextQuestion(answers) unless the driver navigated back; header uses progress(); Follow-up tag uses formsFor(key) when the node is not in all three forms; section bar from node.section.
2. Speak each new question with expo-speech (mute toggle in header; Hear it again replays).
3. Voice: MicButton → useRecorder → on stop: uploadEvidence(audio) → processTurn({question_key: current.key, audio_evidence_id}) → show transcript as the PrevAnswerChip → refetch answers → engine picks the next unanswered question (skipping everything that was applied). Type → TypeSheet → processTurn({text}). Processing state shows a spinner on the mic; errors show a retry + "Type instead" banner; nothing already saved is lost.
4. Choice questions: tap saves with source 'tap'; single auto-advances; multi needs Done. If a suggested value exists for the node, pre-select it and show a small "from your story" badge (D-25). Mic on a choice question sends processTurn with question_key and the mapped option comes back in applied.
5. Quick replies save their value with state per option (e.g. no_number_yet → state 'unknown'). Skip saves state 'skipped' (blocked for safety nodes: show "Please choose an answer or Not sure").
6. Back/forward chevrons and tapping the previous-answer chip navigate answered nodes; changing an answer re-plans.
7. When nextQuestion() is null → router.push confirm.
8. Verify on a phone with Scenario B spoken in one go at "What happened?": count how many questions remain (target ≤ 12 taps/answers), all answers saved, kill app mid-interview and resume.
Branch feat/interview-live; PR with a screen recording.
```

### B3 — Eng B, Thu morning
```
Read CLAUDE.md and docs/sprint-plan.md. Task B3 (ST-10, ST-11, NF-04, NF-06).
1. useMyIncidents() in the app → rpc list_my_incidents(); wire incidents.tsx Drafts/Submitted tabs and counts; tapping a draft opens interview (resume), a submitted one opens done.tsx in read-only mode. Status pill text "Submitted · awaiting review".
2. Seed 3 past submitted reports for Marcus via a script (realistic Austin/Texas data, different severities and forms) so the list looks real.
3. Run the RLS test script against hosted; fix any leak.
4. Deploy all functions to hosted; confirm secrets are set; post the hosted smoke test result in the PR.
Branch feat/incidents-list; PR.
```

### A3 — Eng A, Thu afternoon
```
Read CLAUDE.md and docs/sprint-plan.md. Task A3 (ST-36, ST-37, ST-40, ST-30).
1. confirm.tsx per mockup "confirm-details" ("Is this right?"): rows driver/vehicle/date-time/location with source captions (your login / truck assignment / phone GPS), green check, tap row → edit sheet (voice via processTurn with the row's question key, or typing) saving source 'edited'; GPS accuracy badge; map only if react-native-maps works in Expo Go in < 30 min (D-28). "Yes, that's right" → photos if shotList has min ≥ 1 items or the driver wants to add photos, else review.
2. review.tsx per mockup "review" ("Check your report"): chips per activeForms (Auto / General liability / Workers' comp); list formView(form) rows with a small source marker; tap any row → same edit sheet; missing required rows in red at the top with "Answer now" → jumps to that question in the interview; photo thumbnails strip; audio clips playable; description from generate-summary when available.
3. "Submit for review" button disabled with reason ("2 answers missing") while missingRequired(answers).length > 0.
Verify against mockups on web and phone. Branch feat/confirm-review; PR.
```

### E3 — Anupam, Thu afternoon
```
Read CLAUDE.md and docs/sprint-plan.md. Task E3 (ST-38, ST-39).
1. On Submit: expo-local-authentication authenticateAsync({promptMessage:"Sign your report"}) (falls back to device passcode; on web/simulator allow a "Confirm" dialog) → submitIncident({auth_method, device_description from expo-device}) → on 422 show the missing list and route to the first missing question; on 200 → done.tsx.
2. done.tsx: success state with reference number, "Submitted · awaiting review", and one card per active form opening a read-only formView list (Carrier forms filed). Back to home.
3. Verify Scenario A end to end on a phone; repeat submit (double tap) creates one report.
Branch feat/sign-submit; PR.
```

### C3 — Eng C, Thu afternoon
```
Read CLAUDE.md and docs/sprint-plan.md. Task C3 (ST-30, NF-03).
1. supabase/functions/generate-summary: from confirmed answers per active form write a 2–4 sentence factual "Description of loss" in first person using only stated facts (no fault admission, no invented details); save to incident_revisions.summary; call it when the driver reaches review (fire and forget, show when ready).
2. Measure and log STT/LLM latency on 10 phone recordings; if p50 > 3 s, reduce the extraction prompt (send only visible + not-yet-answered keys) and set Groq timeouts.
3. Failure UX: airplane-mode test and provider-error test — banner, retry, Type instead; no lost answers.
Branch feat/summary-resilience; PR with numbers.
```

### L1–L3 — Sonali
- **L1 (Thu 09:00):** merge order E1 → B1/B2 → A1b → C1. After each merge: `npm test`, typecheck, run on your phone. Keep a triage list in the PR board; anything not on the critical path waits.
- **L2 (Thu 13:00–17:00):** run Scenario A, B, C on two phones (iOS + Android). For each: questions asked, time taken, forms activated, missing items, submit result. File bugs with owner + story ID.
- **L3 (Thu 17:00–19:00):** demo script (below), rehearse twice, record backup video at 18:30, freeze at 19:00.

## 6. Demo script (≈4 min)
1. Problem (15 s): forms after a crash are long; drivers are stressed and on a phone.
2. Login as Marcus → Home → "File an incident report". Driver, truck, time and location are already filled.
3. One spoken answer (Scenario B): *"A silver sedan cut in front of me from the right lane on I-35 north near exit 235 and braked hard. I couldn't stop, hit the back of it at low speed and my trailer clipped the fence of the gas station. The police came. Nobody was hurt. My front bumper is bent."*
4. Show the question count drop; answer the remaining follow-ups (mix of taps and voice); point at the "Follow-up · General liability" tag on "Who owns it?" = the form engine adding questions because the fence activated GL.
5. Confirm details → photo of the bumper → Review: Auto + GL filled, sources marked, description written → Face ID → "Submitted · awaiting review".
6. Innovation (30 s): forms are data (one graph, 38 questions, 17 branches, 3 forms), DOT recordable + post-accident test rules, nothing invented by AI (evidence quotes).

## 7. Risks
| Risk | Mitigation |
|---|---|
| Metro can't import the engine from supabase/functions/_shared | A1a proves it in the first hour; fallback: copy engine into apps/mobile/src/engine via a `npm run sync:engine` script. |
| OpenAI model id / structured output errors | OPENAI_MODEL in env; C1 tests with curl first. |
| Groq audio format from iOS/Android | Record m4a (AAC) — supported; C1 tests on both platforms Wed night. |
| Infisical slows teammates | `.env` fallback allowed locally (gitignored). |
| Expo Go native module gaps | All modules chosen are in Expo Go; EAS APK as backup only if time. |
