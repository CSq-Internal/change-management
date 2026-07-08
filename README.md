# CSquared Change Management System

An internal, ISO-aligned **change-control platform** for CSquared's network operations. Staff raise
change requests against infrastructure, route them through a governed approval chain (CAB +
per-infrastructure authority), implement them under segregation-of-duties controls, then verify and
audit — with a full, immutable trail. It is multi-tenant across **OpCos** (operating companies) and
bilingual (**English / French**).

**Live:** [cms.csquarednet.com](https://cms.csquarednet.com) — Google Cloud Run (`europe-west1`).

## Change lifecycle

```
draft → pending → approved  → implemented → verified → closed
                → rejected                            ↘ cancelled
```

Governance controls wrap that spine:

- **Approval routing by infrastructure type × OpCo** — approvers are computed per change, with a
  **Change Advisory Board (CAB)**, an **approval matrix**, per-OpCo **overrides**, and **delegations**
  when an approver is unavailable.
- **Segregation of duties** — named assignees split into `approver` and `implementer`; the same person
  cannot do both on one change.
- **Blackout periods** — changes are blocked during frozen windows.
- **Emergency / expedited path** — with retroactive (48h) review.
- **Post-Implementation Review (PIR)** and a standalone **systemic risk register**.
- **Immutable audit logs** (domain + admin), enforced and covered by dedicated tests.

## Features

- **Dashboard** — role-aware Monitor / Triage / Report views.
- **Requests & Changes** — guided request form (telecom fields: country, infra type, impact scope),
  scoped list views, change detail/edit, and a **calendar** with conflict detection and drag-to-reschedule.
- **Approvals** — approvals queue, approval matrix, CAB management, delegations.
- **Governance** — risk register, immutable audit trails, compliance **reports** (CSV + PDF evidence).
- **Administration** — users, teams, OpCos, and self-service **access requests**.
- **Notifications** — in-app feed + bell, preference matrix, email (Resend), and Google Chat webhooks;
  SLA-escalation cron.
- **Document uploads** backed by Google Drive (shared drive per OpCo).

## Tech & architecture

- **Next.js** (App Router, TypeScript) + **TailwindCSS** + **shadcn/ui**.
- **NextAuth v5** with a **Keycloak** OIDC provider (brokered Google SSO). Session enrichment attaches
  OpCo assignments and realm roles.
- **Prisma v7** with the `@prisma/adapter-pg` driver over **Postgres** (Cloud SQL in production, Neon in
  dev/local). All domain data lives in Postgres — **Zustand** holds UI-only preferences (language, theme,
  font scale).
- **Zod** for validation; **Resend** / nodemailer for email; **@react-pdf/renderer** for evidence PDFs;
  **@googleapis/drive** for document storage.

See [`CLAUDE.md`](CLAUDE.md) for a fuller architecture tour, and [`docs/`](docs/) for Keycloak, Google
Drive, and CI/CD setup guides.

## Local development

Requires Node 22+ and **pnpm** (`pnpm@11.4.0`; the project uses `pnpm-lock.yaml`, not npm).

```bash
pnpm install

# 1. Bring up local Keycloak + Postgres
docker compose -f docker/keycloak/docker-compose.yml up -d

# 2. Configure environment (fill in DATABASE_URL, Keycloak, etc.)
cp .env.example .env.local

# 3. Apply migrations and seed baseline data (OpCos, admin, ...)
pnpm prisma migrate dev
pnpm db:seed

# 4. Start the dev server
pnpm dev
```

The app requires a running database to function. Required environment variables are enumerated in
[`.env.example`](.env.example) (database, NextAuth, Keycloak, Resend, Google Drive, cron secret).

## Scripts

```bash
pnpm dev          # start dev server
pnpm build        # prisma generate + next build
pnpm start        # start production server
pnpm lint         # eslint
pnpm test         # vitest run (one-shot)
pnpm test:watch   # vitest watch mode
pnpm db:seed      # seed baseline data

pnpm tsc --noEmit # type-check without building
```

## Testing

Vitest (jsdom + React Testing Library). Coverage spans auth/enrichment, permissions, the server actions
(~20 suites: changes, approvals, CAB routing, approval matrix, assignees, blackout/authz, delegations,
notifications, chat webhooks, OpCos, teams, users-authz, risk register, reschedule, and audit
immutability), and the dashboard. `src/test/integration/isolation.test.ts` spins up a real Postgres via
Testcontainers and needs Docker running.

## Deployment

CI/CD runs on GitHub Actions ([`.github/workflows/ci-cd.yml`](.github/workflows/ci-cd.yml)):

1. **Quality** — type-check, lint, gitleaks secret scan.
2. **Test** — Postgres service container + vitest with coverage.
3. **Dependency audit** — fails on high-severity advisories (non-blocking signal).
4. **Image** (on `dev` / `prod`) — build → Trivy scan → CycloneDX SBOM → push to Artifact Registry,
   keyless via Workload Identity Federation.
5. **Deploy** (on `prod`) — `prisma migrate deploy` through the Cloud SQL Auth Proxy, then a Cloud Run
   revision of `cms-prod`.

Runtime secrets live in GCP Secret Manager; the service runs as the `cms-run-prod` service account.
See [`docs/ci-cd-gcp-setup.md`](docs/ci-cd-gcp-setup.md) for provisioning details.
