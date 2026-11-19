# 06 - Database, RLS, and Storage Audit

Audit date: 2026-11-19

## Evidence legend

**SOURCE** = migration/seed/test code; **TEST** = test definition or executed test; **MOBILE** = client runtime; **INFERRED** = static concern; **BLOCKED** = not runtime-verified; **MISSING** = absent.

This is a repository-only audit. No SQL was run against hosted Supabase, no local database was started/reset, and no data was read or changed. Docker was unavailable, so pgTAP was not executed.

## Requested-table inventory

| Table | Exists in migrations? | RLS / access evidence | Seed / contract status |
|---|---|---|---|
| `organizations` | Yes, initial scaffold | RLS enabled; authenticated select scoped through current organization. | Fictional organization seed. |
| `organization_master_data` | **No** | No policy can be evaluated. | **MISSING** relative to architecture's described master-data table. |
| `profiles` | Yes | RLS enabled; own-row select; update grant limited to display name, phone, preferred language. | Seeded profile contract; mobile does not read/update it. |
| `vehicles` | Yes | RLS enabled; organization-scoped select; composite organization FK. | Two fictional vehicles in seed. |
| `policies` | Yes, persistence migration | RLS enabled; organization-scoped select. | Fictional policy seed. |
| `trip_records` | Yes, persistence migration | RLS enabled; driver and organization scoped select. | Schema exists; no trip fixture was found in the viewed seed. |
| `user_files` | Yes, persistence migration | RLS enabled; own-user/org select. No authenticated table insert/update grant or write RPC was found. | **MISSING write path** for setup documents/walk-around photos. |
| `form_definitions` | Yes | RLS enabled; authenticated select policy only permits `status = 'active'`. | Three minimal version-1 forms; not the workbook graph/full forms. |
| `form_sets` | Yes | RLS enabled; authenticated select policy uses `true`. | Default set references Auto/GL/WC; activation rules have migration/fallback logic. |
| `incidents` | Yes | RLS enabled; own reporter/organization select; direct mutations revoked in the persistence migration. | `create_incident_draft` RPC creates rows. |
| `incident_revisions` | Yes | RLS enabled; owner-scoped select; direct writes revoked. | Version, status, location, snapshot columns present. |
| `incident_revision_forms` | Yes, persistence migration | RLS enabled; owner-scoped select. | Stores pinned form version and triggered/not-triggered state. |
| `conversation_turns` | Yes | RLS enabled; owner-scoped select; direct writes revoked in final migration. | Unique client-turn ID/sequence; audio evidence/language/input hash added. |
| `incident_answer_groups` | Yes | RLS enabled; owner-scoped select; final writes through RPC. | Unique position per form/group; group RPC exists. |
| `incident_answers` | Yes | RLS enabled; owner-scoped select; direct writes revoked in final migration. | Partial unique indexes handle scalar NULL group and repeated-group answers. |
| `evidence` | Yes | RLS enabled; own uploader/org select; final direct writes revoked. | Pending/uploaded/failed metadata and finalize RPC. |
| `signatures` | Yes | RLS enabled; signer/owner-scoped select; final direct writes revoked. | Confirmation reference, revision version and report reference added. |

## RLS and grants

- **SOURCE**: Both migrations enable RLS on the exposed application tables. The persistence migration revokes table-wide privileges from `anon` and `authenticated`, then grants authenticated read access; selected profile columns are updateable.
- **SOURCE**: Draft, answer, details, group, turn, evidence and submit RPCs are granted to authenticated and revoke `PUBLIC`/`anon` execution. Mutating functions use `SECURITY DEFINER`, empty `search_path`, and owner/status/version checks in their bodies.
- **SOURCE**: `current_organization_id()` returns an organization only for a driver profile. Policies scope incidents to the reporter and organization; turn/answer/revision policies use ownership relationships.
- **SOURCE**: The second migration replaces initial Storage policies with owner-aware `incident-evidence` policies, adds private `driver-files`, and applies user/org checks through `user_files`.
- **TEST definition**: `engineer_b_backend_test.sql` declares 53 pgTAP assertions covering direct-write denial, same-organization and cross-organization incident reads, evidence access, hidden branch projection, stale versions, idempotent turns/submission, required fields/evidence, and repeated groups.
- **BLOCKED**: These properties were not executed against a local or hosted PostgreSQL instance; there is no live RLS result in this report.

## Confirmed gaps and concerns

### DB-01 - Archived form definitions are not readable to authenticated clients

- **SOURCE**: The initial `form_definitions` select policy uses `status = 'active'`.
- **SOURCE**: Revision recomputation and submit lookup accept both `active` and `archived`, indicating that archived versions may remain pinned to revisions.
- **INFERRED, P1**: A driver reopening an older draft may be unable to select its archived, pinned definition through PostgREST. Keep access version-aware/owner-safe while preserving immutability; validate with an RLS test before changing policy.

### DB-02 - Answer values are not checked against the pinned field schema

- **SOURCE**: `save_incident_answer` checks owner, draft state, version, form row, group/evidence references, answer-state/source enums, and non-empty field key. It does not call `private.find_field` to require the field in the pinned definition or validate JSON type, enum/options, or field constraints.
- **SOURCE**: Submit verifies required-field presence/state and evidence but does not validate every supplied answer against a field type/options schema.
- **INFERRED, P1**: Invalid values or unknown field keys can be persisted and may enter the submitted projection. Add server-side definition-aware validation and focused negative tests; do not rely on client validation.

### DB-03 - Profile-file write path cannot be completed by an authenticated client

- **SOURCE**: `user_files` has an own-user/org SELECT policy; final table grants do not permit authenticated insert/update. `storage_driver_files_insert` requires a matching pending/failed `user_files` row, but no RPC/function creates that row.
- **INFERRED, P1**: CDL/medical/registration/insurance/walk-around upload flows cannot start through the documented authenticated client contract.

### DB-04 - Required master-data table is absent

- **SOURCE**: No `organization_master_data` table or references were found in migrations/seed. The architecture lists it as a data model table.
- **MISSING, P1**: Either implement the approved table/seed/RLS contract or reconcile the architecture and avoid depending on it.

### DB-05 - Turn-result RPC trusts caller-provided transcript/proposals

- **SOURCE**: `record_incident_turn_result` is executable by authenticated users and stores caller-supplied transcript/proposals for an owned draft; no provider identity/signature is checked.
- **INFERRED, P1 integrity**: This does not grant cross-user access and proposals are not canonical answers, but the transcript/proposal record is not proof of provider output. Keep it explicitly advisory and test that only driver-confirmed answers affect rules/submission; consider a trusted server-only result path if provider provenance is required.

## Storage and evidence

- **SOURCE**: Both buckets are created with `public = false` and a 50 MiB limit. Incident evidence metadata uses organization/revision/evidence IDs in the object path.
- **SOURCE**: Evidence finalize checks Storage object metadata, exact byte size, permitted MIME family, uploader, and draft state. Tests describe owner-only access and prohibit replacing uploaded evidence after completion.
- **BLOCKED**: Bucket existence, live Storage grants, signed-URL authorization, and actual upload behavior are unverified because no database/Storage instance was queried.

## Seed coverage

- **SOURCE**: `seed.sql` inserts 3 form definitions and a form set. The Auto fixture declares six keys; GL and WC declare one each (8 declared field entries total).
- **MISSING**: No 38-node question graph, 17-rule set, complete form inventory, authored per-field answer types/options, 80%-field count, or `organization_master_data` data is seeded.
- **SOURCE**: The mockup claims 30 prefilled form fields, which is not supported by these minimal seeds.

