# JebelDAL MVP Development Runbook

**Purpose:** Keep the team aligned on hosted Supabase + Expo development workflow.  
**Status:** Scaffolded baseline with hosted-first backend. Commands below are aligned with the current repository scripts.

Related: [MVP technical architecture](./architecture.md) · [MVP user flows and requirements](./mvp-user-flows-and-requirements.md)

## Development setup at a glance

- Mobile app lives in [`apps/mobile/`](../apps/mobile).
- Backend scaffold lives in [`supabase/`](../supabase) and targets a hosted Supabase project.
- Secrets are managed in Infisical and injected at runtime.
- No provider key is exposed to the mobile app.

## Required services

| Component | Purpose | Notes |
|---|---|---|
| Node.js 22+ | Expo toolchain | Current scaffold was generated with Node 22. |
| npm | Workspace script runner | Root scripts orchestrate mobile and Supabase checks. |
| Hosted Supabase project | Auth, Postgres, Storage, Edge Functions | Current project URL is already configured externally. |
| Supabase CLI (`supabase`) | Local migrations, database tests, and hosted operations | Local config targets CLI 3.2.0; use `npx --yes supabase@3.2.0` for the local workflow below. |
| Infisical CLI (`infisical`) | Environment-specific secrets injection | Use your real Infisical slugs (`dev`, `staging`, `prod`) unless your project defines different ones. |
| Physical iOS/Android device | Validate microphone/camera/upload behavior | Simulator is not enough for final voice/media verification. |

## Repository scaffold status

### Mobile

- Expo + React Native + TypeScript scaffold in [`apps/mobile/`](../apps/mobile).
- Modern UI framework: `react-native-paper` (Material 3).
- Supabase client bootstrapped with environment validation:
  - [`apps/mobile/src/config/env.ts`](../apps/mobile/src/config/env.ts)
  - [`apps/mobile/src/lib/supabase.ts`](../apps/mobile/src/lib/supabase.ts)
- Basic sign-in shell in [`apps/mobile/App.tsx`](../apps/mobile/App.tsx).

### Backend

- Supabase config and migration scaffold in [`supabase/`](../supabase).
- Initial schema + RLS + storage policy migration:
  - [`supabase/migrations/20261118081216_initial_hosted_scaffold.sql`](../supabase/migrations/20261118081216_initial_hosted_scaffold.sql)
- Seed baseline in [`supabase/seed.sql`](../supabase/seed.sql).
- Edge Function stubs:
  - [`supabase/functions/process-incident-turn/index.ts`](../supabase/functions/process-incident-turn/index.ts)
  - [`supabase/functions/select-next-question/index.ts`](../supabase/functions/select-next-question/index.ts)
  - [`supabase/functions/submit-incident/index.ts`](../supabase/functions/submit-incident/index.ts)

## Secrets and environment model

Commit examples only; never commit real secrets.

Mobile public config (safe for client):
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

Server-only secrets (never in app bundle):
- `SUPABASE_SERVICE_ROLE_KEY`
- `GROQ_API_KEY`
- `OPENAI_API_KEY`

Use Infisical as source of truth and inject only what each runtime needs.

## Infisical bootstrap (one-time per developer)

```bash
infisical login
cd <repo-root>/jebeldal
infisical init
```

Expected outcome: project-scoped Infisical config is created for this repository so `infisical run ...` works without passing `--projectId`.

## Quick start (new developer)

From repository root:

```bash
npm run mobile:install
npm run mobile:typecheck
npm run supabase:migrations:status
npm run supabase:functions:list
npm run mobile:start:infisical:dev
```

This confirms:
- Mobile dependencies install and compile.
- Hosted migration is present.
- Hosted Edge Functions are visible.
- Expo starts with Infisical-injected env vars.

## Seeded development accounts

Use the scripted seed to create invited development Auth users, matching `public.profiles` rows, and fictional `trip_records`. It can target local or hosted development; set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for the intended environment first.

