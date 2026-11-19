# Engineer A/B Workstream Audit

**Audit date:** 2026-11-19  
**Branch:** `integration/sasmita-followup`, baseline `4220922`; changes remain uncommitted and unpushed.
**Scope:** Engineer A mobile and Engineer B backend. Engineer C's audio/transcription provider work remains deferred.

## Status

The Engineer A/B MVP implementation is complete in source and its database/function changes are deployed to the Supabase project previously designated by the user for development. It is not yet fully verified on physical iOS/Android devices or through an authenticated end-to-end mobile session, so this audit does not claim release-ready or literal 100% verification.

| Workstream | Completed in source | Remaining verification |
|---|---|---|
| Engineer A | Auth/profile routing, Home, incident list/create/resume, typed pinned forms, text interview, persisted answer states, repeated groups, evidence capture/upload retry, details/review, readiness preflight, device confirmation, submission, and submitted-report viewing | Physical-device camera, permissions, upload retry, local device authentication, and full authenticated journey |
| Engineer B | Versioned schema/RLS/RPCs, profile gate, complete form inventory and interview graph, answer/group/evidence lifecycle, validation/readiness, idempotent submission, and Edge Function contracts | Authenticated mobile-to-hosted smoke; local Docker-based Supabase runner remains unavailable |

### Engineer A

- The mobile app uses the shared Supabase client and server-pinned form definitions; edits are versioned and submitted through the `submit-incident` Edge Function.
- Drivers can create/resume drafts, edit supported scalar fields, add/remove optional repeated entries, capture and retry private photo evidence, review server-reported blockers, and view submitted reports read-only.
- Interview responses persist `confirmed`, `unknown`, `declined`, `not_applicable`, and `pending_follow_up` states only when the pinned question permits them. Unmapped questions cannot write arbitrary form answers.
- Local narrative recovery preserves both local and server text on conflicts and requires an explicit choice. Private-photo preview failures are surfaced rather than silently discarded.
- Device confirmation is an MVP local-auth stamp, not a legally authoritative signature. Physical device behavior remains unverified.

### Engineer B

- Ordered migrations own the schema, RLS/storage policies, versioned draft/answer/group/evidence operations, validation, readiness, and submission.
- The canonical seed now contains 158 scalar fields (Auto 66, GL 46, WC 46), seven optional repeated groups with 21 provisional typed child fields, and a 38-node/17-condition interview graph.
- Repeated-group creation validates the pinned definition; deletion checks ownership/version and removes child answers atomically. Readiness reuses the submit validator in a rollback subtransaction; submit revalidates.
- Confirmed `involved` selections activate General Liability. Non-confirmed answer states are persisted without driving branches; required and safety-critical omissions remain blockers.
- The submit Edge Function authenticates the caller, forwards the caller JWT to the RPC, and maps validation/stale/idempotency errors to stable HTTP responses.
- Audio turns remain explicitly unavailable pending Engineer C; this is outside the A/B completion scope.

## Hosted Supabase checkpoint

Changes were applied to project ref `paitemheimctgiqarekt` following the user's authorization to use that project as development. **The Supabase CLI currently labels the target environment `production`; confirm that environment label before any further hosted mutation.**

- Migration `20261119044350_close_evidence_user_file_and_report_contract_gaps` is applied; the remote migration history now contains all eight expected versions.
- The canonical `supabase/seed.sql` was executed and verified. `form_definitions` contains 66 Auto, 46 GL, and 46 WC scalar fields, plus 3/3/1 repeated groups with 7/12/2 children respectively. The default form set reports 38 interview nodes and 17 conditions.
- `submit-incident` is active at version 2 with JWT verification enabled. `process-incident-turn` is active at version 2, and `select-next-question` at version 3.
- The 104-assertion backend pgTAP file was executed against the hosted project in its own rollback transaction: 104 passed, 0 failed. The first run exposed an outdated boolean injury fixture; the test was aligned to the authored enum values and rerun successfully.
- `supabase test db --remote` itself could not start because Docker is unavailable; the test SQL was instead run with the CLI's remote SQL-file execution and its assertion results were captured transactionally.
- No authenticated live Edge Function/mobile smoke was performed; no credentials were requested or exposed.

## Validation record

Passed:

- `npm run mobile:typecheck`
- `npm --prefix apps/mobile test` — 30 tests
- `node --test supabase/tests/*.test.mjs` — 18 tests
- `cd apps/mobile && EXPO_OFFLINE=1 npx expo export --platform web`
- Hosted transactional pgTAP suite — 104 assertions, 0 failures
- `git diff --check`

Not verified:

- Physical iOS/Android camera, permission, private upload retry, and local-auth flows.
- Authenticated end-to-end mobile submission and retry against the deployed Edge Function.
- Deno-specific local typecheck/runtime tests.
- Engineer C audio/transcription integration, intentionally deferred.

## Ownership and follow-up

- `supabase/seed.sql` remains the canonical form/interview definition source; the Supabase seed hash update alone did not apply the data, so the file was executed directly and the resulting counts were checked.
- Ordered migrations remain the database/RLS owner; no dashboard-only schema changes were made.
- Mobile Supabase access remains owned by `apps/mobile/src/lib/supabase.ts`; shared Edge Function request validation remains in `supabase/functions/_shared/schema.ts`.
- Confirm the Supabase environment label before future deployment work, then run the remaining iOS/Android and authenticated end-to-end checks. Do not commit or push without explicit instruction.
