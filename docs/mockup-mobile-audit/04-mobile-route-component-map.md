# 04 - Mobile Route and Component Map

Audit date: 2026-11-19

## Evidence legend

**MOCKUP** = live prototype; **MOBILE** = emulator runtime; **SOURCE** = code; **TEST** = automated; **INFERRED** = not runtime-proven; **BLOCKED** = not exercised; **MISSING** = absent.

## Actual mobile app structure

- **MOBILE (prior audit)**: Pixel_10_Pro emulator (`emulator-5554`) ran JebelDAL inside Expo Go; the observed UI was the earlier auth scaffold. The implementation below was added after that observation and has not been exercised on the emulator.
- **SOURCE**: Expo Router now provides root, auth, driver-tab, and incident-revision routes. `AuthProvider` restores Supabase sessions, loads the signed-in profile, and exposes sign-in/sign-out/profile-confirmation operations.
- **SOURCE**: Mobile callers now load the driver profile and assigned vehicle, load the latest trip, list owner-visible incidents and their active revisions, create drafts, load the pinned Auto form's narrative field, and save answers through the existing RPC.
- **SOURCE**: Incident narrative text is cached in AsyncStorage by user, revision, and field; the server revision version is checked before restoring the cached text.
- **SOURCE**: No direct mobile dependencies for audio capture, image picking/camera, or local authentication are present in `apps/mobile/package.json`.
- **AUTH diagnosis**: The emulator's previous bundle targeted `10.0.2.2:55421`, the local Supabase endpoint, which was unreachable. The Infisical `dev` bundle now contains the documented hosted project URL and excludes the local URL; ADB can resolve and ping that host.
- **BLOCKED**: The hosted Auth password grant succeeds, but the emulator cannot complete profile loading because the hosted `profiles` schema lacks `employee_id` and `profile_completed_at`. These columns are present in checked-in migrations but not the hosted schema.
- **BLOCKED**: The Android emulator MCP currently fails its protocol initialization handshake. ADB can load the Expo bundle, but stable visual/runtime verification was interrupted by an Android system/Play Store not-responding dialog.
- **BLOCKED**: The emulator showed a nearby-device permission prompt while opening the Expo Go project. It was denied; no camera, microphone, location, or other permission was granted.

## Route-to-component map

| Mockup screen/path | Mobile route in Expo | Mobile component/source | UI status | Data source / backend dependency | Notes |
|---|---|---|---|---|---|
| Phone home `/mobile` | None | `App.tsx` only | **MISSING** | None | Simulated phone home; JebelAI icon click was intercepted by dock. |
| Login `/mobile/login` | `/(auth)/sign-in` | `app/(auth)/sign-in.tsx`, `src/auth/AuthProvider.tsx` | **AUTH verified against hosted dev; emulator flow partial** | Supabase Auth client | Seeded driver password grant returns a session. The prior emulator bundle used the local-only endpoint; the dev startup command now injects Infisical `dev`. |
| Profile `/mobile/profile` | `/(driver)/profile`; confirmation at `/(auth)/profile` | `app/(driver)/profile.tsx`, `app/(auth)/profile.tsx`, `src/auth/profileRepository.ts` | **BLOCKED by hosted schema drift** | `profiles`, `vehicles`, `organizations`, `complete_driver_profile()` | Hosted profile query returns SQLSTATE `42703` for missing `employee_id`; `profile_completed_at` is also absent. The checked-in migration that adds them is not applied remotely. |
| Face ID `/mobile/face` | None | None | **MISSING** | Device-local authentication; no dependency | Start scan was not used. |
| Documents `/mobile/documents` | None | None | **MISSING** | `user_files`, `driver-files` bucket | SQL has metadata/read policy; user-file writes are unavailable to authenticated clients. |
| Truck photos `/mobile/truck-photos` | None | None | **MISSING** | `user_files`, `driver-files` bucket | No mobile camera/picker dependency or upload caller. |
| Home `/mobile/home` | `/(driver)/home` | `app/(driver)/home.tsx`, `src/features/home/repository.ts` | **PARTIAL; runtime unverified** | `trip_records`, signed-in profile | Loads latest trip and supports create-report and incidents navigation. Score remains labeled demo data; setup checklist and other mockup actions are not implemented. |
| Files `/mobile/files` | None | None | **MISSING** | `user_files`/Storage; no client query | Photo/document tabs only in mockup. |
| Incidents `/mobile/incidents` | `/(driver)/incidents` | `app/(driver)/incidents.tsx`, `src/features/incidents/repository.ts` | **PARTIAL; runtime unverified** | `incidents`, active revisions, answers, revision forms, draft RPC | Loads Drafts/Submitted lists, creates drafts, and resumes drafts. No submitted-report detail view. |
| Interview `/mobile/interview` | `/incident/[revisionId]` | `app/incident/[revisionId].tsx`, `src/features/incidents/repository.ts` | **PARTIAL; runtime unverified** | Pinned Auto form definition, answer query, `save_incident_answer` RPC, AsyncStorage | Supports one authored narrative text field and draft cache; no question graph, branching, voice, or full form renderer. |
| Confirm `/mobile/confirm` | None | None | **MISSING** | `save_incident_details` exists, no caller | Mockup editing routes into Interview. |
| Photos `/mobile/photos` | None | None | **MISSING** | `create_incident_evidence`, Storage, finalize RPC | No camera/picker or upload state UI. |
| Review `/mobile/review` | None | None | **MISSING** | `submit-incident` Edge Function/RPC; no caller | No device-auth integration or review component. |

## Screen counts

- **MOCKUP**: 13 mapped routes visited.
- **SOURCE**: Expo Router now has auth, driver, and incident-revision routes; the Home, incident list, profile, and narrative draft routes have implementations.
- **MISSING**: Face ID, documents, truck photos, Files, full interview, Confirm, Photos, Review, and submitted-report detail are not implemented.
- **BLOCKED**: The emulator restored a session and reached the driver-profile gate, but the hosted schema error prevents Home; no successful on-device Home screenshot was captured.
- **SOURCE**: A post-submit success/filled-form screen is not in the mockup route map. No separate mobile implementation exists.

## Navigation and persistence

- **MOCKUP**: bottom tabs navigate Home/Files/Incidents; a draft card returned to a generic interview state. The earlier selected draft's answers were not visible, but this does not prove backend data loss.
- **SOURCE**: Expo Router has guarded driver tabs and Home/Incidents/Profile navigation. Draft creation and resume use incident revision IDs; text edits are cached locally and server saves use optimistic revision versions.
- **MISSING**: Full answer-graph recovery, interrupted voice-turn recovery, evidence upload retry, and post-submit history/detail are not implemented.
- **BLOCKED**: Auth, RLS, cache recovery, and revision-conflict behavior have not been tested against a running local Supabase stack or on the emulator.

