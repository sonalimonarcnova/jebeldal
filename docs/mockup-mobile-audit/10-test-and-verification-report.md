# 10 - Test and Verification Report

Audit date: 2026-11-19

## Evidence legend

**MOCKUP** = browser prototype; **MOBILE** = emulator; **SOURCE** = source/config; **TEST** = automated test; **INFERRED** = static only; **BLOCKED** = not executed; **MISSING** = absent.

## Executive verification summary

| Measure | Result |
|---|---|
| Mockup routes visited | **13 / 13** mapped route paths |
| Common page title | `M3 Mobile Mockups - JebelAI` |
| Successful mockup UI interactions | **54** actions (some controls repeated in different screens) |
| Additional blocked interactions | **2**: phone-home icon intercepted; Next became disabled after single-select auto-advance |
| Interview questions in source | **38** workbook nodes |
| Distinct question-level branch expressions | **16**, plus one photo-screen shot-list condition = documented **17** total `show_if` expressions |
| Interview prompts reached in mockup | **16**; no full graph traversal |
| Branches fully verified | **0**; four behavior families were entered, with mismatches and/or incomplete branch coverage |
| Mobile route source status | Auth/profile, Home, Incidents, and narrative draft save/resume routes implemented; full interview and evidence/review flows remain missing |
| Seeded driver Auth | **PASS**: hosted password grant returns a session; JS client storage test restores the same user |
| Mobile runtime status | **PARTIAL/BLOCKED**: corrected dev bundle reached the profile gate; hosted profile query fails because columns from checked-in migrations are absent |
| Edge Functions | Submit function implemented; process turn and select question return 501 |
| Confirmed mockup discrepancies | **11** grouped issues in report 08; additional source gaps listed separately |
| Mobile focused tests | **13 passed** |
| Mobile typecheck | **PASS** |
| Expo web export | **PASS** |
| Database tests | 53 existing assertions and 14 Phase 1 assertions defined, **not run** |

## Tooling and environment

- **MOBILE**: ADB `C:\Users\sasmi\AppData\Local\Android\Sdk\platform-tools\adb.exe` reported `emulator-5554` as device; `adb -s emulator-5554 emu avd name` returned `Pixel_10_Pro`.
- **MOBILE**: Android emulator MCP tools available: Snapshot, ListDevices, Click, ClickBySelector, Type, Swipe, LongClick, Drag, Press, Wait/WaitForElement, Device. No dedicated `launch_app` tool is exposed.
- **MOBILE**: JebelDAL was opened through Expo Go's remembered project. Package shown in foreground is Expo Go (`host.exp.exponent`), not a standalone JebelDAL APK. Screen showed the scaffold and an existing session; no sign-in/sign-out/write action was performed.
- **MOBILE**: A nearby-device prompt from Expo Go was denied. No microphone, camera, or location permission was granted. Recent logcat search found no matching fatal/React Native exception lines.
- **SOURCE**: `.vscode/mcp.json` has Android emulator stdio and Supabase servers. User-level Chrome DevTools MCP was configured, but its Chrome remote-debug connection failed because no DevToolsActivePort was available. Integrated authenticated browser automation was used instead.
- **MOCKUP**: Cloudflare Access was completed by the user. No bypass was attempted.
- **SOURCE/TEST**: `npm run mobile:typecheck` completed successfully.
- **TEST**: `apps/mobile` `npm run typecheck` passed; `npm test` passed all 13 focused tests; `npx expo export --platform web` bundled successfully.
- **AUTH**: Infisical `dev` resolves to the documented hosted host `paitemheimctgiqarekt.supabase.co`. The seeded driver's password grant returned HTTP 200 in approximately 0.3–2.1 seconds with a session; no credentials or tokens were printed.
- **AUTH CONFIG**: Hosted Auth settings report `disable_signup=false`; the app has no sign-up route, but server-side self-sign-up is enabled. No hosted Auth configuration was changed.
- **MOBILE**: The prior bundle reported `fetch failed` for `10.0.2.2:55421`. Starting Expo with Infisical `dev` produced a bundle containing the hosted dev URL and excluding the local URL. ADB resolved and pinged the hosted endpoint; the app reached the profile gate.
- **BLOCKED**: Hosted profile reads fail with SQLSTATE `42703`: `employee_id` and `profile_completed_at` are absent. The checked-in migration adds both; no hosted migration was applied. Remote migration status is blocked because this network cannot reach the project's direct IPv6 DB endpoint; the `SUPABASE_DB_URL` secret is not a valid Postgres pooler URI.
- **MOBILE/BLOCKED**: Android MCP initialization failed. A Play Store/system ANR then prevented reliable emulator screenshots.
- **BLOCKED**: Docker Desktop engine was unavailable. The local Supabase stack was not started, reset, or queried; `supabase test db` and `scripts/test-local-submit.ps1` were not run.

## Existing automated coverage (source only)

`supabase/tests/engineer_b_backend_test.sql` declares `plan(53)` and covers:

- table privilege and direct lifecycle-write denial;
- owner and cross-organization incident isolation;
- draft versioning and stale-write rejection;
- answer upsert uniqueness and hidden-branch projection;
- turn idempotency/input-ID reuse;
- deterministic form activation;
- missing required fields/evidence;
- evidence MIME/size/finalize and user isolation;
- repeated-group requirements;
- submitted snapshot and duplicate-submit behavior.

The local PowerShell smoke script sends concurrent submit requests and checks retry idempotency. **Neither test artifact was executed**, so results are not pass/fail.

## Evidence files

- Mockup screenshots and safe element crops: [evidence/mockup/](./evidence/mockup/).
- Redacted emulator screenshot: [jebel-dal-current-screen.png](./evidence/mobile/jebel-dal-current-screen.png).
- Identity/report screenshots containing personal-looking sample fields were not retained. Route and interaction outcomes remain documented, but those screens lack independent full-page image evidence.

## Verification limitations

- The mockup's sample behavior is not proof of Expo, Supabase, Auth, RLS, Edge Function, Storage, AI-provider, or production behavior.
- No complete end-to-end journey, saved-draft restart, offline/retry path, actual capture/upload, real local authentication, or report submission was performed.
- All 38 question nodes and 17 documented `show_if` expressions were counted in the workbook, not verified in the mobile/backend runtime.
- Hosted Supabase schema/policies/data and function deployments were not queried. No hosted/shared/production service was changed.
- The signed-in emulator session existed before this audit; its sample account identifier was redacted from retained evidence.

## Overall result

The live mockup demonstrates partial navigation and selected text/vehicle/injury flows, but does not establish a completed driver journey. The seeded driver authenticates against the documented development Auth endpoint; the prior emulator failure was caused by a bundle targeting unreachable local Supabase at `10.0.2.2:55421`. Starting with Infisical `dev` fixes the bundle target. The next blocker is hosted schema drift: profile columns in the checked-in migration are missing, so Home cannot be reached. TypeScript, focused tests, and web bundling pass. Full interview, evidence, submission UI, and end-to-end verification remain outstanding.

