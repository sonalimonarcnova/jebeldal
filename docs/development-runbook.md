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
| Infisical CLI (`infisical`) | Environment-specific secrets injection | Use separate environments for development/staging/production. |
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
npm run mobile:start:infisical:development
```

This confirms:
- Mobile dependencies install and compile.
- Hosted migration is present.
- Hosted Edge Functions are visible.
- Expo starts with Infisical-injected env vars.

## Run commands (hosted Supabase)

Install dependencies (repo root):

```bash
npm run mobile:install
```

Start mobile app with Infisical development secrets injected:

```bash
npm run mobile:start:infisical:development
```

Use the environment-specific variants when needed:

```bash
npm run mobile:start:infisical:staging
npm run mobile:start:infisical:production
```

`mobile:start` exists but does **not** inject Infisical values. Prefer `mobile:start:infisical:*` for team usage.

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

