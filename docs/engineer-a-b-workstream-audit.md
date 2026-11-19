# Engineer A/B Workstream Audit and Implementation Plan

**Audit date:** 2026-11-19  
**Branch baseline:** `integration/sasmita-followup` at `916148d` plus the uncommitted changes listed below.  
**Scope:** Engineer A mobile and Engineer B database/backend. Engineer C's implementation is intentionally deferred; its contracts are called out only where they block A/B.

## Executive status

The branch contains a useful first integrated slice, not a complete MVP. Engineer A has auth/profile/Home/incidents and a text-only draft editor. Engineer B has schema, RLS, persistence RPCs, validation, and submission foundations. Static mobile validation passes after restoring the lockfile dependencies. Database behavior remains unverified because no isolated local Supabase runtime is available.

| Workstream | Implemented in source | Verified in this pass | Main remaining work |
|---|---|---|---|
| Engineer A | Auth/profile routing and confirmation; Home trip display; incident list/create/resume; text-only narrative save and local cache | `npm run mobile:typecheck`; 14 focused mobile tests; Expo web export | Full definitions-driven form renderer, complete interview, details, evidence, review, submit, and submitted report detail |
| Engineer B | Versioned persistence schema, RLS/storage policies, RPCs for draft/answers/turn/evidence/submission, profile completion, validation, deterministic form activation/completeness, submit Edge Function | Source review; migration/test files reviewed; `git diff --check` | Run SQL suites locally; complete canonical form/question definitions and deterministic evaluator/path contracts; close data/API gaps |

Two mobile defects and two backend defects found during the audit were fixed in this worktree:

- The draft editor now presents local and server text on a version conflict and requires an explicit choice.
- The profile flow now accurately presents English as the only supported MVP report language.
- A new ordered migration enforces profile completion on incident creation and submission.
- The submit Edge Function maps a reused signature reference to HTTP 409 and profile-incomplete errors to HTTP 422.

## Hosted development checkpoint

The user confirmed that Supabase ref `paitemheimctgiqarekt` is the development target, although the Supabase CLI labels its primary project environment `production`. The project was `ACTIVE_HEALTHY`.

- Before migration, the hosted migration history lacked the Engineer B persistence migration, profile/answer-validation migration, and profile-gate migration; the hosted `profiles` table lacked `employee_id` and `profile_completed_at`.
- A dry run listed exactly those three missing repository migrations. They were applied with an explicit project ref, `--include-all`, and `--skip-vault`; afterward `migration list` showed all six repository migrations aligned and no extra active versions.
- Read-only schema checks confirmed the two profile columns, profile-completion RPC and trigger, answer-validation helper, and submit RPC.
- The hosted `form_sets` and `form_definitions` tables were empty during pre-seed inspection. After reviewing the idempotent repository seed, it was applied to the confirmed development ref; read-only checks now show three active MVP form definitions and 38 interview nodes with 17 documented conditions in the versioned default form set.
- `supabase test db --remote` did not execute the suites because the CLI requires a Docker image/runtime. A separate transaction-wrapped hosted smoke test passed for incomplete-profile draft rejection, completed-profile draft creation, and incomplete-profile submission rejection; its fixture changes were rolled back.
- During history inspection, six comment-only entries were accidentally recorded through the migration-apply tool. They contained no schema/data SQL, were marked reverted immediately, and a subsequent CLI migration listing confirmed only the six repository migrations remain applied.
- The hosted advisor scan also reported a mutable search path on `public.set_updated_at`, disabled leaked-password protection, and informational unindexed-FK/unused-index findings. These remain explicit follow-ups; unrelated Auth platform settings and index changes were not altered as part of the migration checkpoint.

## Engineer A audit

### Present in source

- Expo Router app shell with invited email/password sign-in, password reset, session/profile routing, and driver-only route guards.
- Profile confirmation reads the driver's profile, assigned vehicle, and organization and persists the approved editable profile fields.
- Home reads the driver's latest trip; demo score content is labeled as demo data.
- Incidents list supports Drafts/Submitted views, draft creation, and resuming an active revision.
- The draft editor loads every server-pinned form definition, activation status, and scalar answer for a revision. It renders supported typed fields, keeps not-triggered forms read-only, reports unsupported field types, and saves through the versioned answer RPC.
- The narrative retains user/revision/field-scoped device cache recovery and explicit conflict resolution. Other unsaved field edits are not cached and are preserved only until save or explicit reload.

### Audit fixes completed

- A stale local narrative cache is no longer hidden when the server revision advances. Both copies are presented; the driver can keep the local copy for an explicit save against the current version or discard it in favor of the server copy. Submitted reports remain read-only.
- Spanish is no longer offered as if supported. The profile UI and client write use English, consistent with the English-only MVP. Spanish remains deferred optional work.
- The MVP renderer now validates and saves the supported pinned scalar field types and refreshes form activation/status after each successful save. Fields absent from the source definitions are not fabricated.

