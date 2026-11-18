---
name: dedupe
description: >
  Identify and eliminate confirmed duplicate code and architecture
  concepts across the JebelDAL project. Reuse existing owners for shared
  contracts, schemas, services, APIs, components, and configurations.
  Use when introducing, modifying, or renaming owned concepts, or
  when explicitly invoked with /dedupe or asked to deduplicate.
---

# Dedupe

One shared concept needs one owner. Search before introducing new schemas, APIs, services, components, helpers, permissions, configurations, or other owned concepts. Similar names alone are not proof of duplication.

## Steps

1. Identify the task scope, baseline, and introduced or renamed concepts.
2. Search the JebelDAL codebase, architecture/runbook documents, and affected sibling modules for existing implementations and synonyms.
3. Read candidate owners and consumers. Identify the authoritative owner of shared contracts, business logic, and configurations.
4. Compare implementations and confirm actual duplication before collapsing anything.
5. Reuse or extend the existing owner, migrate affected consumers, and remove only confirmed duplicates within the authorised scope.
6. Check old references, API contracts, persisted identifiers, module dependencies, and generated consumers.
7. Run the project's relevant typecheck and validation commands. Fix only issues caused by the change.

## JebelDAL ownership map

- **Product scope and behavior:** `docs/mvp-user-flows-and-requirements.md` is the current acceptance source; `docs/architecture.md` owns technical contracts and system boundaries. Check both before creating a competing implementation.
- **Database schema, RLS, and storage policies:** ordered SQL migrations under `supabase/migrations/` are the source of truth. Represent approved hosted changes in migrations rather than creating a second schema owner in dashboard-only edits.
- **Fictional reference data:** `supabase/seed.sql` owns repeatable organization/form/vehicle fixtures. Hosted Auth test users are managed separately by `scripts/seed-hosted-dev-accounts.mjs`; do not duplicate user provisioning in SQL or mobile code.
- **Mobile Supabase access:** `apps/mobile/src/lib/supabase.ts` owns the client instance and session configuration. Reuse it rather than creating screen-local Supabase clients.
- **Edge Function request validation:** `supabase/functions/_shared/schema.ts` owns schemas shared by the Supabase functions. If app/function contracts are later extracted into a shared package, migrate both consumers deliberately rather than maintaining parallel copies.
- **Environment configuration:** Infisical supplies runtime values. Mobile may receive only client-safe `EXPO_PUBLIC_*` Supabase URL/publishable-key values; service-role and AI-provider credentials belong only in trusted server-side runtimes.
- **Form and interview definitions:** follow the architecture’s versioned definition model. When checked-in form/question source files are introduced, keep one canonical definition and seed/synchronize it into Supabase; do not independently hand-maintain divergent copies.
- **Idempotency and persisted identifiers:** preserve stable incident, revision, client-turn, and evidence identifiers. Similar retry logic in different operations is not necessarily duplicate behavior; compare their contracts and lifecycle.

The current Edge Functions are scaffold stubs. Do not treat their placeholder validation or response bodies as the completed shared business-logic owner; compare them with the architecture contracts before building on them.

## Output

Provide a deduplication report containing:
- Existing owner and its location.
- Confirmed duplicates identified and removed.
- Changes made and affected consumers or modules.
- Architecture and implementation evidence.
- Similar implementations retained and why they are different.
- Validation results and checks not performed.
- Out-of-scope issues requiring parent or user approval.

## Rules

- Follow JebelDAL architecture documents and repository instructions.
- Reuse existing shared contracts and implementations instead of creating local copies.
- Check the relevant mobile app, Edge Functions, SQL migrations, seeds, environment scripts, and architecture contracts for overlap.
- Do not assume similarly named functions, schemas, APIs, or services are duplicates without comparing their responsibilities and contracts.
- Read outside the authorised write scope when necessary, but modify only authorised paths.
- If the correct shared fix is outside scope, return it to the parent or user rather than creating a local duplicate.
- Preserve existing functionality, API compatibility, module boundaries, and unrelated work.
- Do not hand-edit generated output or weaken validation checks to hide duplication.
- Do not apply migrations, deploy functions, or otherwise mutate hosted Supabase as part of deduplication unless the user explicitly authorizes that hosted action.
- Never copy secrets into reports or command output. Do not expose service-role keys, provider credentials, or real user data while checking environment/config duplication.
- Use the smallest relevant validation (normally `npm run mobile:typecheck` for mobile TypeScript changes); validate migration/RLS changes using the repository’s Supabase workflow and report hosted checks that were not performed.
- Follow the project's Git rules and report validation that was not performed.
- Stop when no confirmed in-scope duplicate remains.