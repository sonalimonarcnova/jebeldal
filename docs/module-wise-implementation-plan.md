# JebelDAL Module-wise Parallel Implementation Plan

## Objective

Create a clear, parallel execution plan where **Anupam** completes initial scaffolding and three engineers execute independent modules in parallel with minimal blocking.

## Ownership split

### 1) Anupam — Platform Scaffolding Module

**Scope**
- Set up base project scaffold (Expo + TypeScript + folder structure).
- Initialize Supabase local project structure (config, migrations, seeds baseline).
- Define shared contracts (API payload types, response shapes, env templates).
- Add baseline engineering workflow (lint/test scripts, CI starter, PR conventions).
- Publish integration contracts for all modules.

**Deliverables**
- Repository is runnable locally by all engineers.
- Shared contracts are frozen for module development.
- Local development setup is documented and reproducible.

---

### 2) Engineer A — Mobile App Flow & Forms Module

**Scope**
- Implement app navigation and screens: Auth, Profile, Home, Incidents.
- Build report draft creation and resume workflow.
- Implement dynamic form renderer (typed controls + safe fallback text input).
- Build Confirm Details, Review, and Submitted status screens.

**Deliverables**
- Driver can complete UI flow from login to review/submitted.
- Screens consume shared contracts without schema drift.

---

### 3) Engineer B — Backend, Data & Security Module

**Scope**
- Implement database schema for incidents, turns, answers, and evidence metadata.
- Implement persistence APIs for create/save/resume/report retrieval.
- Implement RLS and access controls so drivers only access their own data.
- Implement submission endpoint with deterministic required-field/evidence validation.
- Implement idempotent submission behavior.

**Deliverables**
- Secure persistence and retrieval for draft-to-submitted lifecycle.
- Submission is validated, consistent, and duplicate-safe.

---

### 4) Engineer C — Voice, AI & Evidence Module

**Scope**
- Implement voice recording and transcription pipeline integration.
- Implement AI field proposal extraction with confidence/provenance metadata.
- Implement question planner integration constrained to eligible deterministic questions.
- Implement incident photo evidence upload with retry/failure handling.

**Deliverables**
- Voice/text answers convert into structured proposals safely.
- Evidence flow is reliable and recoverable under failure/retry.

## Parallel execution rules

- **Rule 1:** Scaffolding/contracts freeze first; module work starts immediately after freeze.
- **Rule 2:** All three engineers develop in parallel using shared contracts.
- **Rule 3:** Daily 15-minute sync only for interface or dependency changes.
- **Rule 4:** Prioritize Must-flow completion before optional enhancements.
- **Rule 5:** Any contract change requires owner alignment and same-day communication.

## Suggested execution sequence

1. **Day 0 / Start:** Anupam completes scaffolding + contract baseline.
2. **Parallel Start:** Engineer A, B, C begin their modules together.
3. **Midpoint Integration:** Connect modules on stable APIs and shared test scenarios.
4. **Stabilization:** Fix integration issues, finalize MVP Must-flow readiness.

## Success criteria

- All engineers can run the project locally with shared setup.
- End-to-end driver flow works: login → draft → interview inputs → review → submit.
- Backend enforces access control, validation, and idempotent submission.
- Voice/AI/evidence modules integrate without breaking deterministic workflow rules.
