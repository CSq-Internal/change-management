# Change Management System — Developer Docs

This document describes the current state of the Change Management System project: architecture, folder layout, important files, and how things fit together.

## 1) High-Level Overview

Goal: Build an ISO 27001-compliant Change Management System for internal use, enabling secure workflows for requesting, approving, implementing, and auditing changes.

Current status (v0.1.0 — Prototype with UX + auth scaffolding):
- Next.js (App Router, TypeScript, Tailwind) application with a full shell (top nav, sidebar, breadcrumbs).
- In-memory state management using Zustand for UX prototyping.
- Change request form modeled after the CSquared Technical Change Request document.
- Mock authentication (email/password + Google SSO stub), logout, and password change UI.
- User management (admin-only) with onboarding wizard, teams, and permissions.
- Preferences for theme (system/light/dark), language (en/fr/sw), and font size.
- Approver configuration with defaults + request quick-pick.
- Teams can store plan summaries and attachment metadata.
- Prisma schema/config added; API route wired; still no production database in use.

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
   │  ├─ layout.tsx              — Root layout (AppShell)
   │  ├─ globals.css             — Global Tailwind styles
   │  ├─ page.tsx                — Live dashboard metrics + activity
   │  ├─ login/page.tsx          — Login screen (email/password + Google SSO stub)
   │  └─ (dashboard)/            — Feature pages (route group)
   │     ├─ requests/page.tsx    — Create and list change requests
   │     ├─ approvals/page.tsx   — Approve/Reject pending requests
   │     ├─ changes/page.tsx     — View and update change statuses
   │     └─ audits/page.tsx      — Audit evidence (JSON dump)
   │     ├─ users/page.tsx       — Admin-only user onboarding wizard
   │     ├─ teams/page.tsx       — Admin-only teams management
   │     └─ settings/            — Settings pages
   │        ├─ profile/page.tsx
   │        ├─ preferences/page.tsx
   │        ├─ approvers/page.tsx
   │        ├─ notifications/page.tsx
   │        ├─ security/page.tsx
   │        └─ integrations/page.tsx
   ├─ components/
   │  ├─ app-shell.tsx           — Global shell, navigation, preferences, auth guard
   │  └─ ui/                     — UI primitives (button/card/input/textarea/toaster)
   └─ lib/
      ├─ types.ts                — Domain types and interfaces
      ├─ store.ts                — Zustand store (auth, prefs, in-memory state)
      └─ i18n.ts                 — Localization strings and helper
```

## 3) Domain Model

Defined in `src/lib/types.ts`:
- Enums/Types
  - `Role`: 'requester' | 'approver' | 'auditor' | 'admin'
  - `ChangeStatus`: 'draft' | 'pending' | 'approved' | 'rejected' | 'implemented' | 'verified' | 'closed'
  - `RiskLevel`: 'low' | 'medium' | 'high'
  - `ChangeCategory`: 'config' | 'infrastructure' | 'software' | 'process'
  - `Permission`: 'admin' | 'read' | 'write' | 'approve' | 'audit'
  - `Country`: Ghana | Uganda | Mauritius | Liberia | Togo
- Interfaces
  - `ChangeRequest`: Core entity with id, title, description, requester, assignees, riskLevel, status, category, dates, backoutPlan, approvals array, and auditTrail array.
  - `AppUser`: In-memory user entity with role, permissions, country, and password.
  - `Team`: Team container for routing and assignments (includes plan summary + attachment metadata).

The audit trail and approvals are embedded arrays for simplicity in the current in-memory implementation.

## 4) State Management

- `src/lib/store.ts` uses Zustand to manage in-memory `ChangeRequest`, `AppUser`, and `Team` state.
- Functions: `add` (create new request), `update` (patch existing request), `addUser`, `addTeam`, auth (`login`, `loginWithGoogle`, `logout`), `updatePassword`.
- Preferences in state: `theme`, `language`, `fontScale`.
- Approver defaults in state: `defaultApproverIds`.
- No persistence — data resets on app restart. Intended for UX validation.

## 5) UI Layer (App Router)

- `src/app/layout.tsx`: Wraps all routes in `AppShell` and loads global styles.
- `src/components/app-shell.tsx`: App chrome (top nav + sidebar + breadcrumbs), preferences modal, auth guard, profile menu, and logout.
- `src/app/page.tsx`: Live dashboard with metrics, activity feed, and quick actions.
- `(dashboard)/requests/page.tsx`: Full technical change request wizard-like form and "My Requests".
- `(dashboard)/approvals/page.tsx`: Approver queue with approve/reject toasts.
- `(dashboard)/changes/page.tsx`: Change lifecycle updates with toasts.
- `(dashboard)/audits/page.tsx`: Audit evidence view (JSON).
- `(dashboard)/users/page.tsx`: Admin-only onboarding wizard with default password + OpCo assignment.
- `(dashboard)/teams/page.tsx`: Admin-only teams management (plan summary + attachments).
- `(dashboard)/settings/*`: Profile, preferences, notifications, security, integrations.
- `(dashboard)/settings/approvers/page.tsx`: Default approver configuration for requests.
- `src/app/login/page.tsx`: Login UI (email/password + Google SSO stub).

All pages are client-side ("use client") and interact directly with the Zustand store.

## 6) Configuration & Environment

- `next.config.ts` includes `allowedDevOrigins` for localtunnel usage.
- `prisma.config.ts` and `prisma/schema.prisma` exist for Prisma 7 tooling.
- Tailwind configured via `postcss.config.mjs` and `tailwindcss` in devDeps.
- ESLint uses Next.js preset for code quality.

## 7) Development

- Install: `npm install`
- Run: `npm run dev` (starts Next.js dev server at http://localhost:3000)
- Build: `npm run build` (runs `prisma generate` via `prebuild`)
- Lint: `npm run lint`

## 8) Roadmap & Future Enhancements

- **Persistence**: Wire Prisma + Postgres (adapter or Accelerate) for real storage.
- **Authentication**: Replace mock auth with production SSO (Google Workspace).
- **RBAC**: Enforce permissions in server routes and middleware.
- **Audit Trails**: Make audit logging append-only and queryable.
- **API Routes**: Add POST/PUT endpoints for CRUD operations on changes.
- **Attachments**: Support file uploads for change documentation.
- **Notifications**: Email/Slack alerts for status changes.
- **Exports**: CSV/PDF reports for audits.
- **Testing**: Add unit/integration tests with Jest/Cypress.
- **CI/CD**: Lint, type-check, and test on push/PR.

This is a foundational stub — deployable for demos but designed for iterative extension toward full ISO 27001 compliance.
  - `npx prisma migrate dev --name init` to create initial migration

## 9) Security & ISO 27001 Considerations (Planned)

- Authentication: Replace mock auth with Google Workspace SSO
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
- Mock auth is used for UX only; do not treat as production security.
