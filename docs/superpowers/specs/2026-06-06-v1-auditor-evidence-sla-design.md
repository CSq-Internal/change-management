# v1.0 Completion — Bundle 1: Auditor Evidence + SLA — Design

**Date:** 2026-06-06
**Branch:** `feat/v1-auditor-evidence-sla` (off `dev`)
**Source:** PRD v1.0 gap analysis — closes three PRD-mandated gaps (PDF evidence, SLA escalation, SLA compliance report).

## Goal

1. **PDF audit-evidence package (per change)** — auditor/ISO A.12.1.2 evidence: a printable record of a change's full history.
2. **SLA escalation + breach/emergency emails** — automatic escalation OpCo Admin → group level on SLA breach, plus the missing transactional emails.
3. **SLA Compliance Report** — per-OpCo × risk-level SLA adherence.

## Locked decisions (confirmed 2026-06-06)

- **SLA trigger:** *both* — lazy-on-read (dashboard/approvals page load) **and** a protected cron endpoint.
- **PDF generation:** programmatic via **`@react-pdf/renderer`** (no headless browser).
- **PDF scope:** per-change only this bundle; bulk/date-range remains the existing CSV export.
- **Level-2 escalation recipients:** **group CAB members** (`CABMembership` where `opcoId = null`) — the DB-modelled group authorities, since `group_admin` is a Keycloak realm role not reliably stored per-user in the DB.

---

## A. PDF audit-evidence package

**Route:** `GET /api/changes/[id]/evidence.pdf` (new). RBAC mirrors `src/app/api/audit-export/route.ts`: requires session; OpCo-scoped users only for changes in their accessible OpCos; group-level users any OpCo. 403/404 otherwise.

**Generation:** `@react-pdf/renderer` `renderToBuffer(<EvidenceDocument change={...} />)`; respond with `application/pdf` + `Content-Disposition: attachment; filename="evidence-<reference>.pdf"`.

**Data:** load the change with `opco`, `requester`, `implementedBy`, `approvals { approver }`, `auditTrail { actor }`, `attachments`, `pir { author }`.

**Document content (`src/server/pdf/evidence-document.tsx`):**
- Header: CSquared CMS · "Change Evidence Package" · reference `#<n>` · generated timestamp · "Internal Confidential".
- Summary: title, OpCo, status, risk, category, `EMERGENCY`/`EXPEDITED` flags, requester, implementer, contact.
- Dates: created, planned start/end, SLA deadline, implemented at.
- Change detail: description, change reason, impact scope, implementation plan, testing plan, backout plan.
- Attachments: filename · kind · uploaded-by · date (no file contents — metadata only).
- Approvals: each approver, decision, CAB flag, comment, timestamp.
- PIR: outcome, summary, backout-used, author, timestamp (if present).
- Audit trail: every entry — action, from→to status, actor, note, timestamp.

**UI:** an "Export evidence (PDF)" link/button on the change-detail page (visible to auditor/admin/group; reuse `caps`), `href` to the route, opens in a new tab.

---

## B. SLA escalation + emails

**Schema (`ChangeRequest`, additive):**
```prisma
  escalationLevel  Int       @default(0)   // 0 none · 1 OpCo admin notified · 2 group notified
  lastEscalatedAt  DateTime?
```

**Tier math (pure, in `src/lib/sla.ts` — unit-tested):**
- Original SLA window hours come from the existing `SLA_HOURS` map (low 48 / medium 24 / high 4 / emergency 1).
- `dueEscalationLevel(slaDeadline, slaWindowHours, nowMs)`:
  - `now < slaDeadline` → 0 (not breached).
  - `slaDeadline <= now < slaDeadline + 50% window` → 1.
  - `now >= slaDeadline + 50% window` → 2.

