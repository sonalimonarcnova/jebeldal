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
| Face ID `/mobile/face` | Home setup action | `app/(driver)/home.tsx` | **SOURCE implemented; runtime unverified** | Device-local authentication, AsyncStorage setup flag | Runs local device authentication; no biometric data is uploaded. |
| Documents `/mobile/documents` | `/(driver)/files` | `app/(driver)/files.tsx`, `src/features/files/repository.ts` | **SOURCE implemented; runtime unverified** | `user_files`, `driver-files`, `create_user_file`, `finalize_user_file` | Uploads PDFs through the existing owner-checked RPC and private bucket flow; no OCR or expiry alerts. |
| Truck photos `/mobile/truck-photos` | `/(driver)/files` | `app/(driver)/files.tsx`, `src/features/files/repository.ts` | **SOURCE implemented; runtime unverified** | `user_files`, `driver-files`, Expo Image Picker, file RPCs | Captures JPEG/PNG/WebP walk-around photos for four vehicle views. |
| Home `/mobile/home` | `/(driver)/home` | `app/(driver)/home.tsx`, `src/features/home/repository.ts`, `src/features/files/repository.ts` | **PARTIAL; runtime unverified** | `trip_records`, `user_files`, signed-in profile | Loads latest trip, setup progress, and starts incident drafts; document/photo actions open Files. Driving score remains labeled demo data. |
| Files `/mobile/files` | `/(driver)/files` | `app/(driver)/files.tsx`, `src/features/files/repository.ts` | **SOURCE implemented; runtime unverified** | Owner-scoped `user_files` and private Storage | Lists private files, supports PDF and walk-around uploads, retries failed uploads, and opens files with short-lived signed URLs. |
| Incidents `/mobile/incidents` | `/(driver)/incidents` | `app/(driver)/incidents.tsx`, `src/features/incidents/repository.ts` | **PARTIAL; runtime unverified** | `incidents`, active revisions, answers, revision forms, draft RPC | Loads Drafts/Submitted lists, creates drafts, and resumes drafts. No submitted-report detail view. |
| Interview `/mobile/interview` | `/incident/[revisionId]` | `app/incident/[revisionId].tsx`, `src/features/incidents/repository.ts` | **PARTIAL; runtime unverified** | Pinned form definitions, answer query, `save_incident_answer` RPC, AsyncStorage | Supports tabbed pinned forms, saved/unsaved counts, validation, repeated groups, answer history, and direct edit navigation; no question graph, branching interview, or voice transcription. |
| Confirm `/mobile/confirm` | Shared `/incident/[revisionId]` details section | `app/incident/[revisionId].tsx`, `src/features/incidents/repository.ts` | **PARTIAL; runtime unverified** | `save_incident_details`, Expo Location | Confirms local date/time and supports GPS or manual location entry. GPS is optional and failures retain the manual-entry path; no standalone confirm route. |
| Photos `/mobile/photos` | Shared `/incident/[revisionId]` evidence section | `app/incident/[revisionId].tsx`, `src/features/incidents/repository.ts` | **PARTIAL; runtime unverified** | Camera permission, scoped Expo Document Picker, Storage, finalize RPC | Supports camera capture and user-selected JPEG/PNG/WebP files with existing private upload/retry state; the system picker grants access only to selected files. No video or standalone photos route. |
| Review `/mobile/review` | Shared `/incident/[revisionId]` review modal | `app/incident/[revisionId].tsx`, `src/features/incidents/repository.ts` | **PARTIAL; runtime unverified** | Saved answers, evidence, submit readiness and device-auth flow | Full-screen saved-answer review with edit jumps, evidence status, unsaved-edit warnings, and the existing gated submit action; no standalone review route. |

## Screen counts

- **MOCKUP**: 13 mapped routes visited.
- **SOURCE**: Expo Router now has auth, driver, Files, and incident-revision routes; Home, Files, incident list, profile, and narrative draft routes have implementations.
- **MISSING**: Question-graph interview/voice transcription and submitted-report detail are not implemented. Confirm, Photos, and Review are sections of the shared incident revision screen rather than standalone routes.
- **BLOCKED**: The emulator restored a session and reached the driver-profile gate, but the hosted schema error prevents Home; no successful on-device Home screenshot was captured.
- **SOURCE**: A post-submit success/filled-form screen is not in the mockup route map. No separate mobile implementation exists.

## Navigation and persistence

- **MOCKUP**: bottom tabs navigate Home/Files/Incidents; a draft card returned to a generic interview state. The earlier selected draft's answers were not visible, but this does not prove backend data loss.
- **SOURCE**: Expo Router has guarded Home/Files/Incidents tabs; Profile remains accessible from the Home avatar. Draft creation and resume use incident revision IDs; text edits are cached locally and server saves use optimistic revision versions.
- **MISSING**: Full answer-graph recovery, interrupted voice-turn recovery, evidence upload retry, and post-submit history/detail are not implemented.
- **BLOCKED**: Auth, RLS, cache recovery, and revision-conflict behavior have not been tested against a running local Supabase stack or on the emulator.

