---
name: code-review
description: Review code changes in the JebelDAL repository for concrete bugs, regressions, and mismatches with the project architecture. Use when asked to review code, a diff, or a pull request, or explicitly invoked with /code-review.
---

# JebelDAL Code Review

Review the requested changes for correctness and project fit. Keep reviews focused: report only actionable issues introduced by the changes, and do not turn a code review into a general audit or redesign.

## Project context

- The mobile client is Expo, React Native, and TypeScript in `apps/mobile/`.
- The backend is Supabase: Postgres migrations, RLS, Storage, and Edge Functions in `supabase/`.
- Read `docs/architecture.md` and `docs/mvp-user-flows-and-requirements.md` when they clarify behavior affected by the changes.
- Preserve the MVP priority: a reliable driver incident-reporting flow from capture through review and submission.
- Business rules determine eligible fields, questions, and submission requirements. AI may propose facts or select from eligible questions, but must not invent facts, overwrite driver-confirmed values, or replace deterministic rules.

## Review steps

1. Identify the requested scope. For a diff or pull request, inspect its changed files and relevant surrounding code. If no diff is specified, use the current working-tree changes; do not assume a branch or target.
2. Trace affected callers and behavior far enough to verify likely failure cases. Check validation, error paths, state transitions, and compatibility with existing flows as relevant.
3. Apply only the project checks that fit the change. The mobile type check is `npm run mobile:typecheck`; run relevant tests or other checks if available. Do not claim a check passed unless it was run successfully.
4. Report confirmed, actionable defects only. Do not report style preferences, speculative risks, unrelated pre-existing issues, or issues already prevented by existing safeguards.
5. Do not edit code, commit, push, merge, or publish a GitHub review unless explicitly asked.

## Project-specific checks

When relevant to the changed code:

- **Mobile:** preserve TypeScript safety and existing Expo/React Native patterns; handle loading, empty, error, and success states in user-facing flows.
- **Supabase data access:** verify RLS and organization/user isolation for exposed data and Storage. Never rely on client-side checks as authorization.
- **Migrations:** consider existing data, constraints, grants, and whether the change is safe to apply in order. Avoid proposing hosted changes during review.
- **Edge Functions:** validate request data at the boundary, enforce authorization, handle provider and database failures explicitly, and avoid returning secrets or logging raw audio, transcripts, or complete report payloads.
- **Incident workflow:** preserve idempotency and valid state transitions; only confirmed facts should drive deterministic rules and submission completeness.

## Findings and response

Lead with findings, ordered by severity. For each finding include:

- **Severity:** High, Medium, or Low.
- **Location:** exact file and line in the changed code.
- **Problem:** the concrete failure scenario and its impact.
- **Fix:** the smallest useful correction.

Only include a severity when an issue is confirmed. If there are no findings, say so plainly. End with the checks run and their results, or note that no checks were run. Keep the summary brief and distinguish review findings from optional suggestions.
