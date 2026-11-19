# 02 - Complete UI Interaction Inventory

Audit date: 2026-11-19

## Evidence legend

**MOCKUP** = live rendered prototype; **MOBILE** = emulator; **SOURCE** = repository/workbook; **TEST** = automated check; **INFERRED** = not runtime-proven; **BLOCKED** = not exercised; **MISSING** = absent.

The audit recorded **54 successful UI action interactions** in the mockup. Some controls (Back, Done, Skip) were exercised on different screens, so this is an interaction count, not a count of unique component implementations. Two additional attempted actions were blocked: Next was disabled after a single-select auto-advanced, and the Phone home JebelAI icon was intercepted by the dock. A selector-based attempt to open the route dropdown timed out; the same dropdown was subsequently opened successfully through browser automation.

## Interaction log

| Area / control | Action | Result | Evidence / limitation |
|---|---|---|---|
| Cloudflare Access | User completed login manually. | **MOCKUP** route became accessible at the requested URL. No bypass was used. | Initial sign-in page was observed. |
| Mockup route selector | Opened selector. | Options: Web Page, Module 1, Module 2, Module 3, Admin, M3 Mobile Mockups. M3 was selected. | Other product/module destinations were not opened. |
| Phone home JebelAI icon | Attempted normal click. | **BLOCKED**: dock subtree intercepted the pointer. No forced click was used. | `phone-home-launch-control.png`. |
| Login email/password | Entered `audit.invalid@example.invalid` and a deliberately invalid password; clicked Sign in. | **MOCKUP DEFECT**: spinner ended at Profile instead of showing an authentication error. This was mockup-only test input, not a hosted app login. | `login-heading.png`; screenshot intentionally omits the email field. |
| Forgot password | Clicked. | No route, form, alert, or visible state change. | **MOCKUP DEFECT**. |
| Home - File an incident report | Clicked. | Started Interview at Question 5 of 14. | `home-start-report-control.png`. |
| Profile | Clicked Looks right. | Advanced to Face setup. Profile had editable name/mobile/employee/terminal/unit fields and English/Espanol buttons. | PII values were not retained in evidence. |
| Face setup | Clicked Not now. | Advanced to Documents. Start scan was not clicked because it could request device/camera access. | `face-setup.png`. |
| Documents | Clicked Skip. | Advanced to Truck photos. Continue showed 0 of 4. File slots were not opened; no local file was selected. | `documents.png`. |
| Truck photos | Clicked Front, then Close camera, then Skip. | Opened a simulated camera overlay; no photo was taken and no device permission was granted. Skip returned to Home with 0/4. | `truck-photos.png`, `truck-photo-camera.png`. |
| Files | Clicked Photos tab. | Displayed a four-view walk-around list with all photos missing; Retake links to Truck photos. | `files-documents.png`, `files-photos.png`. |
| Incidents | Clicked Drafts and Submitted tabs. | Drafts displayed four cards; Submitted displayed thirteen. The Submitted cards contained other sample names and approval/insurance states. | `incidents-tabs.png`; card screenshots withheld. |
| Incident card | Opened a draft card. | Returned to an interview state at Question 6 of 14 with no visible answer narrative from the previously tested answer. **Persistence is not proven**; this behavior is a concern, not a confirmed backend data-loss defect. | Live route observation. |
| Incident card detail | Opened a submitted card; selected Question flow. | Opened a Filled carrier forms bottom sheet with Forms/Question flow tabs. The question-flow sheet headings were visible. Details were not captured because the underlying report contained personal-looking sample data. | **MOCKUP** surface; no mobile route equivalent. |
| Interview Type | Opened Type, filled a fictional training-yard narrative, then Send. | Send enabled; after loading, advanced to What else was involved. | `interview-type-modal.png`, `interview-initial.png`. |
| Involved multi-select | Selected A building, fence, or object, clicked Done, then Back. | Progress changed from 14 to 18; Back restored the selection. | `interview-involved.png`. |
| Earlier answer edit | Toggled the object off, selected Another vehicle, clicked Done. | Progress changed to 17 and trip question followed. This confirms local back/edit state in the prototype only. | **MOCKUP**; refresh/restart persistence not tested. |
| Trip and weather | Selected Dispatched load; selected Clear and Done. | Trip auto-advanced to weather; Clear displayed as Clear sky and advanced to the other-vehicle follow-up. Weather options included Heavy traffic, not listed in the workbook cell. | `interview-weather.png`. Next was disabled after the auto-advance. |
| Voice answer | Clicked Tap to answer and Tap when done. | Showed Listening and a canned partial transcript, then a completed canned transcript and advanced to Who was driving it. No browser/device microphone was used. | `interview-listening.png`. |
| Other driver | Clicked They drove off. | Advanced to Was anyone hurt? | **MOCKUP**. |
| Injury Skip | Clicked Skip on Was anyone hurt? | Advanced directly to seatbelt without a confirmation or explicit unknown state. | **MOCKUP DEFECT**; `interview-injuries.png`. |
| Injury branch | Back, selected Yes, me; selected Yes for seatbelt. | Progress expanded from 17 to 24 and showed Workers' comp/Auto follow-ups. | **MOCKUP**. |
| Injury location/type/activity/cause | Selected Left foot, Sore or strained, Loading or unloading, Cargo or a pallet. | Reached body diagram, multi-select injury type, activity, and cause screens. Several labels/options differ from the workbook. | `interview-injury-location.png`, `interview-injury-kind.png`. |
| Treatment branch | Selected Emergency room; skipped Where were you treated?; selected No on the next prompt. | Progress expanded to 26. The ER follow-up wording did not match the workbook's hospital admission question; Skip moved to an unrelated finger/toe/eye prompt. | **MOCKUP DEFECT**. |
| Hear it again | Clicked on an injury prompt. | Changed to Reading...; actual audio playback was not verified. | **MOCKUP**, not physical-device audio. |
| Interview Home / Close | Clicked Home and Close in separate flows. | Home returned to Incidents; Close returned to Incidents. | Navigation behavior observed. |
| Confirm details | Clicked the Date and time row. | Routed to `/mobile/interview?field=when&back=confirm`, showing When did it happen?; no value was changed. | `confirm-action.png`. |
| Photos & videos | Clicked Next. | Advanced to Review & sign. | `photos-live-overlay.png`. |
| Review and sign | Checked Submit for review disabled; clicked Tap to sign; checked again. | Submit changed from disabled to enabled; a Signed label appeared immediately without a biometric/passcode prompt. Submit itself was **not** clicked. | `review-heading.png`, `review-submit-disabled.png`; personal report details were not stored. |

## Not exercised or blocked

- **BLOCKED**: document upload/file picker, photo/video library, actual camera capture, microphone permissions, and GPS/device permissions. No user files or device permissions were granted.
- **BLOCKED**: Submit for review; no mock report was submitted.
- **BLOCKED**: Face scan and any native authentication/signature prompt.
- **NOT TESTED**: refresh/restart persistence, real upload retry, offline behavior, transcription, AI extraction, server question planning, Spanish, all authored branches, and real success/history behavior.
- **NOT TESTED**: every option/control on every question. The route and interaction table records what was exercised; it does not claim exhaustive option-level coverage.

