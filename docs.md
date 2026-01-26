# Change Management System — Developer Docs

This document describes the current state of the Change Management System project: architecture, folder layout, important files, and how things fit together.

## 1) High-Level Overview

Goal: Build an ISO 27001-compliant Change Management System for internal use, enabling secure workflows for requesting, approving, implementing, and auditing changes.

Current status (v0.1.0 — Minimal Stub):
- Next.js (App Router, TypeScript, Tailwind) application with basic UI pages.
- In-memory state management using Zustand for prototyping UX.
- Core domain types defined for ChangeRequest, roles, statuses, etc.
- No persistence, authentication, or API routes yet — focused on UI scaffolding.
- Ready for extension with Prisma (database), NextAuth (auth), and role-based access control.

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
└─ src/
   ├─ app/                       — Next.js App Router
   │  ├─ layout.tsx              — Root layout (HTML shell, header/footer)
   │  ├─ globals.css             — Global Tailwind styles
   │  ├─ page.tsx                — Home dashboard with navigation tiles
   │  └─ (dashboard)/            — Feature pages (route group)
   │     ├─ requests/page.tsx    — Create and list change requests
   │     ├─ approvals/page.tsx   — Approve/Reject pending requests
   │     ├─ changes/page.tsx     — View and update change statuses
   │     └─ audits/page.tsx      — Audit evidence (JSON dump)
   └─ lib/
      ├─ types.ts                — Domain types and interfaces
      └─ store.ts                — Zustand store (in-memory state)
```

## 3) Domain Model

Defined in `src/lib/types.ts`:
- Enums/Types
  - `Role`: 'requester' | 'approver' | 'auditor' | 'admin'
  - `ChangeStatus`: 'draft' | 'pending' | 'approved' | 'rejected' | 'implemented' | 'verified' | 'closed'
  - `RiskLevel`: 'low' | 'medium' | 'high'
  - `ChangeCategory`: 'config' | 'infrastructure' | 'software' | 'process'
- Interfaces
  - `ChangeRequest`: Core entity with id, title, description, requester, assignees, riskLevel, status, category, dates, backoutPlan, approvals array, and auditTrail array.

The audit trail and approvals are embedded arrays for simplicity in the current in-memory implementation.

## 4) State Management

- `src/lib/store.ts` uses Zustand to manage an in-memory array of `ChangeRequest` objects.
- Functions: `add` (create new request), `update` (patch existing request).
- No persistence — data resets on app restart. Intended as a prototype for UX validation.

## 5) UI Layer (App Router)

- `src/app/layout.tsx`: Provides the HTML structure, header ("CSquared • Change Management"), and footer. Includes global styles and a subtle background gradient.
- `src/app/page.tsx`: Dashboard home page with animated tiles linking to /requests, /approvals, /changes, /audits. Uses Framer Motion for animations.
- `(dashboard)/requests/page.tsx`: Form to submit new requests (title, description). Lists all requests with status and timestamps.
- `(dashboard)/approvals/page.tsx`: Displays pending requests with Approve/Reject buttons.
- `(dashboard)/changes/page.tsx`: Lists all changes with buttons to update status (Implemented, Verified, Closed).
- `(dashboard)/audits/page.tsx`: Placeholder for audit evidence — currently dumps changes as JSON.

All pages are client-side ("use client") and interact directly with the Zustand store.

## 6) Configuration & Environment

- No environment variables required yet (in-memory only).
- Tailwind configured via `postcss.config.mjs` and `tailwindcss` in devDeps.
- ESLint uses Next.js preset for code quality.

## 7) Development

- Install: `npm install`
- Run: `npm run dev` (starts Next.js dev server at http://localhost:3000)
- Build: `npm run build`
- Lint: `npm run lint`

## 8) Roadmap & Future Enhancements

- **Persistence**: Integrate Prisma with PostgreSQL for database storage. Migrate store to server-side with API routes.
- **Authentication**: Add NextAuth with Google OAuth/SSO for user login.
- **RBAC**: Implement role-based access control (e.g., only approvers can approve).
- **Audit Trails**: Enhance audit logging with immutable records.
- **API Routes**: Add POST/PUT endpoints for CRUD operations on changes.
- **Attachments**: Support file uploads for change documentation.
- **Notifications**: Email/Slack alerts for status changes.
- **Exports**: CSV/PDF reports for audits.
- **Testing**: Add unit/integration tests with Jest/Cypress.
- **CI/CD**: Lint, type-check, and test on push/PR.

This is a foundational stub — deployable for demos but designed for iterative extension toward full ISO 27001 compliance.
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

