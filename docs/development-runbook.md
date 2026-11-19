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
| Supabase CLI (`supabase`) | Hosted migration/function operations | Use `--remote=<project_ref>` for hosted operations. |
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

Use the scripted seed to create Auth users + matching `public.profiles` rows in hosted Supabase.

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
| manager | `manager+dev@jebel.local` | `DevManager#201` |

The script is idempotent and safe to re-run: it reuses existing users by email and upserts profile rows.

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

`mobile:start` exists but does **not** inject Infisical values. Prefer `mobile:start:infisical:*` for team usage.  
Compatibility aliases also exist: `mobile:start:infisical:development` and `mobile:start:infisical:production`.

Other useful hosted commands:

```bash
npm run mobile:typecheck
npm run supabase:migrations:status
npm run supabase:functions:list
```

## Optional local bridge mode (mobile ↔ local Supabase)

Use this when testing against a local Supabase stack. This reuses the existing database fixture seed and Auth account seeder; it does not provision or mutate hosted Supabase.

```bash
npm run supabase:local:start
npx supabase db reset
```

`db reset` rebuilds the local database, applies migrations, and runs [`supabase/seed.sql`](../supabase/seed.sql). It deletes data in the local database, so do not use it against a hosted project.

In Windows PowerShell, provision the local Auth users with the existing script. The URL check is intentional: stop if the CLI does not report the local API.

```powershell
$localEnv = npx supabase status -o env
if ($LASTEXITCODE -ne 0) { throw 'Unable to read local Supabase status.' }
$apiUrlLine = $localEnv | Select-String '^API_URL=' | Select-Object -First 1
$serviceRoleLine = $localEnv | Select-String '^SERVICE_ROLE_KEY=' | Select-Object -First 1
if (-not $apiUrlLine -or -not $serviceRoleLine) { throw 'Local API URL or service-role key is missing.' }
$env:SUPABASE_URL = ($apiUrlLine.Line -replace '^API_URL=', '').Trim('"')
$env:SUPABASE_SERVICE_ROLE_KEY = ($serviceRoleLine.Line -replace '^SERVICE_ROLE_KEY=', '').Trim('"')
if ($env:SUPABASE_URL -notmatch '^http://(127\.0\.0\.1|localhost):54321$') { throw "Refusing to seed non-local Supabase URL: $env:SUPABASE_URL" }
npm run seed:dev-accounts
Remove-Item Env:SUPABASE_URL, Env:SUPABASE_SERVICE_ROLE_KEY
```

Then configure Expo with the local anon key. Android Studio's standard emulator reaches the host machine through `10.0.2.2`; do not use that URL for the Auth seeder, which runs on the host.

```powershell
$anonKeyLine = $localEnv | Select-String '^ANON_KEY=' | Select-Object -First 1
if (-not $anonKeyLine) { throw 'Local anon key is missing.' }
$env:EXPO_PUBLIC_SUPABASE_URL = 'http://10.0.2.2:54321'
$env:EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = ($anonKeyLine.Line -replace '^ANON_KEY=', '').Trim('"')
npm run mobile:start
```

Start the Android emulator and press `a` in the Expo terminal to open the app. Only the local anon key belongs in the mobile environment; never pass `SUPABASE_SERVICE_ROLE_KEY` to Expo. For an iOS simulator use `http://127.0.0.1:54321`; for a physical phone use the computer's LAN IP and allow the API port through the firewall. Avoid `mobile:start:infisical:*` for local testing because those commands inject hosted environment values.

### Local emulator validation results (2026-11-19)

| Check | Result | Evidence |
|---|---|---|
| Docker Desktop / Engine | BLOCKED | No Docker Desktop executable was found at standard install paths; `com.docker.service` and Docker processes are absent. Docker CLI is not on `PATH`. |
| Supabase CLI / local startup | BLOCKED | `npx --no-install supabase --version` reports the package is unavailable locally. `npx --yes supabase status` exited 1 and reported Docker unavailable. No stack was started. |
| Local API port `54321` | BLOCKED | `Test-NetConnection 127.0.0.1 -Port 54321` reports the port closed. |
| Migrations and SQL fixtures | NOT VERIFIED | `supabase db reset` was not run because Docker is unavailable and database mutation was out of scope. The SQL fixtures were inspected, not applied. |
| Local Auth seeding | BLOCKED | No real local Auth API is available. A mocked CLI run completed the seeding flow with network calls intercepted; this does not create Auth users. |
| Local-only URL guard | PASS (mocked CLI tests) | The in-script allowlist accepts only `http://127.0.0.1:54321` and `http://localhost:54321`. Production, staging, malformed, and missing URLs were rejected before the mocked `fetch` was called. |
| Android emulator detection | PASS | ADB found a running emulator (`emulator-5554`). |
| Android backend URL | PASS (configuration only) | The documented Expo environment uses `http://10.0.2.2:54321`, the Android emulator host bridge. Runtime reachability was not verified because the local API is unavailable. |
| Local backend selection | NOT VERIFIED | Expo was not started; no runtime request to the configured local URL was observed. |
| Emulator sign-in | BLOCKED | No local Auth service or seeded Auth account is available to test sign-in. |

The Auth seeder's summary output omits passwords and raw API error bodies; a mocked success run confirmed the captured output contained no credential marker. The service-role key and account passwords are never written to logs. No local database, Auth users, hosted resources, or emulator application state were changed during this validation. Mocked tests do not establish database seeding, backend connectivity, or sign-in success.

### Windows Docker setup and safe diagnostics

**Confirmed blocker:** Docker Desktop / Docker Engine is missing, so Supabase local containers cannot start. Installing or starting Docker Desktop is a prerequisite; this environment did not attempt an installation. The `npx --yes supabase status` check is read-only and its output was captured rather than printed because a running local stack may display keys.

After installing Docker Desktop for Windows through the official installer, open Docker Desktop and wait until its Engine is ready. Then run these checks from the repository root; the Supabase status output remains filtered to avoid displaying keys:

```powershell
Get-Command docker -ErrorAction SilentlyContinue
docker version
Get-Service com.docker.service -ErrorAction SilentlyContinue | Select-Object Name, Status
Test-NetConnection 127.0.0.1 -Port 54321 -InformationLevel Quiet
$statusOutput = npx --yes supabase status 2>&1
$statusCode = $LASTEXITCODE
$statusText = $statusOutput -join "`n"
if ($statusCode -eq 0) { 'Supabase local status: running' }
elseif ($statusText -match '(?i)docker') { 'Supabase local status: Docker startup failure' }
else { 'Supabase local status: failed; inspect locally without sharing keys' }
```

Only after Docker is ready and local database initialization is intended, start the stack with the existing `npm run supabase:local:start` script. Do not run `npx supabase db reset` as a diagnostic; it is destructive to local database contents. No Docker installation, stack start, migration, seed, reset, or hosted operation was performed for this diagnosis.

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

1. Build seeded organization/profile/vehicle fixtures and invited test users.
2. Implement `create_incident_draft` consumption in mobile flow.
3. Replace function stubs with real validation + persistence.
4. Add deterministic question eligibility and submission validation.
5. Add end-to-end tests for cross-user isolation, required-field blocking, and idempotent submit.

