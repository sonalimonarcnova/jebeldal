# JebelDAL MVP Development Runbook

**Purpose:** Keep the four-engineer MVP team aligned on required services, local configuration, and the shared development workflow.
**Status:** Initial guide. Final app commands depend on the Expo scaffold.

Related: [MVP technical architecture](./architecture.md) · [MVP user flows and requirements](./mvp-user-flows-and-requirements.md)

## Development setup at a glance

- Each engineer runs an independent Supabase stack locally.
- Schema, seed data, form definitions, and function code are shared through the repository.
- A hosted Supabase project is not needed for local development.
- Real speech transcription and language-model extraction call Groq and OpenAI over the internet. Use a mock AI provider when keys are unavailable or deterministic tests are needed.
- Use fictional driver, organization, policy, vehicle, and incident data only.

## Required local services

| Component | Purpose | Setup / notes |
|---|---|---|
| Docker runtime | Runs local Supabase containers. | Must be running before `supabase start`. |
| Supabase CLI | Starts the local stack and manages migrations, seeds, and Edge Functions. | Pin one CLI version for the team as a project dev dependency when the app package is created. |
| Expo app runtime | Runs the mobile client against local Supabase. | Exact install/start commands will be added after the Expo scaffold. |
| Physical iOS/Android device | Verifies microphone, camera, media upload, and interruption recovery. | For device testing, configure the local Supabase URL with a laptop address reachable from the phone; `localhost` on the phone refers to the phone. |

The local Supabase stack provides the app's required Auth, PostgreSQL, Storage, and Edge Functions. Local Studio and email testing endpoints are printed by the CLI. Local Auth emails are captured for development; no real delivery setup is needed.

## External services

| Service | Needed for | If unavailable |
|---|---|---|
| Groq API | Real speech-to-text for recorded answers. | Use text input or a mocked transcript. |
| OpenAI API with access to the configured GPT-6 Luna model | Real structured extraction proposals. | Return fixture-based proposals through mock AI mode. |

Supabase Auth, database, Storage, and functions can be developed locally without a hosted Supabase account. AI calls are external; local Supabase does not run Groq/OpenAI models.

## Initialize the shared local Supabase project

The repository currently has no Supabase configuration. **One engineer** should initialize it once, after coordinating with the team:

```bash
npx supabase init
```

Commit the generated non-secret configuration. Teammates should not rerun `supabase init` after that file is committed. Once project configuration and migrations are present, each engineer starts their own local stack from the repository root:

```bash
npx supabase start
npx supabase status
```

Use the local endpoints/keys printed by `status` in that engineer's ignored local environment file. Do not link the project to a hosted Supabase instance for routine local work.

After migrations and seed data are committed, rebuild a clean local database with:

```bash
npx supabase db reset
```

This destroys local database state, reapplies migrations, and loads the committed seed data. Use it only against the local stack. Stop local services with:

```bash
npx supabase stop
```

## Configuration and secrets

Exact environment filenames will be settled with the Expo/Edge Function scaffold. Commit example files with placeholders, not actual values.

Use Infisical as the source of truth for environment-specific secrets. Load only the values required by the process being started: Expo receives client-safe Supabase configuration, while Groq/OpenAI credentials are injected only into the local Edge Function runtime or the hosted Supabase Function secret store. Do not sync provider credentials into `EXPO_PUBLIC_*` variables or expose them to the mobile app. The exact Infisical-to-local-function and deployment commands will be documented with the app/CI scaffold.

| Configuration | Client/server location | Rule |
|---|---|---|
| Local Supabase URL | Expo app environment | Use the CLI URL for simulator/local development; use a phone-reachable laptop address for physical-device testing. |
| Supabase anon/publishable key | Expo app environment | May be shipped to the app only with RLS enabled and tested. |
| Supabase service-role key | Trusted server-side use only | Never expose to the mobile app or commit. |
| Groq API key | Infisical → Edge Function secret/environment | Never expose through an `EXPO_PUBLIC_*` variable. |
| OpenAI API key | Infisical → Edge Function secret/environment | Never expose through an `EXPO_PUBLIC_*` variable. |

Use separate Infisical environments/credentials for local, hosted preview, and production. Keep any generated local environment files ignored by Git. If a provider secret is exposed, revoke/rotate it; removing it from the latest file is not enough.

## Repository conventions

- Store schema changes as ordered SQL migrations under `supabase/migrations/`; do not rely on manual Studio-only changes.
- Store reproducible fictional records in committed seed SQL.
- Keep shared form definitions and the 38-node interview graph in typed source files with stable keys and explicit versions.
- Seed the agreed organization, driver/manager users, profile/vehicle/policy/trip data, and the three incident scenarios.
- Keep provider calls inside Edge Functions. The app sends its signed-in user's JWT; provider credentials remain server-side.
- AI output remains a proposal. Persist a canonical answer only after driver confirmation; submission validation is deterministic.
- Use stable turn IDs and idempotent retry behavior, as defined in the architecture.

## Daily local workflow

1. Install the repository-pinned dependencies when the app scaffold and lockfile exist.
2. Start the local Supabase stack and read its endpoints with `npx supabase status`.
3. Configure local app URL/anon key; add local provider credentials only when testing real AI.
4. Start the Expo app using the committed package script (to be added with the scaffold).
5. Test the applicable Auto, Auto + property/GL, and Auto + injury/WC flows using seeded data.
6. Before handing off work, commit migrations/seeds with dependent code and verify another engineer can reset and run the same flow.

**Pending scaffold tasks:** Add the Expo project, pinned Node version, CLI dependency/version, migration/seed files, local Edge Function environment example, package scripts, and exact install/start/test commands. The current repository contains documentation only.

## Ready-to-develop checklist

- [ ] Shared Supabase configuration is committed and every engineer can start the local stack.
- [ ] Clean database reset applies all migrations and deterministic fictional seeds.
- [ ] Local Auth accounts, RLS policies, and private Storage access work for driver and manager roles.
- [ ] Edge Functions run locally in mock AI mode.
- [ ] Real Groq/OpenAI mode can be enabled using local-only secrets.
- [ ] Expo app can reach local Supabase from simulator and at least one physical test phone.
- [ ] The voice-to-review workflow survives provider/network failure without losing saved answers.

## References

- [Supabase local development](https://supabase.com/docs/guides/local-development)
- [Supabase CLI getting started](https://supabase.com/docs/guides/local-development/cli/getting-started)
- [MVP technical architecture](./architecture.md)
- [MVP user flows and requirements](./mvp-user-flows-and-requirements.md)