### Still missing

- Complete authored Auto/GL/WC scalar inventory and demonstrated ≥80% functional data-field coverage; repeatable-group and provenance/source controls. Current seeds define only eight fields and contain no authored sections/labels, so the UI humanizes keys until definitions supply display text.
- Complete 38-node/17-condition interview, dynamic path/progress, answer states, proposal confirmation, voice UI, transcription, and planner fallback.
- Confirm Details and corrections; evidence capture/upload/retry; full Review; device confirmation and submit caller; success/reference view; read-only submitted report detail.
- Device-level tests for sign-in/profile/Home, draft conflict resolution, restart recovery, and supported permission flows.

### Engineer A next steps

1. **Verify the current slice against hosted development:** use the explicitly confirmed development ref, keep database smoke fixtures transaction-wrapped and rolled back, and do not use client-side checks as a substitute for RLS.
2. **Integrate the canonical definition contract:** pinned definitions and activation status are consumed; integrate B-owned executable visibility/requiredness results when that evaluator exists. Do not create another form schema or treat client validation as server authority.
3. **Complete form coverage after source approval:** add only authored field metadata, then measure the 80% target and implement repeated-group/provenance controls against the completed inventory.
4. **Build the interview presentation against an agreed response contract:** authored prompt/options, turn state, answer state, revision/version, path/progress metadata, and field proposals. Keep voice/planner integration blocked until Engineer C supplies its owner contracts; do not use success-shaped fixtures.
5. **Complete details, evidence, review, and submission UI** only against B/C-owned persisted contracts. Preserve local device confirmation as a UI stamp, not a legally authoritative signature.
6. **Verify the Must journey** on iOS and Android and record permission, interruption, stale-version, retry, and read-only outcomes.

## Engineer B audit

### Present in source

- Ordered migrations define organizations, profiles, vehicles, form sets/definitions, incidents/revisions, answers/groups, turns, evidence, signatures, and private storage policies.
- Owner/organization-scoped RLS and restricted direct lifecycle writes are present in the backend migration.
- RPCs cover draft creation, answer persistence/versioning, incident detail persistence, turn/evidence persistence, and submission.
- Definition-aware answer validation, form activation, submission completeness/evidence checks, signatures, immutable submitted snapshots, and retry/idempotency logic are present in source.
- `submit-incident` authenticates the user bearer token, validates request shape, and forwards the user's JWT to the submit RPC.
- Profile completion persistence and RPC existed before this pass; this pass added a trigger so incident creation and the draft-to-submitted transition require a completed driver profile.

### Audit fixes completed

- New migration `20261119032133_enforce_profile_completion_for_incidents.sql` enforces profile completion at the database boundary for incident insertion and submission. The pgTAP fixtures and tests were updated to cover incomplete-profile rejection.
- `SIGNATURE_REFERENCE_REUSED` now maps to a stable 409 response. `PROFILE_INCOMPLETE` maps to 422.
- The default versioned form set now seeds the 38 authored interview nodes and 17 documented conditions. Four focused static tests pass for node order/count, condition references, unresolved workbook ellipses, and seed synchronization; the hosted seed was applied and the remote counts were verified.

### Still missing or unverified

- The Auto/GL/WC scalar-field seed remains a small subset and does not establish complete mockup-field coverage or the ≥80% functional data-field target. The image provides layout and labels, but not stable keys, types, requiredness, validation, or options; do not invent them.
- The graph conditions are source metadata, not an executable eligibility/path/progress evaluator; AI may not own these rules. The interview UI and evaluator response contract remain incomplete.
- SQL test files declare 54 and 15 assertions, but neither suite was executed in this pass because `supabase test db --remote` stopped at the Docker requirement. The transaction-wrapped hosted profile-gate smoke passed; full RLS/persistence suites remain unverified.
- The three missing repository migrations are now applied to hosted development, and the six-version migration history, profile columns/RPC/trigger, three active form definitions, and graph counts were verified read-only.
- Driver-files metadata creation/finalization, complete read/list/detail/resume projections, and complete client-facing field/provenance/evidence validation responses need closure against the architecture contract.
- `process-incident-turn` and `select-next-question` are outside B's mobile/data scope for this audit and remain reported 501 stubs (Engineer C work).

## Engineer B implementation plan

### B0 — Establish a safe local validation baseline

- Confirm an isolated local Docker-compatible runtime and inspect the Supabase CLI version/help before invoking commands.
- Apply the ordered migrations only to the local disposable project; never target hosted Supabase in this phase.
- Run the 54-assertion backend suite and 15-assertion phase-one suite, plus the local submit smoke test where its prerequisites are available.
- Fix migration/test failures at their source. Do not weaken assertions or use dashboard-only schema edits.

**Exit criteria:** fresh local migration application succeeds; both SQL suites and the submit smoke test pass, or each remaining environment blocker is documented with evidence.

