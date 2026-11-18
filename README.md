# JebelDAL

Voice-first incident reporting MVP.

## Project documentation

- [Development runbook](./docs/development-runbook.md) — local setup, external services, secrets, and team workflow.
- [MVP technical architecture](./docs/architecture.md)
- [MVP user flows and requirements](./docs/mvp-user-flows-and-requirements.md)

## Scaffolded project layout

- Mobile app: [`apps/mobile/`](./apps/mobile)
- Supabase backend: [`supabase/`](./supabase)

## Quick run (hosted Supabase + Infisical)

```bash
npm run mobile:install
npm run mobile:start:infisical:development
```