Prerequisites:
- `SUPABASE_SERVICE_ROLE_KEY` is available in your shell (recommended via Infisical).
- Hosted migration and seed have already been applied.

Run:

```bash
infisical run --env=dev -- npm run seed:dev-accounts
```

Created accounts:

| Role | Email | Password |
|---|---|---|
| driver | `driver+dev1@jebel.local` | `DevDriver#101` |
| driver | `driver+dev2@jebel.local` | `DevDriver#102` |

The script is idempotent and safe to re-run: it reuses existing users by email and upserts profiles and trip fixtures. It does not create a manager account. The legacy `manager` profile enum remains for existing-data compatibility, but Engineer B's policies and RPCs only authorize `driver` profiles.

## Run commands (hosted Supabase)

Install dependencies (repo root):

```bash
npm run mobile:install
```

Start mobile app with Infisical dev secrets injected:

```bash
npm run mobile:start:infisical:dev
```

Use the environment-specific variants when needed:

```bash
npm run mobile:start:infisical:staging
npm run mobile:start:infisical:prod
```

`mobile:start` defaults to the Infisical `dev` environment so Android does not accidentally use a host-only local Supabase URL. Use `mobile:start:local` only when intentionally targeting a running local Supabase stack and its environment is configured.  
Compatibility aliases also exist: `mobile:start:infisical:development` and `mobile:start:infisical:production`.

Other useful hosted commands:

```bash
npm run mobile:typecheck
npm run supabase:migrations:status
npm run supabase:functions:list
```

## Optional local bridge mode (mobile ↔ local Supabase)

Use this only when you intentionally want the mobile app against a local Supabase stack.