**Orchestration (`src/server/sla.ts`):**
- `runDueEscalations({ opcoSlugs? }):` query **pending** changes (optionally scoped to `opcoSlugs`) with `slaDeadline != null`; for each, compute `dueEscalationLevel`; if it exceeds the stored `escalationLevel`, for each newly-crossed level:
  - **Level 1:** recipients = active OpCo admins (`UserOpCoAssignment` role `admin`, the change's `opcoId`).
  - **Level 2:** recipients = active **group CAB members** (`CABMembership` `opcoId = null`).
  - Send an SLA-breach email (new template); write an `AuditLog` `action: "sla_escalated"`, `note: "Escalated to level N"`.
  - Update `escalationLevel` + `lastEscalatedAt`.
- Idempotent: re-running never re-sends a level already recorded (guarded by `escalationLevel`). Best-effort emails (`Promise.allSettled`); escalation state still advances so we don't spam on every read.

**Triggers:**
- **Lazy:** `src/app/page.tsx` (dashboard) and `src/app/(dashboard)/approvals/page.tsx` call `runDueEscalations({ opcoSlugs: <user's accessible OpCos> })` (fire-and-forget; never block render — `.catch(() => {})`).
- **Cron:** `POST /api/cron/sla` — requires header `x-cron-secret` === `process.env.CRON_SECRET` (else 401); calls `runDueEscalations({})` (all OpCos); returns `{ escalated: <count> }`. Documented in `.env.example` (`CRON_SECRET=`).

**Emergency email:** in `submitChange` (`src/server/actions/changes.ts`), when `change.isEmergency`, additionally email the group CAB members an "emergency change submitted" alert (the routed-approver notification already fires; this is the explicit emergency alert from the PRD).

**Email templates (`src/server/email.ts`):** add `sendSlaEscalationEmail({ to, changeTitle, changeId, level, riskLevel })` and `sendEmergencyAlertEmail({ to, changeTitle, changeId, requesterName })`, using the existing `dispatchEmail` transport.

---

## C. SLA Compliance Report

**Pure calc (`src/lib/sla-report.ts` — unit-tested):** given rows of `{ opcoSlug, opcoName, riskLevel, slaDeadline, decidedAt }` (where `decidedAt` = timestamp of the first `approved`/`rejected` audit entry, or null if still pending), compute per-OpCo × risk:
- `decided`, `inSla` (decidedAt ≤ slaDeadline), `adherencePct`.
- A change still pending past its deadline counts as a breach; still pending within deadline is excluded (not yet decided).

**Data (`src/app/(dashboard)/reports/...`):** load changes (scoped) with `opco` + their decision audit entries; map to the calc input; render a per-OpCo table (rows = risk levels, columns = decided / in-SLA / adherence %), group rollup for group users. Reuse the existing reports page shell/components.

---

## Files

**Create:**
- `prisma/migrations/<ts>_sla_escalation/migration.sql`
- `src/lib/sla.ts` + `src/test/lib/sla.test.ts` (tier math)
- `src/lib/sla-report.ts` + `src/test/lib/sla-report.test.ts` (adherence calc)
- `src/server/sla.ts` (orchestration) + `src/test/server/sla.test.ts` (db mocked)
- `src/server/pdf/evidence-document.tsx`
- `src/app/api/changes/[id]/evidence.pdf/route.ts` + `src/test/server/evidence-route.test.ts`
- `src/app/api/cron/sla/route.ts`

**Modify:**
- `prisma/schema.prisma` — `escalationLevel`, `lastEscalatedAt`.
- `src/server/email.ts` + `.env.example` — two templates; `CRON_SECRET`.
- `src/server/actions/changes.ts` — emergency alert on submit.
- `src/app/page.tsx`, `src/app/(dashboard)/approvals/page.tsx` — lazy escalation calls.
- `src/app/(dashboard)/changes/[id]/page.tsx` + `change-detail-client.tsx` — PDF button (+ `caps`).
- `src/app/(dashboard)/reports/*` — SLA compliance section.
- `src/lib/i18n.ts` — strings (en + fr).

## Testing

- **Unit:** `dueEscalationLevel` tier boundaries; adherence calc (in/out of SLA, pending-overdue); `runDueEscalations` (db mocked) — level-1 → OpCo admins, level-2 → group CAB, idempotency.
- **Route:** evidence PDF RBAC (member vs non-member vs group) + returns a PDF buffer; cron route secret check.
- **Playwright smoke:** export an evidence PDF; force a breach (set `slaDeadline` to the past) and confirm escalation fires + is audited.

## Dependencies

Add `@react-pdf/renderer` (prod). No headless browser.

## Out of scope (this bundle)

Bulk/date-range PDF (CSV covers it); in-app notifications + per-user prefs + Google Chat (Bundle 3); calendar/risk-register (Bundle 2); configurable approver matrix (Bundle 4).
