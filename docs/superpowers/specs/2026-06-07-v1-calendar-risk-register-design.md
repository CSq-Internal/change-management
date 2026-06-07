# v1.0 Completion — Bundle 2: Change Calendar + Risk Register — Design

**Date:** 2026-06-07
**Branch:** `feat/v1-calendar-risk-register` (off `dev`)
**Source:** PRD v1.0 gap analysis — activates two stub pages (`/calendar`, `/risk-register`) into real, DB-backed features.

## Goal

1. **Change Calendar** — a month-grid visualization of scheduled changes and blackout windows, with conflict detection (collision + blackout) and drag-to-reschedule.
2. **Risk Register** — a full systemic risk register (likelihood × impact scoring, owner, mitigation, status, review date), scoped per OpCo or group-wide.

## Locked decisions (confirmed 2026-06-07)

- **Calendar interactivity:** interactive — drag a change to a new day to reschedule (not read-only).
- **Calendar layout:** month grid (prev/next month nav). No week/day views in v1.
- **Conflict detection — overlap:** keyed on **(same OpCo + same `infrastructureType` + intersecting planned window)**. Risk level does **not** gate the conflict; it only colors the badge severity (by the higher risk level of the colliding pair). Changes on *different* infrastructure types are never flagged as overlaps.
- **Conflict detection — blackout:** a change whose planned window intersects an applicable `BlackoutPeriod` (the change's OpCo, or a group-wide `opcoId = null` blackout).
- **Reschedule policy:** blackout = **hard block** (unless `isEmergency`), consistent with the existing submit-time policy; overlap = **soft warning** (allowed, just badged).
- **Risk Register:** full model with likelihood(1-5) × impact(1-5) scoring, status `open/mitigating/closed`, OpCo or group scope; admin/CAB CRUD, in-scope view.

## Known limitation (v2)

Overlap detection is scoped **within a single OpCo**. A shared/backbone change (e.g. `Equiano Optics`) that collides across two OpCos is **not** detected in v1. Revisit in v2: detect same-`infrastructureType` overlaps across OpCos for group-spanning infrastructure.

---

## PART A — Change Calendar

### A1. Conflict detection (pure, unit-tested) — `src/lib/calendar.ts`

Pure functions, no DB. Inputs are plain serialisable shapes (epoch ms), so they unit-test cleanly.

```ts
export type CalChange = {
  id: string
  opcoId: string
  infrastructureType: string
  riskLevel: "low" | "medium" | "high" | "emergency"
  isEmergency: boolean
  start: number   // plannedStart epoch ms
  end: number     // plannedEnd epoch ms
}
export type CalBlackout = {
  id: string
  opcoId: string | null  // null = group-wide
  label: string
  start: number
  end: number
}
export type ConflictKind = "overlap" | "blackout"
export type ChangeConflicts = {
  overlap: boolean
  blackout: boolean
  blackoutLabels: string[]        // labels of intersected blackouts
  overlapWith: string[]          // ids of colliding changes
  severity: "low" | "medium" | "high" | "emergency" | null // max risk among self + overlap peers, or null if no overlap
}
```

- `windowsIntersect(aStart, aEnd, bStart, bEnd): boolean` — half-open intersection (`aStart < bEnd && bStart < aEnd`).
- `computeConflicts(changes: CalChange[], blackouts: CalBlackout[]): Map<string, ChangeConflicts>`:
  - **overlap:** for each change, find other changes with the **same `opcoId` AND same `infrastructureType`** whose window intersects. Record their ids in `overlapWith`; `overlap = overlapWith.length > 0`.
  - **severity:** when `overlap`, the **highest** risk level among the change and its overlap peers (order low < medium < high < emergency); else `null`. Drives badge color.
  - **blackout:** a blackout applies when `blackout.opcoId === change.opcoId || blackout.opcoId === null`. `blackout = ` any applicable blackout whose window intersects the change window; collect their `label`s into `blackoutLabels`.

### A2. Reschedule action — `src/server/actions/changes.ts` (new `rescheduleChange`)

Distinct from the draft-only `updateChange`. Signature: `rescheduleChange(id: string, newStartIso: string, newEndIso: string)`.

- Load change + opco. Permission: `change.requesterId === user.id` OR group_admin OR `hasRoleInOpCo(orgs, opco.slug, "admin")` (mirrors `updateChange`).
- **Status guard:** allowed only for `draft | pending | approved`. Throw otherwise ("Only unimplemented changes can be rescheduled").
- **Validation:** both dates parse; `newEnd > newStart`. Throw on invalid.
- **Blackout hard-block** (skip if `change.isEmergency`): query blackouts where `(opcoId = change.opcoId OR opcoId IS NULL)` whose window intersects `[newStart, newEnd]`; if any, throw `Blocked by blackout: "<label>". Emergencies may override.` (overlap is NOT blocked here — it's a soft warning surfaced on the calendar).
- On success: `update` `plannedStart`/`plannedEnd`; write `AuditLog` `action: "rescheduled"`, `note: "Rescheduled <oldStart>→<oldEnd> to <newStart>→<newEnd>"`. Return the updated change.

> The calendar drag computes `newStart`/`newEnd` by moving `plannedStart` to the dropped day, **preserving time-of-day**, and shifting `plannedEnd` by the same delta (duration preserved).

### A3. Page + client

**`src/app/(dashboard)/calendar/page.tsx`** (server):
- Auth; compute `groupLevel` + `opcoSlugs` + `opcoFilter` (same pattern as `reports/page.tsx`).
- Read the target month from a `?month=YYYY-MM` search param (default = current month). Compute `[monthStart, monthEnd]`.
- Load changes whose planned window intersects the month: `where: { ...opcoFilter, plannedStart: { lt: monthEnd }, plannedEnd: { gte: monthStart } }`. (A `lt`/`gte` date filter already excludes nulls, so no separate `not: null` is needed — and never repeat the `plannedStart` key in one object, since Prisma would overwrite it.) Select id, title, opcoId, opco{slug,name}, infrastructureType, riskLevel, isEmergency, status, plannedStart, plannedEnd, requesterId.
- Load blackouts intersecting the month, scoped `(opcoId IN user's opcos OR opcoId IS NULL)` for OpCo users; all for group.
- Serialize to `CalChange`/`CalBlackout` (epoch ms), run `computeConflicts` server-side, pass changes + conflicts + month to the client.

**`calendar-client.tsx`** (client):
- Month grid (weeks × 7 days), today highlighted, prev/next month links (update `?month=`).
- Each day cell lists change chips (sorted by start time) and a blackout band. A chip shows title + time, a **⚠ badge** when `overlap` (colored by `severity`: low=slate, medium=amber, high=orange, emergency/critical=red) and/or a **freeze badge** when `blackout`. Chip links to `/changes/[id]`.
- **Drag:** HTML5 drag-and-drop (`draggable` chip → day cell `onDrop`). Only chips for statuses `draft|pending|approved` and changes the user may reschedule are draggable (pass a `canReschedule` flag per chip from the server using the same permission rule). On drop, compute new window (preserve time-of-day + duration) and call `rescheduleChange`; on success `router.refresh()`, on error toast the message (e.g. blackout block).
- i18n strings (en + fr).

---

## PART B — Risk Register

### B1. Schema — `prisma/schema.prisma` (+ migration)

```prisma
enum RiskCategory {
  operational
  security
  compliance
  technical
}

enum RiskStatus {
  open
  mitigating
  closed
}

model RiskRegister {
  id             String       @id @default(cuid())
  title          String
  description    String
  category       RiskCategory
  likelihood     Int          // 1-5
  impact         Int          // 1-5
  owner          String       // free-text owner (team/function/person)
  mitigationPlan String?
  status         RiskStatus   @default(open)
  reviewDate     DateTime?
  opcoId         String?      // null = group-wide
  opco           OpCo?        @relation(fields: [opcoId], references: [id])
  createdById    String
  createdBy      User         @relation("RiskAuthor", fields: [createdById], references: [id])
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  @@index([opcoId])
  @@index([status])
}
```

Back-relations: `OpCo.risks RiskRegister[]`, `User.risksAuthored RiskRegister[] @relation("RiskAuthor")`. Migration adds the two enums + table.

### B2. Scoring (pure, unit-tested) — `src/lib/risk-score.ts`

```ts
export type RiskBand = "low" | "medium" | "high" | "critical"
export function riskScore(likelihood: number, impact: number): number  // clamps each to 1..5, returns product 1..25
export function riskBand(score: number): RiskBand
//  1-4 low · 5-9 medium · 10-15 high · 16-25 critical
```

### B3. Server actions — `src/server/actions/risk-register.ts`

- `listRisks()` — scoped: group users → all; OpCo users → `opcoId IN their opcos OR opcoId IS NULL`. Order by status then createdAt desc.
- `createRisk(input)` / `updateRisk(id, input)` / `setRiskStatus(id, status)`:
  - **Permission:** group-scoped risk (`opcoId = null`) requires `isGroupAdmin`; OpCo-scoped requires `isGroupAdmin || hasRoleInOpCo(orgs, opcoSlug, "admin")`.
  - Validate likelihood/impact ∈ 1..5, non-empty title/description/owner.
  - Audit to **`AdminAuditLog`** (`action: "risk_created" | "risk_updated" | "risk_closed"`, `opcoId`, `summary`, `metadata`).
- Reuse `getAppSession`, `getPrisma`, the permission helpers. Input typed via a small `RiskInput` type (no Zod unless the codebase already uses it — match existing actions' style).

### B4. Page + client

**`src/app/(dashboard)/risk-register/page.tsx`** (server): auth, `listRisks`, compute a `canManage` flag (group_admin, or admin of any OpCo) to gate the create button, serialize, pass to client.

**`risk-register-client.tsx`** (client): a table — Title · Category · **Score badge** (band-colored, shows `score` + band) · Owner · Status · Review date · Scope (OpCo name or "Group"). Admin-only "New risk" button + create/edit dialog (title, description, category select, likelihood 1-5, impact 1-5, owner, mitigation, status, review date, scope select). i18n (en + fr).

---

## Files

**Create:**
- `src/lib/calendar.ts` + `src/test/lib/calendar.test.ts`
- `src/lib/risk-score.ts` + `src/test/lib/risk-score.test.ts`
- `src/server/actions/risk-register.ts` + `src/test/actions/risk-register.test.ts`
- `src/app/(dashboard)/calendar/calendar-client.tsx`
- `src/app/(dashboard)/risk-register/risk-register-client.tsx`
- `prisma/migrations/<ts>_risk_register/migration.sql`

**Modify:**
- `prisma/schema.prisma` — `RiskCategory`, `RiskStatus`, `RiskRegister` + back-relations.
- `src/server/actions/changes.ts` — `rescheduleChange` + `src/test/actions/changes.test.ts` coverage.
- `src/app/(dashboard)/calendar/page.tsx` — replace stub with DB-backed server component.
- `src/app/(dashboard)/risk-register/page.tsx` — replace stub with DB-backed server component.
- `src/lib/i18n.ts` — calendar + risk-register strings (en + fr).

## Testing

- **Unit:** `computeConflicts` (overlap same-opco-same-infra only; different infra → no overlap; severity = max risk; blackout intersection incl. group-wide); `windowsIntersect` boundaries; `riskScore`/`riskBand` bands + clamping.
- **Action (db-mocked):** `rescheduleChange` — status guard, permission, blackout hard-block (and emergency bypass), audit write; `createRisk`/`updateRisk`/`setRiskStatus` — scope-based permission + AdminAuditLog write.
- **Playwright smoke:** open the calendar, see a change + a conflict badge, drag a change to a new day (reschedule succeeds; dragging into a blackout is blocked with a toast); create a risk in the register and see its score band; verify scope visibility.

## Out of scope (this bundle)

Linking risk entries to specific changes; recurring review reminders / notifications (Bundle 3); calendar week/day views; cross-OpCo overlap detection (v2, see Known limitation).
