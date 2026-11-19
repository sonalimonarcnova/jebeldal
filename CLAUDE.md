# CLAUDE.md — JebelDAL Voice-to-Form Assistant

Read this file fully before any task. Then read the task's section in `docs/sprint-plan.md`.

## Product in one line
A truck driver taps "File an incident report", talks about what happened, answers only the follow-ups the app still needs, adds photos, checks the filled Auto / General Liability / Workers' Comp forms and submits. Driver-only app. Tagline: "Don't fill out a form. Just tell us what happened."

## Sources of truth (in this order)
1. `docs/sprint-plan.md` — current scope, owners, decisions D-23+ (overrides older docs where they conflict).
2. `docs/JebelAI_User_Stories (1).xlsx` — stories (ST-xx), Question Bank (38 questions, 17 branches), Decisions (D-01..D-22).
3. `design/mockups/*.png` — UI source of truth (layout, copy, components).
4. `docs/architecture.md`, `docs/mvp-user-flows-and-requirements.md` — background design; simplified by D-23..D-30.

## Demo data (never change without the lead)
- Organization: Northwind Freight. Driver: **Marcus Reyes**, `marcus.reyes@northwindfreight.com`, employee NW-20417, Austin TX terminal.
- Vehicle: **Unit 4471 · TX 8KLM-221**, Freightliner Cascadia.
- All data is fictional.

## Repo layout
```
apps/mobile/                     Expo app (Expo Router, TypeScript, React Native Paper)
  app/                           routes (see Routes)
  src/theme/                     tokens.ts — ONLY place colours/spacing/radius/type live
  src/components/                shared UI (QuestionCard, OptionList, MicButton, …)
  src/features/<feature>/        hooks + screen logic
  src/lib/                       supabase client, api client, storage helpers
supabase/
  migrations/                    SQL only; new file per change, never edit a pushed one
  functions/_shared/engine/      PURE TypeScript form engine (no imports except relative .ts files)
  functions/_shared/             cors, zod contracts, supabase/admin clients
  functions/<name>/index.ts      Edge Functions
scripts/                         seed scripts (run with node / npx tsx)
design/mockups/                  mockup screenshots named per the workbook Mockup Map
docs/                            plan, architecture, stories
```

## Routes (apps/mobile/app)
```
(auth)/login.tsx
(onboarding)/profile.tsx
(tabs)/_layout.tsx  (tabs)/home.tsx  (tabs)/incidents.tsx  (tabs)/files.tsx (placeholder)
report/[revisionId]/interview.tsx
report/[revisionId]/confirm.tsx
report/[revisionId]/photos.tsx
report/[revisionId]/review.tsx
report/[revisionId]/done.tsx
```

## Form engine rules (the core of the product)
- Forms and questions are DATA in `supabase/functions/_shared/engine/graph.ts` and `forms.ts`, also seeded into `form_definitions`. No question- or form-specific `if` statements anywhere else.
- The engine is pure TS, shared by the app (import via Metro watchFolders) and Edge Functions (Deno). Keep `.ts` extensions on relative imports. No npm/URL imports inside `engine/`.
- Answers are stored once per question key: `incident_answers.form_key = 'interview'`, `field_key = <question key>`. Auto/GL/WC fields are views over answers + derived data.
- The engine decides: visible questions (`showIf`), next question, progress, active forms, missing required fields, severity, DOT recordable, drug-test rule, photo shot list. The LLM never decides any of these.
- The LLM only: transcribes (Groq), extracts values for known question keys with an exact evidence quote and confidence, maps spoken answers to options, writes the per-form description.
- Never re-ask a question that already has a confirmed answer. Never overwrite an answer whose source is `edited` or `tap`.
- `injuries` is a safety question: it cannot be skipped silently (needs an option or "Not sure").

## Answer model (shared contract)
```ts
type AnswerState = 'confirmed' | 'unknown' | 'declined' | 'not_applicable' | 'skipped';
type AnswerSource = 'derived' | 'voice' | 'typed' | 'tap' | 'photo' | 'edited';
type Answer = { key: string; value: string | string[] | null; state: AnswerState; source: AnswerSource;
                confidence?: number; evidenceQuote?: string; turnId?: string };
type Answers = Record<string, Answer>;
```

## UI rules
- Before building a screen, open its mockup in `design/mockups/`. Match layout, copy, components, spacing.
- Use only tokens from `src/theme/tokens.ts`. No hard-coded colours or font sizes in components.
- Tap targets ≥ 48dp; primary buttons ≥ 56dp tall. Secondary text must meet WCAG AA (use `colors.textSecondary`, not lighter greys).
- Screens without a mockup (loading, empty, error, permission denied, success, filled forms) reuse the nearest mocked components.
- If a mockup conflicts with these rules or the brief, keep the rule, and note the difference in the PR description.

## Security rules
- Provider keys (GROQ_API_KEY, OPENAI_API_KEY, SUPABASE_SERVICE_ROLE_KEY) exist only in Edge Functions / scripts via Infisical or `supabase secrets`. Never in the app, never in git, never in logs.
- The app uses only `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- RLS on every table. Status, signature and submission changes happen only in `submit-incident`.
- Don't log transcripts, audio or full payloads; log ids, status, latency, error code.

## Commands
```
npm run mobile:install          npm run mobile:start:infisical:dev
npm run mobile:typecheck        npm test            (root: vitest for engine + contracts)
npx supabase functions serve --env-file supabase/functions/.env     (local)
npm run supabase:functions:deploy                                   (hosted, lead/backend only)
npx tsx scripts/seed-forms.ts   node scripts/seed-hosted-dev-accounts.mjs   (via infisical run)
```

## Definition of done (every task)
1. `npm run mobile:typecheck` passes with zero errors.
2. Unit tests for any engine / rule / contract change pass (`npm test` at repo root).
3. Edge Function changes: the curl scripts in `scripts/curl/` for that function return the documented response.
4. UI changes: run on Expo web AND Expo Go on a phone; compare with the mockup; list remaining differences in the PR.
5. No new hard-coded colours, no secrets, no `any` without a comment.
6. Branch `feat/<area>-<short>`; PR into `main` with: what changed, story IDs (ST-xx), how it was tested, screenshots.

## Working style for Claude Code
- Small, verifiable steps. After each step run the checks above; fix before moving on.
- If a contract in this file or `docs/sprint-plan.md` must change, stop and say so in the PR — don't silently diverge.
- Prefer deleting scope over shipping something half-working on the critical path:
  login → Home → File a report → interview (voice) → confirm → photos → review → sign & submit → Incidents shows "Submitted · awaiting review".
