# 09 - Prioritized Implementation Plan

Audit date: 2026-11-19

**Approval gate:** This is a plan only. No application source, Supabase config/schema, hosted services, or emulator state was changed. Do not start implementation until the user approves a batch.

## Ownership and dependencies

| Workstream | Owner from module plan | Dependencies |
|---|---|---|
| Mobile routing/auth/profile/home/incidents/forms/review | Engineer A | Shared API contracts, approved route/state model, backend draft/read/write contracts. |
| Schema, RPCs, RLS, Storage, submit | Engineer B | Approved data model and form-definition versioning; local Supabase test stack. |
| Voice, transcription, question planner, evidence capture | Engineer C | Turn/evidence contracts, versioned 38-node graph, server-side eligibility rules, provider credentials isolated to trusted server runtime. |
| Scaffold/config/shared contracts | Anupam | Coordinate contract freeze; preserve existing workspace and Supabase changes. |

Existing worktree changes are substantial and predate this audit; preserve them. Re-read Git status before implementation and do not overwrite or revert unrelated work.

## P0 - Blocking

### P0.1 - Establish a navigable mobile shell and auth/profile gate

1. Add the approved navigation framework/routes and route guards.
2. Keep invited-driver sign-in, session restore, visible auth errors, and password reset in one flow.
3. Load the signed-in driver's own profile; no self-signup or client-controlled organization/role.
4. Add Profile confirmation and Home entry using the approved seeded identity.

**Owner:** Engineer A. **Backend dependency:** profiles query and existing Auth.
**Acceptance:** invalid credentials stay on login; valid invited test driver reaches profile/home; no production account used.

### P0.2 - Verify and complete secure persistence locally

1. Start only the isolated JebelDAL local Supabase stack after approval; do not target the hosted project.
2. Run the existing 53-assertion pgTAP suite and the local submit smoke script.
3. Add negative tests for unknown field keys, invalid JSON value types/options, archived pinned definitions, and missing user-file metadata writes.
4. Fix definition-aware `save_incident_answer` validation and form-definition read policy before client integrations.
5. Add or reconcile `organization_master_data` against the approved architecture.

**Owner:** Engineer B. **Breaking API change:** none needed if validation is added behind existing RPC payloads; confirm any grant/schema addition before migration.
**Acceptance:** local cross-user/cross-organization/Storage checks pass; no hosted push.

### P0.3 - Seed the authoritative form and question graph

1. Version and validate the 38 nodes and 17 documented expressions from the workbook.
2. Resolve the 16 question-expression plus photo-screen count interpretation explicitly.
3. Add all Auto/GL/WC field definitions and options, answer types, eligibility and deterministic completion rules.
4. Keep model output advisory; authored wording, requiredness, form activation, safety ordering, and completion remain deterministic.

**Owner:** Engineer B (definition storage), Engineer A (rendering), Engineer C (planner).
**Acceptance:** definition schema/count tests; full branch matrix and branch-boundary tests.

## P1 - Core MVP

### P1.1 - Incident draft/list/resume

- Wire Home/File report to `create_incident_draft`.
- Implement owner-scoped Drafts/Submitted list and detail queries.
- Save/reopen draft answers using revision versions, AsyncStorage cache, retry state, and rehydration.
- Ensure hidden branch answers are preserved for drafts but excluded from active submitted projection.

### P1.2 - Interview and provider operations

- Implement text turns first; persist `begin_incident_turn`, then call processing.
- Implement audio capture with three-minute limit, private upload, Groq transcription, OpenAI structured proposals, evidence quotes/confidence, and visible retry.
- Implement eligible-question selection from deterministic rules; validate model selection and visibly fall back to the first eligible authored question.
- Add unit/integration tests for all 38 nodes/17 rules, unknown/declined states, edit/back, and no fixed question cap.

### P1.3 - Confirm, evidence, review, submit, history

- Add confirm-details editing with optional GPS and manual fallback.
- Implement photo guidance, standard camera/library flow, upload state/retry, and private Storage authorization; no live camera overlay.
- Render approved field definitions and source labels; validate required data/evidence server-side.
- Integrate OS-local biometric/passcode and submit only after success; preserve the design boundary that this UI confirmation is not a legal signature or server attestation.
- Show Submitted · awaiting review, report reference, read-only detail, and idempotent retries.

### P1.4 - User-file operations

- Add an owner/org-checked user-file metadata create/finalize path before enabling driver-files Storage uploads.
- Test unauthorized users, pending replacement, object MIME/size, and ownership.

## P2 - UX parity and optional scope

- Align mockup labels/options with workbook; fix identity fixture mismatch.
- Resolve Forgot password, document OCR/expiry copy, Photos live overlay, list statuses/counts, and root icon hit target.
- Add accessibility labels, keyboard/viewport checks, transcript replay feedback, and error/loading/empty states.
- Keep Spanish, 3D diagram, video, photo coaching, documents/OCR, and other Should/Could features behind approved priorities; do not delay core submit flow.

## Recommended first implementation batch

After approval, start with **P0.1 + P0.2 in parallel**: Engineer A builds auth/profile/home/incidents route skeleton against the existing contracts; Engineer B runs and strengthens the isolated local RLS/persistence tests and fixes the confirmed schema-validation gaps. Do not connect real provider calls or submit hosted data until the local contracts pass. P0.3 is the shared dependency before a full interview integration.

