# 05 - API and Backend Inventory

Audit date: 2026-11-19

## Evidence legend

**SOURCE** = repository code/docs; **MOBILE** = emulator/client runtime; **TEST** = automated test source/run; **MOCKUP** = rendered prototype; **INFERRED** = static finding not executed; **BLOCKED** = not exercised; **MISSING** = absent.

No Supabase hosted project queries, writes, function calls, deployments, or configuration changes were made. API status below is based on source and local contract documentation only.

## Operation inventory

| Operation | Method / source | Auth and request | Response / validation | Status and mobile caller | Tests |
|---|---|---|---|---|---|
| Auth/session | `supabase.auth.signInWithPassword` in `apps/mobile/App.tsx` | Supabase Auth; email/password | Error is stored for display; session restored with `getSession`; changes observed with `onAuthStateChange`. No password-reset call. | **SOURCE implemented as scaffold**; current app session view was **MOBILE observed**. No auth test or reset screen. | TypeScript only. |
| Profile load/update | PostgREST is described in runbook; RLS on `profiles` | Signed-in driver JWT; owner row | Profile fields/roster source should be loaded; client has no query or update implementation. | **MISSING mobile integration**. | None found. |
| `create_incident_draft` | `POST /rest/v1/rpc/create_incident_draft`; SQL in persistence migration | Authenticated driver; `p_form_set_key`, version, language; server derives owner/org | Returns revision UUID; creates incident/revision and form rows. Checks driver role, language/version, known form set. | **SOURCE implemented**; no mobile caller. | 53-assertion pgTAP file includes create draft. |
| `save_incident_answer` | `POST /rest/v1/rpc/save_incident_answer`; SQL RPC | Authenticated owner; revision/version, form/field, optional group/value/state/source/evidence | Returns next revision version; checks draft, version, owner, form row, group/evidence references. Does not verify field exists in pinned definition or validate value type/options. | **SOURCE implemented with validation gap**; no mobile caller. | pgTAP covers upsert, stale version, branches, hidden-answer projection. |
| `save_incident_details` | `POST /rest/v1/rpc/save_incident_details`; SQL RPC | Authenticated owner; revision/version, occurred time, optional location object | Returns next version; checks object shape/size, draft, owner, expected version. | **SOURCE implemented**; no mobile caller. | No focused test identified. |
| `create_incident_answer_group` | `POST /rest/v1/rpc/create_incident_answer_group`; SQL RPC | Authenticated owner; revision/version, form/group key, position | Returns group UUID; validates group key non-empty and form row exists, but not group key against form definition. | **SOURCE implemented with definition-validation gap**; no mobile caller. | pgTAP covers repeated group requirements. |
| `begin_incident_turn` | `POST /rest/v1/rpc/begin_incident_turn`; SQL RPC | Authenticated owner; stable client turn ID and exactly one text/audio reference, language | Returns persisted turn/status/transcript/proposals/error; checks length, ownership, draft state, uploaded audio, and input hash reuse. | **SOURCE implemented**; no mobile caller. | pgTAP covers same-ID retry and changed-input conflict. |
| `record_incident_turn_result` | `POST /rest/v1/rpc/record_incident_turn_result`; SQL RPC | Authenticated owner; turn/revision IDs, status, transcript/proposals/error | Returns persisted turn; checks owner/draft/status shape. The caller-supplied result is not independently authenticated as provider output. | **SOURCE implemented**; no mobile/Edge Function caller. Result provenance must remain advisory. | No provider tests. |
| `process-incident-turn` | `POST /functions/v1/process-incident-turn`; `supabase/functions/process-incident-turn/index.ts` | Zod body schema accepts revision UUID, client turn ID, exactly one text/audio ID. | Always responds HTTP 501 `NOT_IMPLEMENTED` after schema validation. No Groq/OpenAI call, DB persistence, or provider error flow. | **MISSING implementation**; no mobile caller. | No function tests found. |
| `select-next-question` | `POST /functions/v1/select-next-question`; function source | Zod validates revision UUID only. | Always responds HTTP 501 `NOT_IMPLEMENTED`; no eligibility recomputation, model choice, authored prompt, or fallback. | **MISSING implementation**; no mobile caller. | No function tests found. |
| `create_incident_evidence` | `POST /rest/v1/rpc/create_incident_evidence`; SQL RPC | Authenticated owner; revision, media type, byte size, optional description | Returns evidence ID/path/pending status/version; caps media and size. | **SOURCE implemented**; no mobile upload caller. | pgTAP tests evidence creation and storage ownership. |
| Storage upload/finalize | Private `incident-evidence` bucket; `finalize_incident_evidence` RPC | Authenticated owner; exact path from RPC | Private Storage policies; finalize checks object existence, MIME family/allowlist, exact size, draft status, then marks uploaded. | **SOURCE implemented**; no client code. | pgTAP tests same-user/other-user/cross-org reads and post-submit replacement. |
| User files | `user_files` plus private `driver-files` bucket | Expected profile owner/organization | Migration grants authenticated `SELECT` only on public tables; Storage insert policy requires a matching `user_files` row, but no client insert grant/RPC creates one. | **MISSING write operation**; no mobile caller. | No user-file upload tests. |
| Submit | `POST /functions/v1/submit-incident`; function calls `POST /rest/v1/rpc/submit_incident` | Bearer JWT; revision/version, UUID signature reference, auth method, device description. Function checks `/auth/v1/user`; RPC checks driver/profile/ownership. | Maps stable errors; SQL validates required fields/evidence, locks revision/incident, creates signature and immutable snapshot, returns report reference/status, handles same-reference retry. | **SOURCE implemented**; no mobile caller or native authentication implementation. | pgTAP includes validation, stale/retry, and signature-reference cases. Local PowerShell smoke script checks concurrent/idempotent submit but was not run. |
| List/detail/resume | Authenticated PostgREST reads per runbook | Driver JWT and owner RLS | Tables are documented for list/detail; no actual mobile query, sorting/pagination, or rehydrate flow. | **SOURCE contract only**; mobile caller **MISSING**. | RLS tests assert other-driver reads return empty. |

## Contract alignment and blockers

- **SOURCE**: Persistence operation names and payload intent are documented in [development-runbook.md](../development-runbook.md) and [architecture.md](../architecture.md).
- **SOURCE**: `submit-incident` is the only non-stub Edge Function. It authenticates a bearer token, validates its request, checks the user endpoint, then forwards the same user JWT to the submit RPC.
- **MISSING**: The mobile source does not call any draft, answer, turn, evidence, list/detail, or submit API.
- **MISSING**: The two voice/planner Edge Functions are 501 stubs, so the documented voice-to-form and bounded question-selection contracts are not implemented.
- **INFERRED**: Arbitrary field keys and JSON values can be stored through `save_incident_answer`; submission checks required presence/state but does not schema-validate all supplied answer values.
- **BLOCKED**: All hosted behavior/auth/RLS/function deployment status remains unverified. Only local source and test definitions were inspected.