```bash
npm run supabase:local:start
npx supabase status -o env --override-name api.url=EXPO_PUBLIC_SUPABASE_URL --override-name api.anon_key=EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

Copy the printed `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` into your runtime environment (or local `.env`) before running mobile.  
For physical phones, replace `127.0.0.1` with your machine's LAN IP.

## Local backend verification (Engineer B)

JebelDAL uses ports `55420`–`55429` so its local stack can coexist with the separate `jebelai-backend` experiment on the default Supabase ports. Keep this workflow local; do not add `--remote` or `--linked`. Local Auth sign-ups are disabled; the service-role seed script creates the fictional invited users.

From the repository root in PowerShell:

```powershell
npx --yes supabase@3.2.0 start
npx --yes supabase@3.2.0 db reset --local
$local = npx --yes supabase@3.2.0 status -o env | ConvertFrom-StringData
$env:SUPABASE_URL = $local.API_URL.Trim([char]34)
$env:SUPABASE_SERVICE_ROLE_KEY = $local.SERVICE_ROLE_KEY.Trim([char]34)
npm run seed:dev-accounts
npx --yes supabase@3.2.0 test db
./scripts/test-local-submit.ps1
```

`db reset` is destructive to the JebelDAL local database only; rerun the account seed after resetting. `test db` runs the focused pgTAP suite for authorization, versioned saves, branch/form activation, evidence handling, validation, stale submit, and idempotency. The PowerShell smoke script signs in with the first fictional driver, saves a complete fixture report, sends two simultaneous requests through the local Edge Function, and verifies both plus a later retry return the same report reference. Stop only this project with `npx --yes supabase@3.2.0 stop` when finished.

The checked-in definitions in `supabase/seed.sql` are the canonical versioned MVP Auto/GL/WC forms and 38-question graph: 158 scalar fields plus 21 provisional repeated-group children across seven optional groups. They are demo forms, not validated carrier forms or legal advice. Hosted Auth configuration was not inspected or changed; invite-only hosted access must be verified separately.

### Persistence contracts

All RPC calls use the signed-in driver's Supabase client/JWT. Clients may read their own reports through RLS but cannot directly insert or update lifecycle rows.

| Owner | Operation | Request and result |
|---|---|---|
| Engineer A | Create draft | `POST /rest/v1/rpc/create_incident_draft` with `p_form_set_key`, `p_form_set_version`, `p_language`; returns the new revision UUID. The server derives owner and organization. |
| Engineer A | Save answer or skip state | `POST /rest/v1/rpc/save_incident_answer` with `p_incident_revision_id`, `p_expected_version`, exact pinned `p_form_key`/`p_field_key`, optional `p_group_instance_id`, `p_value`, `p_answer_state`, `p_source`, optional `p_evidence_id`; returns the next revision version. A non-confirmed status is saved with `p_value: null`; this RPC is the explicit persisted skip path, so no additional endpoint/RPC is required. Allowed states are `confirmed`, `unknown`, `declined`, `not_applicable`, and `pending_follow_up`. `not_applicable` is limited to optional fields and must be valueless; it cannot satisfy required readiness. Only `manual` and `driver_confirmed` sources are accepted as canonical answers. |
| Engineer A | Save details | `POST /rest/v1/rpc/save_incident_details` with revision ID, expected version, nullable `p_occurred_at`, and nullable JSON-object `p_location`; returns the next version. Pass `null` when location permission is denied; manually corrected location is allowed. |
| Engineer A | Repeatable group | `POST /rest/v1/rpc/create_incident_answer_group` with revision ID, expected version, form/group keys, and position; returns the group UUID. `delete_incident_answer_group` removes one group and its child answers in a versioned transaction. Both operations verify the pinned group key; deleting the final entry of a required group is rejected. |
| Engineer A | Readiness | `POST /rest/v1/rpc/check_incident_submission_readiness` with revision ID and expected version; returns authoritative issue metadata or `status: ready` without persisting submission/signature changes. The app requires a current-version ready result before local device authentication, then submit validates again. |
| Engineer A | Reports/resume | Read `incidents`, `incident_revisions`, `incident_revision_forms`, `incident_answers`, `incident_answer_groups`, `conversation_turns`, `evidence`, and `signatures` through PostgREST. Owner-scoped RLS is authoritative; submitted revisions are read-only. |
| Engineer C | Begin turn | `POST /rest/v1/rpc/begin_incident_turn` with `p_incident_revision_id`, stable `p_client_turn_id`, exactly one of `p_text` or `p_audio_evidence_id`, and `p_language`; returns persisted `turn_id`, status, transcript, proposals, and error code. Repeating the same ID/input returns the original turn; reusing the ID with different input returns `TURN_ID_REUSED`. |
| Engineer C | Record provider result | `POST /rest/v1/rpc/record_incident_turn_result` with revision/turn IDs, status (`processing`, `completed`, `failed`), optional transcript/proposals, and safe error code; returns the persisted turn. Proposals are advisory only and never update `incident_answers`. Forward the driver's JWT; the RPC checks the owner and draft state. |
| Engineer C | Evidence | Create metadata with `create_incident_evidence` (`p_incident_revision_id`, media type, byte size, optional description), upload to the returned exact path in private `incident-evidence`, then call `finalize_incident_evidence(p_evidence_id)`. Finalize checks object existence, MIME family/allowlist, and exact size. Upload replacement is allowed only for a pending/failed draft object; uploaded evidence cannot be replaced. Use Storage signed URLs for playback/viewing. |
| Engineer A | Submit | `POST /functions/v1/submit-incident` with `incident_revision_id`, `expected_version`, UUID `signature_reference`, `auth_method` (`biometric` or `device_passcode`), and `device_description`. Success returns `status: submitted`, `driver_status: Submitted · awaiting review`, `report_reference`, `submitted_at`, and new version. A retry with the same confirmation reference returns the original result. |

`check_incident_submission_readiness` runs the existing submit validator inside a database subtransaction and rolls back any writes before returning. Keep the submit path database-only; add no external side effects to the RPC path without replacing this preview contract.

The MVP `process-incident-turn` function completes text turns with the submitted text as transcript and `proposals: []`. Audio turns are persisted as failed with `PROVIDER_UNAVAILABLE` and HTTP 503; callers can use text input while provider integration is deferred. `select-next-question` evaluates the pinned graph using confirmed answer values only, but excludes every persisted answer state from re-asking. Its selected question includes the exact pinned `form_key` and `field_key`, supported `answer_states`, and requiredness. A question without one unique pinned-field mapping returns `form_key: null`; mobile must not invent a mapping or write a skip for it. `not_applicable` is advertised only for a matching quick reply on an optional, non-conditionally-required pinned field. The `injuries` question is safety-critical and remains required even if its form definition omits the required flag.

Migration `20261119041856_persisted_answer_skip_states.sql` keeps `injuries` required at the database definition-field boundary, normalizes invalid value-bearing `not_applicable` answers on drafts to valueless `unknown`, and validates new `not_applicable` writes. There is no separate skip RPC or Edge Function; use the existing `save_incident_answer` operation with the current `p_expected_version`, exact pinned field, `p_value: null`, and the selected answer state. Every save increments the revision version. Branch activation remains confirmed-only, and non-confirmed states do not satisfy required submission checks.

The expected version advances on answer, details, group, new-turn, and evidence create/finalize writes. Clients must use the returned version for the next mutation or submit. Submit validation returns HTTP 422 with `{ "code": "VALIDATION_FAILED", "issues": [{ "form_key", "field_key", "group_instance_id?", "code" }] }`. Other stable function errors include `AUTH_REQUIRED` (401), `NOT_ALLOWED` (403), `STALE_VERSION` / `INCIDENT_NOT_DRAFT` / `SIGNATURE_REFERENCE_REUSED` (409), and `RETRYABLE_FAILURE` (503). Database RPC errors carry SQLSTATE `P0001` with the stable code in `message`.

## Hosted Supabase deployment workflow

> Supabase CLI v3 is local-first by default. Always be explicit when targeting hosted resources.

1. Review migration SQL in [`supabase/migrations/`](../supabase/migrations).
2. Apply migrations to hosted project.
3. Deploy Edge Functions.
4. Verify table creation, RLS behavior, private storage access, and function visibility.

Hosted deploy commands:

```bash
npx supabase db push --remote=paitemheimctgiqarekt --include-all
npm run supabase:functions:deploy
```

## Troubleshooting

- **Error:** `Please either run infisical init to connect to a project...`  
  **Fix:** run `infisical init` at repository root, then retry.

- **Error:** hosted mutation confirmation blocked in agent/non-interactive mode  
  **Fix:** include `--yes` for hosted mutations (already built into `npm run supabase:functions:deploy`).

- **Error:** mobile starts but auth/network requests fail  
  **Fix:** verify `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in the selected Infisical environment.

- **Error:** seeding script says missing service-role key  
  **Fix:** add `SUPABASE_SERVICE_ROLE_KEY` to Infisical `dev` (or export manually), then rerun `infisical run --env=dev -- npm run seed:dev-accounts`.

## Security guardrails

- Keep RLS enabled on exposed tables and private storage buckets.
- Never put service-role or provider credentials in `EXPO_PUBLIC_*`.
- Keep AI output as proposal-only until driver confirmation.
- Return explicit error codes and never leak provider secrets in responses/logs.

## Current next implementation steps

1. Engineer A consumes the draft, answer, details, and read contracts in the mobile flow.
2. Engineer C adds provider transcription/extraction to the persisted turn contract; deterministic eligibility and fallback planning are implemented by the Edge Function slice.
3. Replace the minimal backend fixture definitions with the reviewed complete form definitions and workbook branch rules.
4. Verify hosted invite-only Auth settings and run physical-device, upload-retry, and full driver-journey acceptance outside the local database suite.

