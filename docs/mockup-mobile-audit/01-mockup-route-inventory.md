# 01 - Mockup Route Inventory

Audit date: 2026-11-19

## Evidence legend

- **MOCKUP**: rendered and observed in the authenticated browser prototype.
- **MOBILE**: observed on the Android emulator running JebelDAL in Expo Go.
- **SOURCE**: confirmed in repository files or the story workbook.
- **TEST**: exercised by an automated check.
- **INFERRED**: likely from source or UI, but not confirmed at runtime.
- **BLOCKED**: intentionally not exercised or unavailable.
- **MISSING**: no corresponding implementation was found.

The Cloudflare Access page initially blocked the mockup. The user completed the authorized login in the browser; the mockup then rendered at the requested URL. All 13 paths in its route map were visited. The common browser title was **M3 Mobile Mockups - JebelAI**.

## Route inventory

| # | Screen | Exact mockup URL | Mockup evidence | Visible content and controls | Navigation observed | Mobile route/component |
|---:|---|---|---|---|---|---|
| 1 | Phone home | `https://jebelai.devaccellabs.com/mobile` | [phone-home-launch-control.png](./evidence/mockup/phone-home-launch-control.png) (control crop) | Simulated phone home, date, terminal, app icons, JebelAI icon. | JebelAI icon click was intercepted by the dock overlay. Direct `/mobile/login` navigation works. | **MISSING** as a phone-home route; Expo root is [App.tsx](../../apps/mobile/App.tsx). |
| 2 | Login | `https://jebelai.devaccellabs.com/mobile/login` | [login-heading.png](./evidence/mockup/login-heading.png) (heading crop; full image withheld because the page contains a realistic email placeholder) | Work email, password, Show password, Forgot password, Sign in, Sign in with Face ID, invite-only copy. | Invalid reserved-domain credentials advanced to Profile. Forgot password produced no visible change. | **PARTIAL** auth shell in [App.tsx](../../apps/mobile/App.tsx); no login route or reset-password UI. |
| 3 | Profile | `https://jebelai.devaccellabs.com/mobile/profile` | [profile-heading.png](./evidence/mockup/profile-heading.png) (heading crop; identity fields withheld) | Full name, mobile, employee ID, home terminal, assigned unit, English/Espanol, Looks right. | Looks right -> Face setup. | **MISSING**. |
| 4 | Facial recognition / Face ID setup | `https://jebelai.devaccellabs.com/mobile/face` | [face-setup.png](./evidence/mockup/face-setup.png) | Setup explainer, Start scan, Not now. | Not now -> Documents. Start scan was not used because it could request camera/device access. | **MISSING**; no local-auth dependency or route. |
| 5 | Documents | `https://jebelai.devaccellabs.com/mobile/documents` | [documents.png](./evidence/mockup/documents.png) | Four document slots (CDL, medical card, vehicle registration, insurance card), Skip, Continue 0/4. Copy promises date reading and expiry heads-up. | Skip -> Truck photos. File selection was not opened. | **MISSING**; table/bucket exist in SQL, but no mobile caller or user-file write grant/RPC. |
| 6 | Truck walk-around | `https://jebelai.devaccellabs.com/mobile/truck-photos` | [truck-photos.png](./evidence/mockup/truck-photos.png), [truck-photo-camera.png](./evidence/mockup/truck-photo-camera.png) | Front, Driver side, Rear, Passenger side; timestamp/GPS claim; simulated camera overlay and Take photo. | Front opened a simulated camera screen; Close camera and Skip returned to Home. Capture was not used. | **MISSING**; no camera/media dependency or route. |
| 7 | Home | `https://jebelai.devaccellabs.com/mobile/home` | [home-start-report-control.png](./evidence/mockup/home-start-report-control.png) (control crop; full screen withheld because it contains personal-looking trip/profile data) | Setup checklist, score, route/pre-trip demo data, quick actions for report/document/truck photos. | File an incident report -> Interview at Question 5 of 14. Files and Incidents bottom navigation work. | **MISSING**. |
| 8 | Files | `https://jebelai.devaccellabs.com/mobile/files` | [files-documents.png](./evidence/mockup/files-documents.png), [files-photos.png](./evidence/mockup/files-photos.png) | Documents and Photos tabs; four document slots; walk-around photo states showed missing. Retake links to Truck photos. | Bottom navigation to Home/Incidents; Photos tab switches content. | **MISSING**; no mobile reads/uploads. |
| 9 | Incidents | `https://jebelai.devaccellabs.com/mobile/incidents` | [incidents-tabs.png](./evidence/mockup/incidents-tabs.png) (tabs crop; report list withheld because it contains personal-looking names and locations) | File a report; Drafts (4), Submitted (13); cards. Header said 13 open. Submitted samples showed manager/supervisor approval and insurance statuses. | Draft card returned to a generic interview state. Submitted card opened a Filled carrier forms sheet with Forms and Question flow tabs. | **MISSING**; incident/RLS schema exists but no mobile screen or query. |
| 10 | Interview | `https://jebelai.devaccellabs.com/mobile/interview` | [interview-initial.png](./evidence/mockup/interview-initial.png), [interview-type-modal.png](./evidence/mockup/interview-type-modal.png), [interview-involved.png](./evidence/mockup/interview-involved.png), [interview-weather.png](./evidence/mockup/interview-weather.png), [interview-listening.png](./evidence/mockup/interview-listening.png), [interview-injuries.png](./evidence/mockup/interview-injuries.png), [interview-injury-location.png](./evidence/mockup/interview-injury-location.png), [interview-injury-kind.png](./evidence/mockup/interview-injury-kind.png), [interview-injury-followup.png](./evidence/mockup/interview-injury-followup.png) | Single question, section progress, Back/Next, Hear it again, microphone simulation, Type, Skip, option buttons and quick replies. | Home button returned to Incidents. Branch counts changed as answers changed. A text response was accepted and advanced. | **MISSING**; no mobile interview component or form graph. |
| 11 | Confirm details | `https://jebelai.devaccellabs.com/mobile/confirm` | [confirm-action.png](./evidence/mockup/confirm-action.png) (action crop; detail values withheld) | Editable driver, truck/plate, date/time, location rows; map attribution/GPS badge; Yes, that's right. | Tapping Date and time navigated to `/mobile/interview?field=when&back=confirm`. | **MISSING**; `save_incident_details` exists but has no caller. |
| 12 | Photos & videos | `https://jebelai.devaccellabs.com/mobile/photos` | [photos-live-overlay.png](./evidence/mockup/photos-live-overlay.png) | Back, Next, LIVE overlay, AI-style Truck/Road feedback, sample image, Remove, Choose from library, Take photo or video. | Next -> Review & sign. Camera/library buttons were not activated. | **MISSING**; evidence RPC/storage policies exist but no mobile capture/upload. |
| 13 | Review & sign | `https://jebelai.devaccellabs.com/mobile/review` | [review-heading.png](./evidence/mockup/review-heading.png), [review-submit-disabled.png](./evidence/mockup/review-submit-disabled.png) (element crops; report details withheld) | Editable answer rows, Photos & videos, "30 form fields filled for you", confirmation/tap-to-sign, Submit for review. | Submit was disabled before tapping sign; tap-to-sign immediately displayed a Signed state and enabled Submit. Submit was not clicked. | **MISSING**; submit RPC/function exists, but no mobile review/signature UI or call. |

## Additional surfaces

- **MOCKUP**: the submitted-report detail is a bottom sheet, not a separately listed route. It has Forms and Question flow tabs.
- **MOCKUP**: the date/time edit path uses `/mobile/interview?field=when&back=confirm`.
- **MISSING**: no route for a post-submit success/reference screen or a filled-form screen is in the route map.
- **BLOCKED**: full-page screenshots of profile, home, incident cards, confirm details, and review were not retained because the prototype contains realistic personal-looking identity, trip, report, and contact values. Element crops and non-sensitive screen captures are retained instead.

