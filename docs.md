# Change Management System — Developer Docs (ISO 27001 track)

This document describes the current state of the project on the `feature/iso27001` branch: architecture, folder layout, important files, and how things fit together.

## 1) High-Level Overview

Goal: Build an ISO 27001‑compliant Change Management System for CSquared with strong authentication, RBAC, approvals workflow, and immutable audit trails.

Current status (v0 back‑end foundations):
- Next.js (App Router, TypeScript, Tailwind) scaffold with initial UI pages
- In‑memory demo store for UX scaffolding (Zustand)
- Prisma ORM set up with PostgreSQL datasource
- Core domain models designed (User, ChangeRequest, Approval, AuditLog, Attachment, UserAssignment)
- Minimal API route: `GET /api/changes` to list change requests
- `.env.example` prepared for DB + future NextAuth/Google OAuth
- Draft PR created to merge these foundations into `main`

## 2) Project Structure

```
change-management-system/
├─ README.md                     — Project intro, run instructions, roadmap
├─ docs.md                       — This file (developer documentation)
├─ package.json                  — Dependencies and scripts
├─ tsconfig.json                 — TypeScript config
├─ next.config.ts                — Next.js configuration
├─ postcss.config.mjs            — PostCSS/Tailwind config
├─ eslint.config.mjs             — ESLint config (Next preset)
├─ public/                       — Static assets
├─ src/
│  ├─ app/                       — Next.js App Router
│  │  ├─ layout.tsx              — Root layout (HTML shell)
│  │  ├─ globals.css             — Global Tailwind styles
│  │  ├─ page.tsx                — Home (dashboard shell + nav)
│  │  └─ (dashboard)/            — Feature pages
│  │     ├─ requests/page.tsx    — Create/list change requests (demo in-memory)
│  │     ├─ approvals/page.tsx   — Approve/Reject pending requests (demo)
│  │     ├─ changes/page.tsx     — Change log & status transitions (demo)
│  │     └─ audits/page.tsx      — Audit evidence view (JSON dump for now)
│  ├─ lib/
│  │  ├─ types.ts                — Domain types (ChangeRequest, statuses, etc.)
│  │  └─ store.ts                — Zustand store (in‑memory demo state)
│  └─ server/
│     └─ db.ts                   — Prisma client singleton
├─ prisma/
│  └─ schema.prisma              — Prisma schema (models/enums, Postgres)
└─ src/app/api/
   └─ changes/route.ts           — API route: list changes (Prisma)
```

## 3) Domain Model (Prisma)

Defined in `prisma/schema.prisma`:
- Enums
  - `RiskLevel`: low | medium | high
  - `ChangeStatus`: draft | pending | approved | rejected | implemented | verified | closed
  - `Role`: requester | approver | auditor | admin
- Models
  - `User` — basic identity/role; relations to requests, approvals, audits
  - `ChangeRequest` — core entity with category, risk, status, plans, audit trail
  - `UserAssignment` — many‑to‑many link for assignees on a change
  - `Approval` — decision records (approve/reject) with comment and timestamp
  - `AuditLog` — immutable audit events (action, note, actor, timestamp)
  - `Attachment` — metadata for files stored in object storage (S3/GCS)

Datasource uses `DATABASE_URL` from environment. Client generated via `@prisma/client`.

## 4) Server/DB

- `src/server/db.ts` creates a singleton `PrismaClient` with minimal logging, reusing the instance in dev to avoid hot‑reload leaks.
- Pending: migrations and connection bootstrap (`npx prisma migrate dev`).

## 5) API Layer

- `src/app/api/changes/route.ts` (GET): Returns change requests ordered by `updatedAt`, including approvals and attachments. This is an initial stub to validate server wiring; POST/PUT endpoints will be added for submit/approve/reject/transition.

## 6) UI Layer (App Router)

- `src/app/page.tsx`: Dashboard shell with navigation to feature pages.
- `(dashboard)/requests/page.tsx`: Simple form to add a new request into the in‑memory store and list existing requests.
- `(dashboard)/approvals/page.tsx`: Shows pending requests; approve/reject buttons update state.
- `(dashboard)/changes/page.tsx`: Displays all changes; buttons to mark implemented/verified/closed (demo state).
- `(dashboard)/audits/page.tsx`: Shows raw JSON of changes as a placeholder for exportable audit evidence.

These pages currently use the in‑memory store (`src/lib/store.ts`) as a UX prototype. They will be migrated to server actions/API backed by Postgres/Prisma, and guarded by RBAC.

## 7) Configuration & Environment

- `.env.example`
  - `DATABASE_URL` — Postgres connection string
  - `NEXTAUTH_URL`, `NEXTAUTH_SECRET` — for planned NextAuth integration
  - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — for Google Workspace OAuth
- Copy to `.env` and fill values locally. (Do not commit real secrets.)

## 8) Development

- Install: `npm install`
- Run: `npm run dev` (http://localhost:3000)
- Prisma tooling:
  - `npx prisma generate` after schema changes
  - `npx prisma migrate dev --name init` to create initial migration

## 9) Security & ISO 27001 Considerations (Planned)

- Authentication: NextAuth with Google Workspace SSO
- RBAC middleware: enforce requester/approver/auditor/admin across routes
- Audit logging: append‑only audit events for all state changes
- Approvals workflow: strict transitions with multi‑level approvals as policy
- Attachments: store in S3/GCS with signed URLs; metadata in DB
- Logging/monitoring: structured logs, request IDs, rate limiting
- CI: lint, type‑check, test; dependency audit; Prisma migrate validation
- Hardening: pin GitHub Actions by commit SHA; secret scanning; least‑privilege IAM for storage

## 10) Roadmap

1. Add Postgres (Docker) + Prisma migrations; seed minimal data
2. Implement server actions/API for create/approve/reject/transition with audit
3. Introduce NextAuth (Google) + role mapping
4. Add RBAC enforcement in middleware and route handlers
5. Implement attachments via S3/GCS + presigned upload
6. CI workflow (lint/type/test) and container build; deploy target TBD
7. Reporting/exports for audits (CSV/PDF), change calendar, notifications

## 11) Notes

- The in‑memory store is temporary for prototyping UI/UX. Data will be persisted via Prisma.
- Please review the draft PR for discussion: coding standards, RBAC policy, and data retention.

