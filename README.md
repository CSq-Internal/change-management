# Change Management System (ISO Internal)

Next.js app for internal change control: submit requests, approve, implement, and audit. This is a minimal stub you can deploy and extend.

## Tech
- Next.js (App Router, TS)
- TailwindCSS
- Zustand state store (in-memory for now)
- Zod ready for schema validation

## Run
```bash
npm install
npm run dev
```

## Roadmap
- Auth (NextAuth, SSO)
- Persistence (Postgres + Prisma) with full audit trails
- Role-based access control
- Exportable audit reports (CSV/PDF)
- Notifications (email/Slack)
- CI (lint, type-check, test)