### B1 — Freeze client persistence contracts

- Document list/detail/resume projections, active revision IDs, status values, answer/group identity, allowed answer states and provenance, and optimistic version/conflict behavior.
- Confirm which server responses supply active forms, field visibility/requiredness, completeness, evidence blockers, and exact field keys for navigation.
- Keep authorization, ownership, revision versions, and submission state server-authoritative.

**Exit criteria:** A can bind screens without guessing RPC inputs, response shapes, or persisted identifiers.

### B2 — Complete canonical form and interview source data

- Define one versioned canonical source for all Auto/GL/WC fields, options, typed controls, repeated groups, field validation, conditional rules, and display labels.
- Add the complete authored interview question set and its 17 agreed conditions to the versioned data model. Reconcile the documented 16 question expressions plus the photo-screen condition explicitly.
- Synchronize that single source into repeatable seeds; avoid a second hand-maintained mobile definition.

**Exit criteria:** schema/count tests prove the full inventory, stable keys, valid references, and a repeatable seed.

### B3 — Finish deterministic evaluation and readiness

- Implement deterministic form activation, eligible unanswered questions, conditional visibility/requiredness, safety ordering, missing field/evidence results, and re-evaluation after edits.
- Keep model choice limited to the server-computed eligible set; do not let AI set completeness, requiredness, or form activation.
- Preserve hidden-branch draft answers while excluding inactive fields from the submitted projection as specified.

**Exit criteria:** unit/SQL tests cover every branch boundary, form activation, edited earlier answers, unknown/declined/skipped distinctions, and evidence blockers.

### B4 — Complete evidence and report read contracts

- Close photo/audio evidence creation, upload-finalization, object metadata, ownership, retry, and required-photo projection.
- Complete owner-scoped incident list/detail/resume and submitted read-only projections.
- Add a secure user-file metadata lifecycle before enabling document/walk-around uploads.

**Exit criteria:** RLS and storage tests cover own-user, same-organization other-user, cross-organization, pending, finalized, and submitted immutability cases.

### B5 — Harden submission and migration operations

- Retain server-side profile completion, field/evidence readiness, expected-version checks, signature-reference binding, immutable snapshot, stable error codes, and idempotent retry.
- Add tests for every stable Edge Function error mapping and submission conflict.
- Run local advisors/security checks and review grants, RLS `USING`/`WITH CHECK`, function search paths, and private storage policies.
- Only after approval, separately reconcile hosted migration status; never infer deployment from checked-in migrations.

**Exit criteria:** local tests and security checks pass; hosted state remains explicitly reported until authorized verification is performed.

## Shared sequencing and ownership boundaries

1. Finish B0 before treating the backend as an integration baseline.
2. Freeze B1 contracts before A builds form and review bindings.
3. Complete B2/B3 before declaring interview/form coverage complete. C's voice, transcription, AI, planner implementation, and capture/upload machinery are intentionally deferred here.
4. A can proceed with presentation components against typed owner contracts, but must not duplicate business rules or portray fixtures as live data.
5. B owns schema/RLS/persistence/evaluation/submission; A owns mobile presentation/orchestration/local unsynced UI state; C remains owner of provider, planner model, and media-capture integrations.

## Validation record

Passed:

- `npm ci --prefix apps/mobile` (restored locked dependencies; no manifest/lockfile change).
- `npm run mobile:typecheck`.
- `npm --prefix apps/mobile test` — 14 tests passed.
- `cd apps/mobile && EXPO_OFFLINE=1 npx expo export --platform web`.
- `git diff --check`.

Advisory:

- `npm audit --prefix apps/mobile` reports three moderate `minimatch` advisories through Expo's transitive `@expo/fingerprint` dependency. npm only offered `npm audit fix --force`, which would downgrade Expo to 52; that breaking change was not applied. Resolve through a compatible upstream dependency update and re-run the audit.

Not run:

- pgTAP database suites and submit smoke test: no isolated local Supabase/Docker runtime available.
- Edge Function Deno typecheck/runtime tests: Deno tooling unavailable.
- Hosted Supabase migration/status, RLS, Storage, or function checks: not authorized/performed.
- Physical-device iOS/Android verification.

## Ownership/deduplication note

- The mobile Supabase client remains owned by `apps/mobile/src/lib/supabase.ts`; no second client was introduced.
- Ordered migrations remain the database/RLS owner; no dashboard-only schema changes were made.
- Shared Edge Function request validation remains in `supabase/functions/_shared/schema.ts`.
- No confirmed duplicate implementation was removed in this pass. The new draft-recovery helper is local to the existing incident feature; the profile-completion trigger centralizes a backend invariant rather than adding client-side authorization.
- Existing local plan `engineer-A.md` was preserved and not rewritten. It is an untracked planning input in this checkout; this audit document records current branch status separately.
