# Tabbed Dashboard Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current dashboard (`src/app/page.tsx` + `src/app/dashboard-client.tsx`) with a tabbed dashboard — **Monitor / Triage / Report** — fronted by a persistent status bar, defaulting to Triage, driven by real Prisma data.

**Architecture:** The server component (`page.tsx`) fetches change requests + active blackouts + recent audit events, runs a **pure, unit-tested metrics module** (`src/lib/dashboard-metrics.ts`) to produce one serializable `DashboardData` object, and passes it to a client tab-shell. All time math happens once on the server (no live countdowns), so there is no hydration mismatch and the client components stay presentational. Status/risk badge styling is extracted from `change-detail-client.tsx` into a shared component so both pages reuse it.

**Tech Stack:** Next.js App Router (server + client components), TypeScript, Tailwind v4 (CSS-variable tokens in `src/app/globals.css`), Prisma v7, Vitest (added here for the metrics module). Charts are hand-rolled inline SVG — **no chart library**.

---

## Visual reference & theme rules (READ FIRST)

The approved visual is the in-repo mock **`design/dashboard-tabbed.html`** — open it in a browser while building. Translate its structure to React, but **do not copy its skin**. The mock used hardcoded hex, Fraunces and JetBrains Mono purely for the comp.

**Theme fidelity rules — the app must look like the rest of the app:**
- **Font:** Space Grotesk only (the app's `font-sans`). No Fraunces, no mono font. For numeric columns/counters use the Tailwind `tabular-nums` class, not a monospace font.
- **Colors:** semantic Tailwind tokens only — `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-muted`, `text-primary`, etc. (defined in `src/app/globals.css`). This makes dark mode work for free. Never hardcode `#0a3d91`/`#00a3ff` in components.
- **Status/risk pills:** reuse the shared `StatusPill`/`RiskPill` (Task 5) — the same amber/emerald/rose/blue/violet/slate map already used on the change-detail page, with dark variants.
- **Severity accents** (breach = rose, at-risk = amber): use `text-rose-600 dark:text-rose-400`, `text-amber-600 dark:text-amber-400`, `border-rose-500`, etc. — matching the existing badge palette.
- **Primitives:** reuse `@/components/ui/card` and `@/components/ui/button` (its default variant is the navy primary). Cards keep the existing `border-border/80 bg-card/90 rounded-lg` look used across the app.
- **i18n:** every user-visible string goes through `t(language, key)` and must be added to **both** `en` and `fr` in `src/lib/i18n.ts` (Task 6).

**Scope for v1 (and what's deferred):**
- v1 ships: status bar, the three tabs, Monitor (status tiles + live activity + blackouts + open-by-OpCo), Triage (summary chips + grouped worklist; rows **link to `/changes/[id]`** rather than inline approve/reject), Report (KPIs + risk donut + open-by-OpCo + status distribution).
- **Deferred (own follow-up):** the Report **time-series trend charts** (opened-vs-closed, SLA-compliance-over-time) and **avg-approval-time / SLA-compliance-%** KPIs. They need historical data the schema doesn't retain yet (would come from an `AuditLog` rollup). Task 11 ships the live-computable Report widgets and leaves a documented seam. Inline worklist actions (Approve/Reject without leaving the page) are also a follow-up.

**Known dev caveat (affects verification):** `getPrisma()` throws unless `DATABASE_URL`/`PRISMA_ACCELERATE_URL` is set, and live login is currently blocked by the Keycloak token-claims gap. So the live page can't be exercised end-to-end in dev yet. This plan makes the logic **unit-tested without a DB** and the client **purely props-driven**, and verifies UI via `pnpm tsc --noEmit`, `pnpm lint`, and a temporary props-fed preview (Task 14). Full end-to-end is gated on DB + login (out of scope).

---

## File structure

**New:**
- `vitest.config.ts` — test runner config (node env).
- `src/lib/dashboard-metrics.ts` — pure types + aggregation logic (the tested core).
- `src/lib/dashboard-metrics.test.ts` — Vitest unit tests.
- `src/components/change-badges.tsx` — shared `StatusPill`/`RiskPill` + color maps.
- `src/components/dashboard/status-bar.tsx` — persistent severity bar.
- `src/components/dashboard/charts.tsx` — `RiskDonut`, `OpcoBars`, `StatusDistribution` (inline SVG/flex).
- `src/components/dashboard/monitor-view.tsx`
- `src/components/dashboard/triage-view.tsx`
- `src/components/dashboard/report-view.tsx`

**Modified:**
- `src/app/dashboard-client.tsx` — becomes the tab shell (status bar + tabs + the three views).
- `src/app/page.tsx` — fetch data, call `buildDashboardData`, pass `DashboardData` + extras.
- `src/lib/i18n.ts` — add `dashboard.*` keys (en + fr).
- `src/app/(dashboard)/changes/[id]/change-detail-client.tsx` — import the shared pills, delete its local copies.
- `package.json` — add `test` script + `vitest` devDependency.

---

## Task 0: Add Vitest for the metrics module

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json` (scripts + devDependencies)

- [ ] **Step 1: Install Vitest**

Run: `pnpm add -D vitest`
Expected: `vitest` appears under `devDependencies` in `package.json`; `pnpm-lock.yaml` updates.

- [ ] **Step 2: Create the config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config"
import { fileURLToPath } from "node:url"

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
})
```

- [ ] **Step 3: Add the test script**

In `package.json` `"scripts"`, add:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Smoke-test the runner**

Create a throwaway `src/lib/_smoke.test.ts` with `import { test, expect } from "vitest"; test("runner", () => expect(1).toBe(1))`.
Run: `pnpm test`
Expected: 1 passing test. Then delete `src/lib/_smoke.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml vitest.config.ts
git commit -m "chore: add vitest for unit-testable logic"
```

---

## Task 1: Metrics module — types + primitives

**Files:**
- Create: `src/lib/dashboard-metrics.ts`
- Test: `src/lib/dashboard-metrics.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/dashboard-metrics.test.ts`:

```ts
import { test, expect } from "vitest"
import { isOpen, slaState, durLabel, type DashboardChange } from "./dashboard-metrics"

const now = Date.parse("2026-06-02T09:00:00Z")
const iso = (hoursFromNow: number) => new Date(now + hoursFromNow * 3600_000).toISOString()

test("isOpen excludes closed and rejected", () => {
  expect(isOpen("pending")).toBe(true)
  expect(isOpen("verified")).toBe(true)
  expect(isOpen("closed")).toBe(false)
  expect(isOpen("rejected")).toBe(false)
})

test("slaState classifies by deadline vs now", () => {
  expect(slaState(iso(-2), now)).toBe("breached")
  expect(slaState(iso(1), now)).toBe("atRisk")   // within 4h
  expect(slaState(iso(10), now)).toBe("ok")
  expect(slaState(null, now)).toBe("none")
})

test("durLabel renders coarse h/m", () => {
  expect(durLabel(90 * 60_000)).toBe("1h")
  expect(durLabel(25 * 60_000)).toBe("25m")
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm test`
Expected: FAIL — `Cannot find module './dashboard-metrics'`.

- [ ] **Step 3: Implement the primitives**

Create `src/lib/dashboard-metrics.ts`:

```ts
export type ChangeStatusName =
  | "draft" | "pending" | "approved" | "rejected" | "implemented" | "verified" | "closed"
export type RiskLevelName = "low" | "medium" | "high" | "emergency"

/** Serializable input row (Dates as ISO strings). page.tsx maps Prisma rows to this. */
export interface DashboardChange {
  id: string
  title: string
  status: ChangeStatusName
  riskLevel: RiskLevelName
  isEmergency: boolean
  slaDeadline: string | null
  plannedStart: string | null
  opcoName: string
  opcoSlug: string
  ownerInitials: string
}

export const STATUS_ORDER: ChangeStatusName[] =
  ["draft", "pending", "approved", "implemented", "verified", "closed"]
export const RISK_ORDER: RiskLevelName[] = ["low", "medium", "high", "emergency"]

const AT_RISK_WINDOW_MS = 4 * 3600_000

export function isOpen(status: ChangeStatusName): boolean {
  return status !== "closed" && status !== "rejected"
}

export type SlaState = "breached" | "atRisk" | "ok" | "none"

export function slaState(slaDeadline: string | null, nowMs: number): SlaState {
  if (!slaDeadline) return "none"
  const remaining = Date.parse(slaDeadline) - nowMs
  if (remaining < 0) return "breached"
  if (remaining < AT_RISK_WINDOW_MS) return "atRisk"
  return "ok"
}

/** Coarse "1h" / "25m" label for a duration in ms. */
export function durLabel(ms: number): string {
  const abs = Math.abs(ms)
  const h = Math.floor(abs / 3600_000)
  const m = Math.round((abs - h * 3600_000) / 60_000)
  return h >= 1 ? `${h}h` : `${m}m`
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm test`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboard-metrics.ts src/lib/dashboard-metrics.test.ts
git commit -m "feat(dashboard): metrics primitives (isOpen, slaState, durLabel)"
```

---

## Task 2: Metrics module — `whenLabel` + the shared 14-change fixture

**Files:**
- Modify: `src/lib/dashboard-metrics.ts`
- Modify: `src/lib/dashboard-metrics.test.ts`

This fixture mirrors `design/dashboard-tabbed.html` so the tested numbers match the approved mock.

- [ ] **Step 1: Add the failing test (fixture + whenLabel)**

Append to `src/lib/dashboard-metrics.test.ts`:

```ts
import { whenLabel } from "./dashboard-metrics"

export function fixture(): DashboardChange[] {
  const mk = (
    id: string, title: string, opcoName: string, opcoSlug: string,
    status: DashboardChange["status"], riskLevel: DashboardChange["riskLevel"],
    slaH: number | null, planH: number | null, ownerInitials: string, isEmergency = false,
  ): DashboardChange => ({
    id, title, opcoName, opcoSlug, status, riskLevel, isEmergency, ownerInitials,
    slaDeadline: slaH === null ? null : iso(slaH),
    plannedStart: planH === null ? null : iso(planH),
  })
  return [
    mk("CHG-1042", "Backbone IP route table update", "Ghana", "ghana", "pending", "medium", 3.2, 50, "AM"),
    mk("CHG-1043", "BGP peering change — Accra IXP", "Ghana", "ghana", "pending", "high", 1.1, 26, "KO"),
    mk("CHG-1044", "DWDM card replacement — Kampala metro", "Uganda", "uganda", "approved", "high", 6, 14, "SN"),
    mk("CHG-1045", "Firewall ruleset update — Lomé PoP", "Togo", "togo", "implemented", "medium", null, -6, "DT"),
    mk("CHG-1046", "OLT firmware upgrade — Lubumbashi", "DRC", "drc", "draft", "low", null, null, "PM"),
    mk("CHG-1047", "Core router OS patch — Monrovia", "Liberia", "liberia", "pending", "high", -1.6, 30, "JG"),
    mk("CHG-1048", "Submarine cable maintenance — Mauritius landing", "Mauritius", "mauritius", "approved", "emergency", 0.4, 9, "RB", true),
    mk("CHG-1049", "VLAN re-segmentation — Kampala core", "Uganda", "uganda", "verified", "medium", null, -30, "SN"),
    mk("CHG-1050", "Power redundancy test — Accra DC", "Ghana", "ghana", "closed", "low", null, -72, "AM"),
    mk("CHG-1051", "MPLS LSP re-route — DRC backbone", "DRC", "drc", "rejected", "high", null, null, "JG"),
    mk("CHG-1052", "DNS resolver migration — group", "Group", "group", "pending", "medium", 13.5, 70, "LK"),
    mk("CHG-1053", "Edge cache node deploy — Lomé", "Togo", "togo", "approved", "low", 40, 74, "DT"),
    mk("CHG-1054", "BGP community policy update — Mauritius", "Mauritius", "mauritius", "implemented", "medium", null, -18, "RB"),
    mk("CHG-1055", "Spectrum re-grooming — Kampala–Entebbe", "Uganda", "uganda", "pending", "high", -0.3, 20, "SN"),
  ]
}

test("whenLabel buckets today/tomorrow/weekday", () => {
  const today9pm = Date.parse("2026-06-02T21:00:00Z")
  expect(whenLabel(today9pm, today9pm - 1)).toMatch(/^Tonight /)
  const tomorrow = Date.parse("2026-06-03T08:00:00Z")
  expect(whenLabel(tomorrow, today9pm)).toMatch(/^Tomorrow /)
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm test`
Expected: FAIL — `whenLabel` is not exported.

- [ ] **Step 3: Implement `whenLabel`**

Append to `src/lib/dashboard-metrics.ts`:

```ts
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const pad = (n: number) => String(n).padStart(2, "0")

/** "Tonight 21:00" / "Tomorrow 08:00" / "Wed 14:00", relative to nowMs. */
export function whenLabel(whenMs: number, nowMs: number): string {
  const d = new Date(whenMs)
  const startOfDay = (ms: number) => { const x = new Date(ms); x.setHours(0, 0, 0, 0); return x.getTime() }
  const dayDelta = Math.round((startOfDay(whenMs) - startOfDay(nowMs)) / 86_400_000)
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (dayDelta <= 0) return `${d.getHours() >= 18 ? "Tonight" : "Today"} ${hm}`
  if (dayDelta === 1) return `Tomorrow ${hm}`
  return `${DOW[d.getDay()]} ${hm}`
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboard-metrics.ts src/lib/dashboard-metrics.test.ts
git commit -m "feat(dashboard): whenLabel + shared test fixture"
```

---

## Task 3: Metrics module — `buildDashboardData`

**Files:**
- Modify: `src/lib/dashboard-metrics.ts`
- Modify: `src/lib/dashboard-metrics.test.ts`

- [ ] **Step 1: Write the failing test (assert against the mock's numbers)**

Append to `src/lib/dashboard-metrics.test.ts`:

```ts
import { buildDashboardData } from "./dashboard-metrics"

test("buildDashboardData matches the approved mock", () => {
  const d = buildDashboardData(fixture(), now)

  // status-bar / summary counts
  expect(d.counts.open).toBe(12)
  expect(d.counts.pending).toBe(5)
  expect(d.counts.breached).toBe(2)        // 1047, 1055
  expect(d.counts.atRisk).toBe(3)          // 1043, 1042, 1048
  expect(d.counts.emergency).toBe(1)       // 1048
  expect(d.counts.scheduledToday).toBe(3)  // 1048(9h), 1044(14h), 1055(20h)
  expect(d.counts.readyToAdvance).toBe(5)  // 3 approved + 2 implemented

  // triage worklist grouping
  expect(d.triage.overdue.map((w) => w.id)).toEqual(["CHG-1055", "CHG-1047"]) // soonest-breached first
  expect(d.triage.awaiting.map((w) => w.id)).toEqual(["CHG-1043", "CHG-1042", "CHG-1052"])
  expect(d.triage.advance).toHaveLength(5)
  expect(d.triage.overdue[0].severity).toBe("over")
  expect(d.triage.overdue[0].why).toMatch(/breached/)

  // distributions
  expect(d.report.statusCounts).toMatchObject({
    draft: 1, pending: 5, approved: 3, implemented: 2, verified: 1, rejected: 1, closed: 1,
  })
  expect(d.report.riskOpen).toMatchObject({ low: 2, medium: 5, high: 4, emergency: 1 })
  expect(d.report.opcoOpen[0]).toEqual({ name: "Uganda", count: 3 })

  // monitor tiles cover all 6 lifecycle statuses in order
  expect(d.monitor.tiles.map((t) => t.status)).toEqual(STATUS_ORDER)
  expect(d.monitor.tiles.find((t) => t.status === "pending")!.count).toBe(5)
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm test`
Expected: FAIL — `buildDashboardData` not exported.

- [ ] **Step 3: Implement `buildDashboardData`**

Append to `src/lib/dashboard-metrics.ts`:

```ts
export interface WorklistItem {
  id: string
  title: string
  opcoName: string
  risk: RiskLevelName
  ownerInitials: string
  why: string
  severity: "over" | "soon" | "go"
}
export interface StatusTile {
  status: ChangeStatusName
  count: number
  risk: Record<RiskLevelName, number>
}
export interface NamedCount { name: string; count: number }

export interface DashboardData {
  counts: {
    open: number; pending: number; breached: number; atRisk: number
    emergency: number; scheduledToday: number; readyToAdvance: number
  }
  triage: { overdue: WorklistItem[]; awaiting: WorklistItem[]; advance: WorklistItem[] }
  monitor: { tiles: StatusTile[] }
  report: {
    statusCounts: Record<ChangeStatusName, number>
    riskOpen: Record<RiskLevelName, number>
    opcoOpen: NamedCount[]
  }
}

const ONE_DAY_MS = 24 * 3600_000

export function buildDashboardData(changes: DashboardChange[], nowMs: number): DashboardData {
  const open = changes.filter((c) => isOpen(c.status))
  const breachedOf = (c: DashboardChange) => slaState(c.slaDeadline, nowMs) === "breached"
  const bySla = (a: DashboardChange, b: DashboardChange) =>
    (a.slaDeadline ? Date.parse(a.slaDeadline) : Infinity) -
    (b.slaDeadline ? Date.parse(b.slaDeadline) : Infinity)

  const overdueChanges = open.filter((c) => c.status === "pending" && breachedOf(c)).sort(bySla)
  const awaitingChanges = open
    .filter((c) => c.status === "pending" && !breachedOf(c)).sort(bySla)
  const advanceChanges = open
    .filter((c) => c.status === "approved" || c.status === "implemented")
    .sort((a, b) =>
      (a.plannedStart ? Date.parse(a.plannedStart) : Infinity) -
      (b.plannedStart ? Date.parse(b.plannedStart) : Infinity))

  const base = (c: DashboardChange) => ({
    id: c.id, title: c.title, opcoName: c.opcoName, risk: c.riskLevel, ownerInitials: c.ownerInitials,
  })
  const overdue: WorklistItem[] = overdueChanges.map((c) => ({
    ...base(c), severity: "over",
    why: `SLA breached ${durLabel(Date.parse(c.slaDeadline!) - nowMs)} ago`,
  }))
  const awaiting: WorklistItem[] = awaitingChanges.map((c) => {
    const remaining = Date.parse(c.slaDeadline!) - nowMs
    return { ...base(c), severity: remaining < AT_RISK_WINDOW_MS ? "soon" : "go", why: `${durLabel(remaining)} to SLA` }
  })
  const advance: WorklistItem[] = advanceChanges.map((c) => ({
    ...base(c), severity: "go",
    why: c.status === "approved"
      ? (c.plannedStart ? `Approved · ${whenLabel(Date.parse(c.plannedStart), nowMs)}` : "Approved · ready to implement")
      : "Implemented · ready to verify",
  }))

  const zeroStatus = () =>
    ({ draft: 0, pending: 0, approved: 0, rejected: 0, implemented: 0, verified: 0, closed: 0 }) as Record<ChangeStatusName, number>
  const statusCounts = zeroStatus()
  for (const c of changes) statusCounts[c.status]++

  const zeroRisk = () => ({ low: 0, medium: 0, high: 0, emergency: 0 }) as Record<RiskLevelName, number>
  const riskOpen = zeroRisk()
  for (const c of open) riskOpen[c.riskLevel]++

  const opcoMap = new Map<string, number>()
  for (const c of open) opcoMap.set(c.opcoName, (opcoMap.get(c.opcoName) ?? 0) + 1)
  const opcoOpen: NamedCount[] = [...opcoMap.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)

  const tiles: StatusTile[] = STATUS_ORDER.map((status) => {
    const rows = changes.filter((c) => c.status === status)
    const risk = zeroRisk()
    for (const c of rows) risk[c.riskLevel]++
    return { status, count: rows.length, risk }
  })

  const scheduledToday = open.filter(
    (c) => c.plannedStart && Date.parse(c.plannedStart) >= nowMs && Date.parse(c.plannedStart) - nowMs < ONE_DAY_MS,
  ).length

  return {
    counts: {
      open: open.length,
      pending: changes.filter((c) => c.status === "pending").length,
      breached: open.filter(breachedOf).length,
      atRisk: open.filter((c) => slaState(c.slaDeadline, nowMs) === "atRisk").length,
      emergency: open.filter((c) => c.isEmergency).length,
      scheduledToday,
      readyToAdvance: advanceChanges.length,
    },
    triage: { overdue, awaiting, advance },
    monitor: { tiles },
    report: { statusCounts, riskOpen, opcoOpen },
  }
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `pnpm test`
Expected: PASS (all tests green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboard-metrics.ts src/lib/dashboard-metrics.test.ts
git commit -m "feat(dashboard): buildDashboardData aggregator"
```

---

## Task 4: Shared change badges (DRY extraction)

**Files:**
- Create: `src/components/change-badges.tsx`
- Modify: `src/app/(dashboard)/changes/[id]/change-detail-client.tsx:68-93` (delete local maps + `StatusPill`, import shared)

- [ ] **Step 1: Create the shared component**

Create `src/components/change-badges.tsx` (maps copied verbatim from `change-detail-client.tsx:68-83`, plus a `RiskPill`):

```tsx
const STATUS_COLORS: Record<string, string> = {
  draft: "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200",
  pending: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  approved: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  rejected: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
  implemented: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  verified: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
  closed: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
}
const RISK_COLORS: Record<string, string> = {
  low: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  high: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  emergency: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
}
const PILL = "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize"

export function StatusPill({ status }: { status: string }) {
  return <span className={`${PILL} ${STATUS_COLORS[status] ?? "bg-muted text-muted-foreground"}`}>{status}</span>
}
export function RiskPill({ risk }: { risk: string }) {
  return <span className={`${PILL} ${RISK_COLORS[risk] ?? "bg-muted text-muted-foreground"}`}>{risk}</span>
}
```

- [ ] **Step 2: Refactor the detail page to use it**

In `src/app/(dashboard)/changes/[id]/change-detail-client.tsx`: delete the local `STATUS_COLORS`, `RISK_COLORS`, and `StatusPill` (lines ~68-93), and add to the imports:

```tsx
import { StatusPill } from "@/components/change-badges"
```

(If `RISK_COLORS` was referenced elsewhere in that file for a risk pill, replace that usage with `<RiskPill risk={...} />` and import `RiskPill` too. Grep first: `rg "RISK_COLORS|STATUS_COLORS|StatusPill" src/app/(dashboard)/changes/[id]/change-detail-client.tsx`.)

- [ ] **Step 3: Verify types + lint**

Run: `pnpm tsc --noEmit && pnpm lint`
Expected: no errors; no unused-variable warnings for the removed maps.

- [ ] **Step 4: Commit**

```bash
git add src/components/change-badges.tsx "src/app/(dashboard)/changes/[id]/change-detail-client.tsx"
git commit -m "refactor: extract shared StatusPill/RiskPill"
```

---

## Task 5: i18n keys (en + fr)

**Files:**
- Modify: `src/lib/i18n.ts`

- [ ] **Step 1: Add keys to the `en` map**

Inside `translations.en` (after the existing `dashboard.*` keys), add:

```ts
"dashboard.tab.monitor": "Monitor",
"dashboard.tab.triage": "Triage",
"dashboard.tab.report": "Report",
"dashboard.status.live": "Live",
"dashboard.status.breached": "breached",
"dashboard.status.atRisk": "at risk",
"dashboard.status.emergency": "emergency",
"dashboard.status.blackouts": "active blackouts",
"dashboard.status.allClear": "All clear",
"dashboard.monitor.liveActivity": "Live activity",
"dashboard.monitor.blackouts": "Active blackouts",
"dashboard.monitor.openByOpco": "Open by OpCo",
"dashboard.triage.overdue": "Overdue · escalate",
"dashboard.triage.awaiting": "Awaiting decision",
"dashboard.triage.advance": "Ready to advance",
"dashboard.triage.worklist": "Your worklist",
"dashboard.triage.sortedByUrgency": "Sorted by urgency",
"dashboard.triage.overdueCount": "Overdue",
"dashboard.triage.toDecide": "To decide",
"dashboard.triage.toAdvance": "To advance",
"dashboard.triage.scheduledToday": "Scheduled today",
"dashboard.report.health": "Change health · this week",
"dashboard.report.open": "Open changes",
"dashboard.report.pending": "Awaiting approval",
"dashboard.report.breaches": "SLA breaches",
"dashboard.report.emergency": "Emergency",
"dashboard.report.riskMix": "Risk mix",
"dashboard.report.statusDistribution": "Status distribution",
"dashboard.empty": "Nothing here right now.",
```

- [ ] **Step 2: Add the same keys to the `fr` map**

Inside `translations.fr`, add the French strings:

```ts
"dashboard.tab.monitor": "Supervision",
"dashboard.tab.triage": "Tri",
"dashboard.tab.report": "Rapport",
"dashboard.status.live": "En direct",
"dashboard.status.breached": "hors SLA",
"dashboard.status.atRisk": "à risque",
"dashboard.status.emergency": "urgence",
"dashboard.status.blackouts": "gels actifs",
"dashboard.status.allClear": "Tout est normal",
"dashboard.monitor.liveActivity": "Activité en direct",
"dashboard.monitor.blackouts": "Gels actifs",
"dashboard.monitor.openByOpco": "Ouverts par OpCo",
"dashboard.triage.overdue": "En retard · à escalader",
"dashboard.triage.awaiting": "En attente de décision",
"dashboard.triage.advance": "Prêts à avancer",
"dashboard.triage.worklist": "Votre liste de tâches",
"dashboard.triage.sortedByUrgency": "Triés par urgence",
"dashboard.triage.overdueCount": "En retard",
"dashboard.triage.toDecide": "À décider",
"dashboard.triage.toAdvance": "À avancer",
"dashboard.triage.scheduledToday": "Planifiés aujourd'hui",
"dashboard.report.health": "Santé des changements · cette semaine",
"dashboard.report.open": "Changements ouverts",
"dashboard.report.pending": "En attente d'approbation",
"dashboard.report.breaches": "Dépassements SLA",
"dashboard.report.emergency": "Urgence",
"dashboard.report.riskMix": "Répartition des risques",
"dashboard.report.statusDistribution": "Répartition par statut",
"dashboard.empty": "Rien pour le moment.",
```

- [ ] **Step 3: Verify**

Run: `pnpm tsc --noEmit`
Expected: no errors (both maps still satisfy `Record<string,string>`).

- [ ] **Step 4: Commit**

```bash
git add src/lib/i18n.ts
git commit -m "feat(dashboard): i18n keys for tabbed dashboard (en+fr)"
```

---

## Task 6: Chart primitives (inline SVG)

**Files:**
- Create: `src/components/dashboard/charts.tsx`

These are presentational, theme-token styled, no library. Numeric labels use `tabular-nums`. Colors come from a small risk/status hex map (chart fills can't be Tailwind classes inside SVG `fill`, so a local constant is acceptable here — keep it the only place hex appears).

- [ ] **Step 1: Create the file**

Create `src/components/dashboard/charts.tsx`:

```tsx
import type { ChangeStatusName, NamedCount, RiskLevelName } from "@/lib/dashboard-metrics"
import { RISK_ORDER } from "@/lib/dashboard-metrics"

// SVG fills must be concrete colors; keep all chart hex isolated here.
const RISK_HEX: Record<RiskLevelName, string> = {
  low: "#10b981", medium: "#f59e0b", high: "#f97316", emergency: "#f43f5e",
}
const STATUS_HEX: Record<ChangeStatusName, string> = {
  draft: "#a1a1aa", pending: "#f59e0b", approved: "#10b981", rejected: "#f43f5e",
  implemented: "#3b82f6", verified: "#8b5cf6", closed: "#64748b",
}

export function RiskDonut({ riskOpen }: { riskOpen: Record<RiskLevelName, number> }) {
  const segs = RISK_ORDER.map((r) => ({ r, v: riskOpen[r] })).filter((s) => s.v > 0)
  const total = segs.reduce((a, s) => a + s.v, 0)
  const size = 120, R = 46, cx = size / 2, C = 2 * Math.PI * R
  let offset = 0
  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {segs.map((s) => {
          const len = (s.v / total) * C
          const el = (
            <circle key={s.r} cx={cx} cy={cx} r={R} fill="none" stroke={RISK_HEX[s.r]} strokeWidth={15}
              strokeDasharray={`${len.toFixed(2)} ${(C - len).toFixed(2)}`} strokeDashoffset={-offset}
              transform={`rotate(-90 ${cx} ${cx})`} />
          )
          offset += len
          return el
        })}
        <text x={cx} y={cx - 2} textAnchor="middle" className="fill-foreground text-xl font-semibold tabular-nums">{total}</text>
        <text x={cx} y={cx + 14} textAnchor="middle" className="fill-muted-foreground text-[11px]">open</text>
      </svg>
      <ul className="flex-1 space-y-1">
        {segs.map((s) => (
          <li key={s.r} className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5 capitalize">
              <i className="h-2.5 w-2.5 rounded-sm" style={{ background: RISK_HEX[s.r] }} />{s.r}
            </span>
            <b className="font-semibold tabular-nums text-foreground">{s.v}</b>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function OpcoBars({ data }: { data: NamedCount[] }) {
  const max = Math.max(1, ...data.map((d) => d.count))
  return (
    <div className="space-y-1.5">
      {data.map((d) => (
        <div key={d.name} className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="w-16 shrink-0 truncate font-medium text-foreground">{d.name}</span>
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <i className="block h-full rounded-full bg-primary" style={{ width: `${(d.count / max) * 100}%` }} />
          </span>
          <span className="w-4 text-right tabular-nums">{d.count}</span>
        </div>
      ))}
    </div>
  )
}

export function StatusDistribution({ counts }: { counts: Record<ChangeStatusName, number> }) {
  const order: ChangeStatusName[] = ["pending", "approved", "implemented", "verified", "draft", "rejected", "closed"]
  const segs = order.map((s) => ({ s, n: counts[s] })).filter((x) => x.n > 0)
  const total = segs.reduce((a, x) => a + x.n, 0)
  return (
    <div>
      <div className="mb-2 flex h-3.5 overflow-hidden rounded-md bg-muted">
        {segs.map((x) => <i key={x.s} style={{ flex: x.n, background: STATUS_HEX[x.s] }} />)}
      </div>
      <div className="flex flex-wrap gap-2.5 text-[11px] text-muted-foreground">
        {segs.map((x) => (
          <span key={x.s} className="flex items-center gap-1.5 capitalize">
            <i className="h-2 w-2 rounded-sm" style={{ background: STATUS_HEX[x.s] }} />{x.s}{" "}
            <b className="font-semibold text-foreground tabular-nums">{x.n}</b>
          </span>
        ))}
      </div>
      <span className="sr-only">{total} total</span>
    </div>
  )
}
```

- [ ] **Step 2: Verify types**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/charts.tsx
git commit -m "feat(dashboard): inline SVG chart primitives"
```

---

## Task 7: Status bar component

**Files:**
- Create: `src/components/dashboard/status-bar.tsx`

- [ ] **Step 1: Create it**

Create `src/components/dashboard/status-bar.tsx`. Severity drives the left-border + dot color; quiet (emerald) when all-clear:

```tsx
import { Lock } from "lucide-react"
import { t } from "@/lib/i18n"
import type { Language } from "@/lib/i18n"
import type { DashboardData } from "@/lib/dashboard-metrics"

export function StatusBar({
  counts, blackouts, language,
}: { counts: DashboardData["counts"]; blackouts: number; language: Language }) {
  const severity = counts.breached > 0 ? "red" : counts.atRisk > 0 ? "amber" : "ok"
  const border =
    severity === "red" ? "border-l-rose-500" : severity === "amber" ? "border-l-amber-500" : "border-l-emerald-500"
  const dot =
    severity === "red" ? "bg-rose-500" : severity === "amber" ? "bg-amber-500" : "bg-emerald-500"

  return (
    <div className={`mb-3 flex flex-wrap items-center rounded-xl border border-l-[3px] ${border} border-border bg-card/90 px-4 py-2.5 shadow-sm`}>
      <span className="flex items-center gap-2 pr-4 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span className={`h-2 w-2 rounded-full ${dot}`} />{t(language, "dashboard.status.live")}
      </span>
      {counts.breached > 0 && (
        <Seg><b className="text-rose-600 dark:text-rose-400">{counts.breached}</b> {t(language, "dashboard.status.breached")}</Seg>
      )}
      {counts.atRisk > 0 && (
        <Seg><b className="text-amber-600 dark:text-amber-400">{counts.atRisk}</b> {t(language, "dashboard.status.atRisk")}</Seg>
      )}
      {counts.emergency > 0 && (
        <Seg><b className="text-cyan-700 dark:text-cyan-300">{counts.emergency}</b> {t(language, "dashboard.status.emergency")}</Seg>
      )}
      <Seg><Lock className="h-3.5 w-3.5 text-rose-500" />{blackouts} {t(language, "dashboard.status.blackouts")}</Seg>
      {severity === "ok" && counts.breached === 0 && counts.atRisk === 0 && (
        <Seg><span className="font-semibold text-emerald-700 dark:text-emerald-400">✓ {t(language, "dashboard.status.allClear")}</span></Seg>
      )}
    </div>
  )
}

function Seg({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 border-l border-border px-4 text-[12.5px] text-muted-foreground first-of-type:border-l-0 [&_b]:font-mono [&_b]:text-[15px] [&_b]:font-semibold tabular-nums">
      {children}
    </span>
  )
}
```

> Note: `[&_b]:font-mono` is fine — Tailwind's `font-mono` falls back to the system mono stack; no font is loaded and none is needed. If you prefer strict Space-Grotesk, drop `[&_b]:font-mono` and keep `tabular-nums`.

- [ ] **Step 2: Verify types**

Run: `pnpm tsc --noEmit`
Expected: no errors. (`lucide-react` is already a dependency.)

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/status-bar.tsx
git commit -m "feat(dashboard): persistent status bar"
```

---

## Task 8: Monitor view

**Files:**
- Create: `src/components/dashboard/monitor-view.tsx`

Renders: alert strip, the 6 status tiles (with mini risk bars), live activity feed (from audit events passed in), active blackouts, open-by-OpCo. Reference `#pane-monitor` in the mock.

- [ ] **Step 1: Create it**

Create `src/components/dashboard/monitor-view.tsx`:

```tsx
import { Activity, Lock, Globe, TriangleAlert } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { t, type Language } from "@/lib/i18n"
import { RISK_ORDER, type DashboardData, type RiskLevelName } from "@/lib/dashboard-metrics"
import { OpcoBars } from "./charts"

const RISK_HEX: Record<RiskLevelName, string> = { low: "#10b981", medium: "#f59e0b", high: "#f97316", emergency: "#f43f5e" }
const STATUS_DOT: Record<string, string> = {
  draft: "bg-zinc-400", pending: "bg-amber-500", approved: "bg-emerald-500",
  implemented: "bg-blue-500", verified: "bg-violet-500", closed: "bg-slate-500",
}

export interface FeedEvent { id: string; changeId: string; label: string; actor: string; ago: string; tone: string }

export function MonitorView({
  data, blackouts, feed, language,
}: {
  data: DashboardData
  blackouts: { id: string; label: string; scope: string; endsIn: string; amber: boolean }[]
  feed: FeedEvent[]
  language: Language
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-rose-200 bg-rose-50/70 px-4 py-3 dark:border-rose-900/50 dark:bg-rose-950/30">
        <span className="text-2xl font-semibold tabular-nums text-rose-600 dark:text-rose-400">{data.counts.breached}</span>
        <span className="text-sm font-medium text-rose-800 dark:text-rose-300">{t(language, "dashboard.status.breached")}</span>
        <span className="mx-1 h-6 w-px bg-rose-200 dark:bg-rose-900/50" />
        <span className="text-2xl font-semibold tabular-nums text-amber-600 dark:text-amber-400">{data.counts.atRisk}</span>
        <span className="text-sm font-medium text-amber-700 dark:text-amber-300">{t(language, "dashboard.status.atRisk")}</span>
        <span className="ml-auto flex items-center gap-2 text-xs text-rose-700/80 dark:text-rose-300/70">
          <TriangleAlert className="h-4 w-4" /> Both overdue items are high-risk network work
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        {data.monitor.tiles.map((tile) => {
          const total = RISK_ORDER.reduce((a, r) => a + tile.risk[r], 0)
          return (
            <Card key={tile.status} className="border-border/80 bg-card/90">
              <CardContent className="p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold capitalize text-muted-foreground">{tile.status}</span>
                  <span className={`h-2 w-2 rounded-full ${STATUS_DOT[tile.status]}`} />
                </div>
                <div className="my-2 text-3xl font-semibold tabular-nums">{tile.count}</div>
                <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">
                  {total === 0
                    ? <i className="flex-1 bg-border" />
                    : RISK_ORDER.map((r) => tile.risk[r] > 0
                        ? <i key={r} style={{ flex: tile.risk[r], background: RISK_HEX[r] }} /> : null)}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.6fr_1fr]">
        <Card className="border-border/80 bg-card/90">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-sm"><Activity className="h-4 w-4 text-primary" /> {t(language, "dashboard.monitor.liveActivity")}</CardTitle>
          </CardHeader>
          <CardContent className="max-h-64 space-y-0 overflow-auto">
            {feed.length === 0 && <p className="text-sm text-muted-foreground">{t(language, "dashboard.empty")}</p>}
            {feed.map((e) => (
              <div key={e.id} className="flex gap-2.5 border-t border-border/60 py-2 first:border-t-0">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${e.tone}`} />
                <div className="min-w-0">
                  <div className="text-[12.5px] text-foreground"><span className="font-semibold text-primary">{e.changeId}</span> {e.label}</div>
                  <div className="text-[11px] text-muted-foreground">{e.actor} · {e.ago}</div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-border/80 bg-card/90">
          <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Lock className="h-4 w-4 text-primary" /> {t(language, "dashboard.monitor.blackouts")}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              {blackouts.map((b) => (
                <div key={b.id} className="flex items-start gap-2 text-xs">
                  <Lock className={`mt-0.5 h-3.5 w-3.5 ${b.amber ? "text-amber-500" : "text-rose-500"}`} />
                  <div><div className="text-foreground">{b.label}</div><div className="text-muted-foreground">{b.scope} · ends in {b.endsIn}</div></div>
                </div>
              ))}
            </div>
            <div className="border-t border-border/60 pt-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><Globe className="h-4 w-4 text-primary" /> {t(language, "dashboard.monitor.openByOpco")}</div>
              <OpcoBars data={data.report.opcoOpen} />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify types**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/monitor-view.tsx
git commit -m "feat(dashboard): Monitor view"
```

---

## Task 9: Triage view

**Files:**
- Create: `src/components/dashboard/triage-view.tsx`

Summary chips + the grouped worklist. **Each row is a `next/link` to `/changes/[id]`** (inline approve/reject is a follow-up). The action button label still reflects the next action.

- [ ] **Step 1: Create it**

Create `src/components/dashboard/triage-view.tsx`:

```tsx
import Link from "next/link"
import { ListChecks } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { t, type Language } from "@/lib/i18n"
import type { DashboardData, WorklistItem } from "@/lib/dashboard-metrics"
import { RiskPill } from "@/components/change-badges"

const SEV_BORDER: Record<WorklistItem["severity"], string> = {
  over: "border-l-rose-500", soon: "border-l-amber-500", go: "border-l-primary",
}
const SEV_WHY: Record<WorklistItem["severity"], string> = {
  over: "text-rose-600 dark:text-rose-400", soon: "text-amber-600 dark:text-amber-400", go: "text-muted-foreground",
}

function Chip({ n, label, tone }: { n: number; label: string; tone: string }) {
  return (
    <Card className="border-border/80 bg-card/90">
      <CardContent className="p-3">
        <div className={`text-2xl font-semibold tabular-nums ${tone}`}>{n}</div>
        <div className="mt-1 text-[11px] font-medium text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  )
}

function Row({ item, actionLabel }: { item: WorklistItem; actionLabel: string }) {
  return (
    <Link
      href={`/changes/${item.id}`}
      className={`flex items-center gap-3 rounded-xl border border-l-[3px] ${SEV_BORDER[item.severity]} border-border bg-card/90 px-3.5 py-3 shadow-sm transition-colors hover:bg-muted/50`}
    >
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">{item.ownerInitials}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-foreground">{item.title}</div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11.5px] text-muted-foreground">
          <span className="font-mono text-[11px] text-muted-foreground/70">{item.id}</span> · {item.opcoName}
          <RiskPill risk={item.risk} />
          <span className={`font-medium ${SEV_WHY[item.severity]}`}>{item.why}</span>
        </div>
      </div>
      <span className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground">{actionLabel}</span>
    </Link>
  )
}

function GroupHeader({ dot, label, count }: { dot: string; label: string; count: number }) {
  return (
    <div className="mb-2 mt-3.5 flex items-center gap-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      <span className={`h-2 w-2 rounded-full ${dot}`} />{label}
      <span className="ml-auto font-mono tabular-nums text-muted-foreground/70">{count}</span>
    </div>
  )
}

export function TriageView({ data, language }: { data: DashboardData; language: Language }) {
  const advanceLabel = (it: WorklistItem) => (it.why.startsWith("Implemented") ? "Verify" : it.why.includes("Tonight") || it.why.includes("Today") ? "Start" : "Advance")
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Chip n={data.counts.breached} label={t(language, "dashboard.triage.overdueCount")} tone="text-rose-600 dark:text-rose-400" />
        <Chip n={data.counts.pending} label={t(language, "dashboard.triage.toDecide")} tone="text-primary" />
        <Chip n={data.counts.readyToAdvance} label={t(language, "dashboard.triage.toAdvance")} tone="text-amber-600 dark:text-amber-400" />
        <Chip n={data.counts.scheduledToday} label={t(language, "dashboard.triage.scheduledToday")} tone="text-foreground" />
      </div>

      <Card className="border-border/80 bg-card/90">
        <CardHeader className="flex flex-row items-center justify-between pb-1">
          <CardTitle className="flex items-center gap-2 text-sm"><ListChecks className="h-4 w-4 text-primary" /> {t(language, "dashboard.triage.worklist")}</CardTitle>
          <span className="text-xs text-muted-foreground">{t(language, "dashboard.triage.sortedByUrgency")}</span>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <GroupHeader dot="bg-rose-500" label={t(language, "dashboard.triage.overdue")} count={data.triage.overdue.length} />
          {data.triage.overdue.map((it) => <Row key={it.id} item={it} actionLabel="Review" />)}
          <GroupHeader dot="bg-amber-500" label={t(language, "dashboard.triage.awaiting")} count={data.triage.awaiting.length} />
          {data.triage.awaiting.map((it) => <Row key={it.id} item={it} actionLabel="Review" />)}
          <GroupHeader dot="bg-primary" label={t(language, "dashboard.triage.advance")} count={data.triage.advance.length} />
          {data.triage.advance.map((it) => <Row key={it.id} item={it} actionLabel={advanceLabel(it)} />)}
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: Verify types**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/triage-view.tsx
git commit -m "feat(dashboard): Triage worklist view"
```

---

## Task 10: Report view (live widgets; trends deferred)

**Files:**
- Create: `src/components/dashboard/report-view.tsx`

KPIs computable now + risk donut + open-by-OpCo + status distribution. A commented seam marks where the deferred trend charts go.

- [ ] **Step 1: Create it**

Create `src/components/dashboard/report-view.tsx`:

```tsx
import { Shield, PieChart, BarChart3, LayoutGrid } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { t, type Language } from "@/lib/i18n"
import type { DashboardData } from "@/lib/dashboard-metrics"
import { RiskDonut, OpcoBars, StatusDistribution } from "./charts"

function Kpi({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <Card className="border-border/80 bg-card/90">
      <CardContent className="p-3.5">
        <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
        <div className={`mt-1.5 text-2xl font-semibold tabular-nums ${tone ?? ""}`}>{value}</div>
      </CardContent>
    </Card>
  )
}

export function ReportView({ data, language }: { data: DashboardData; language: Language }) {
  return (
    <div className="space-y-3">
      <Card className="border-border/80 bg-card/90">
        <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Shield className="h-4 w-4 text-primary" /> {t(language, "dashboard.report.health")}</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Kpi label={t(language, "dashboard.report.open")} value={data.counts.open} />
            <Kpi label={t(language, "dashboard.report.pending")} value={data.counts.pending} />
            <Kpi label={t(language, "dashboard.report.breaches")} value={data.counts.breached} tone="text-rose-600 dark:text-rose-400" />
            <Kpi label={t(language, "dashboard.report.emergency")} value={data.counts.emergency} />
          </div>
          {/* DEFERRED: opened-vs-closed and SLA-compliance trend charts go here once an
              AuditLog-derived weekly rollup exists. See plan §"Scope for v1". */}
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="border-border/80 bg-card/90">
          <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><PieChart className="h-4 w-4 text-primary" /> {t(language, "dashboard.report.riskMix")}</CardTitle></CardHeader>
          <CardContent><RiskDonut riskOpen={data.report.riskOpen} /></CardContent>
        </Card>
        <Card className="border-border/80 bg-card/90">
          <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><BarChart3 className="h-4 w-4 text-primary" /> {t(language, "dashboard.monitor.openByOpco")}</CardTitle></CardHeader>
          <CardContent><OpcoBars data={data.report.opcoOpen} /></CardContent>
        </Card>
      </div>

      <Card className="border-border/80 bg-card/90">
        <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><LayoutGrid className="h-4 w-4 text-primary" /> {t(language, "dashboard.report.statusDistribution")}</CardTitle></CardHeader>
        <CardContent><StatusDistribution counts={data.report.statusCounts} /></CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: Verify types**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/report-view.tsx
git commit -m "feat(dashboard): Report view (live widgets)"
```

---

## Task 11: Tab shell (rewrite `dashboard-client.tsx`)

**Files:**
- Modify: `src/app/dashboard-client.tsx` (full rewrite)

Status bar + the three tabs + active pane. Tab state in `useState` (default `triage`), persisted to `localStorage` under `csq-dashboard-tab` (matching the app's localStorage convention). Monitor tab shows a red dot when `breached > 0`; Triage shows a count badge.

- [ ] **Step 1: Rewrite the file**

Replace the entire contents of `src/app/dashboard-client.tsx`:

```tsx
"use client"

import { useEffect, useState } from "react"
import { LayoutGrid, ListChecks, BarChart3 } from "lucide-react"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import type { DashboardData } from "@/lib/dashboard-metrics"
import { StatusBar } from "@/components/dashboard/status-bar"
import { MonitorView, type FeedEvent } from "@/components/dashboard/monitor-view"
import { TriageView } from "@/components/dashboard/triage-view"
import { ReportView } from "@/components/dashboard/report-view"

type TabKey = "monitor" | "triage" | "report"

export interface DashboardProps {
  data: DashboardData
  blackouts: { id: string; label: string; scope: string; endsIn: string; amber: boolean }[]
  feed: FeedEvent[]
  blackoutCount: number
}

export default function DashboardClient({ data, blackouts, feed, blackoutCount }: DashboardProps) {
  const { language } = useStore()
  const [tab, setTab] = useState<TabKey>("triage")

  useEffect(() => {
    const saved = localStorage.getItem("csq-dashboard-tab") as TabKey | null
    if (saved === "monitor" || saved === "triage" || saved === "report") setTab(saved)
  }, [])
  const select = (k: TabKey) => { setTab(k); localStorage.setItem("csq-dashboard-tab", k) }

  const triageCount = data.triage.overdue.length + data.triage.awaiting.length + data.triage.advance.length

  return (
    <div>
      <StatusBar counts={data.counts} blackouts={blackoutCount} language={language} />

      <div className="mb-3.5 flex gap-1.5 rounded-xl border border-border bg-muted p-1">
        <TabButton active={tab === "monitor"} onClick={() => select("monitor")}>
          <LayoutGrid className="h-4 w-4" /> {t(language, "dashboard.tab.monitor")}
          {data.counts.breached > 0 && <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />}
        </TabButton>
        <TabButton active={tab === "triage"} onClick={() => select("triage")}>
          <ListChecks className="h-4 w-4" /> {t(language, "dashboard.tab.triage")}
          <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[11px] font-mono text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 tabular-nums">{triageCount}</span>
        </TabButton>
        <TabButton active={tab === "report"} onClick={() => select("report")}>
          <BarChart3 className="h-4 w-4" /> {t(language, "dashboard.tab.report")}
        </TabButton>
      </div>

      {tab === "monitor" && <MonitorView data={data} blackouts={blackouts} feed={feed} language={language} />}
      {tab === "triage" && <TriageView data={data} language={language} />}
      {tab === "report" && <ReportView data={data} language={language} />}
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-[13px] font-semibold transition-colors ${
        active ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  )
}
```

- [ ] **Step 2: Verify types**

Run: `pnpm tsc --noEmit`
Expected: errors **only** in `src/app/page.tsx` (its props no longer match) — that's fixed next. No errors inside `dashboard-client.tsx` itself.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard-client.tsx
git commit -m "feat(dashboard): tabbed shell with status bar"
```

---

## Task 12: Wire the server page (`page.tsx`)

**Files:**
- Modify: `src/app/page.tsx` (full rewrite of the data section)

Fetch the change list + active blackouts + recent audit events, map to `DashboardChange`, call `buildDashboardData`, and pass everything to the client.

- [ ] **Step 1: Rewrite `page.tsx`**

Replace the contents of `src/app/page.tsx`:

```tsx
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { getPrisma } from "@/server/db"
import { isGroupLevel } from "@/lib/permissions"
import { buildDashboardData, type DashboardChange } from "@/lib/dashboard-metrics"
import { durLabel } from "@/lib/dashboard-metrics"
import DashboardClient from "./dashboard-client"
import type { FeedEvent } from "@/components/dashboard/monitor-view"

const initials = (name: string | null, email: string) => {
  const src = (name ?? email.split("@")[0] ?? "").trim()
  const parts = src.split(/[ .]+/).filter(Boolean)
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?"
}
const FEED_TONE: Record<string, string> = {
  submit: "bg-amber-500", approve: "bg-emerald-500", reject: "bg-rose-500",
  implement: "bg-blue-500", verify: "bg-violet-500", breach: "bg-rose-500",
}

export default async function Home() {
  const session = await auth()
  if (!session) redirect("/login")

  const db = getPrisma()
  const now = Date.now()
  const groupLevel = isGroupLevel(session.user.realmRoles)
  const opcoSlugs = session.user.organizations.map((o) => o.alias)
  const opcoFilter = groupLevel ? {} : { opco: { slug: { in: opcoSlugs } } }

  const [rows, blackoutRows, auditRows] = await Promise.all([
    db.changeRequest.findMany({
      where: opcoFilter,
      select: {
        id: true, title: true, status: true, riskLevel: true, isEmergency: true,
        slaDeadline: true, plannedStart: true,
        opco: { select: { name: true, slug: true } },
        requester: { select: { name: true, email: true } },
      },
    }),
    db.blackoutPeriod.findMany({
      where: { startsAt: { lte: new Date(now) }, endsAt: { gte: new Date(now) }, ...(groupLevel ? {} : { OR: [{ opcoId: null }, { opco: { slug: { in: opcoSlugs } } }] }) },
      select: { id: true, label: true, endsAt: true, opco: { select: { name: true } } },
    }),
    db.auditLog.findMany({
      where: { change: opcoFilter },
      orderBy: { at: "desc" },
      take: 8,
      select: { id: true, action: true, at: true, change: { select: { id: true } }, actor: { select: { name: true, email: true } } },
    }),
  ])

  const changes: DashboardChange[] = rows.map((r) => ({
    id: r.id, title: r.title, status: r.status, riskLevel: r.riskLevel, isEmergency: r.isEmergency,
    slaDeadline: r.slaDeadline?.toISOString() ?? null,
    plannedStart: r.plannedStart?.toISOString() ?? null,
    opcoName: r.opco.name, opcoSlug: r.opco.slug,
    ownerInitials: initials(r.requester.name, r.requester.email),
  }))

  const data = buildDashboardData(changes, now)

  const blackouts = blackoutRows.map((b) => ({
    id: b.id, label: b.label, scope: b.opco?.name ?? "Group",
    endsIn: durLabel(b.endsAt.getTime() - now), amber: b.endsAt.getTime() - now < 12 * 3600_000,
  }))

  const feed: FeedEvent[] = auditRows.map((a) => ({
    id: a.id, changeId: a.change.id,
    label: a.action,
    actor: a.actor.name ?? a.actor.email.split("@")[0],
    ago: `${durLabel(now - a.at.getTime())} ago`,
    tone: FEED_TONE[a.action] ?? "bg-slate-400",
  }))

  return <DashboardClient data={data} blackouts={blackouts} feed={feed} blackoutCount={blackouts.length} />
}
```

> Note: the previous `welcomeName`/`isApprover` derivation is dropped — the new dashboard doesn't use a welcome header. If product wants the greeting back, it belongs in a future header task, not here. The `AppShell` (sidebar/header) is unaffected; it reads its own data.

- [ ] **Step 2: Verify the whole app type-checks**

Run: `pnpm tsc --noEmit`
Expected: **no errors** anywhere.

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: clean (fix any unused-import warnings).

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat(dashboard): wire server data into tabbed dashboard"
```

---

## Task 13: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Logic tests**

Run: `pnpm test`
Expected: all `dashboard-metrics` tests pass.

- [ ] **Step 2: Types + lint + build**

Run: `pnpm tsc --noEmit && pnpm lint && pnpm build`
Expected: all succeed. (`pnpm build` runs `prisma generate` then `next build`; it compiles the dashboard route.)

- [ ] **Step 3: Visual check via a temporary props-fed preview** (DB/login is blocked in dev)

Create a throwaway route `src/app/(dashboard)/__preview/page.tsx` that imports `DashboardClient` and feeds it `buildDashboardData(fixture, Date.now())` using the fixture from the test plus 2 sample blackouts and 4 sample feed events. Run `pnpm dev`, open `/__preview`, and compare against `design/dashboard-tabbed.html`:
  - status bar shows `2 breached · 3 at risk · 1 emergency`, red left accent;
  - tabs switch; Monitor tab shows a red dot; Triage badge shows the worklist count; defaults to Triage;
  - Monitor tiles, Triage groups, and Report donut/bars render with the app's theme (Space Grotesk, navy/cyan, dark-mode toggle via the app preferences still looks right).

Then **delete** `src/app/(dashboard)/__preview/`.

- [ ] **Step 4: Run the deslop skill + confirm tests green** (per project phase-gate convention)

Run the `deslop` skill over the new files, address findings, then re-run `pnpm test && pnpm tsc --noEmit && pnpm lint`.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "test(dashboard): verify tabbed dashboard end-to-end (logic + types + build)"
```

---

## Self-review checklist (done while writing — recorded for the executor)

- **Spec coverage:** status bar ✓ (T7), three tabs/shell ✓ (T11), Monitor ✓ (T8), Triage worklist ✓ (T9), Report live widgets ✓ (T10), real data wiring ✓ (T12), theme rules ✓ (tokens throughout, T4–T11), i18n en+fr ✓ (T5), persistent-bar + Monitor red dot ✓ (T7/T11). Deferred items (trend charts, inline actions, avg-approval/SLA-% KPIs) are explicitly out of v1 scope.
- **Type consistency:** `DashboardData`, `WorklistItem`, `StatusTile`, `NamedCount`, `DashboardChange`, `FeedEvent` are defined once and imported everywhere; `buildDashboardData(changes, nowMs)` signature is stable across T3/T12; tab keys `"monitor"|"triage"|"report"` match between shell and i18n keys.
- **Placeholders:** none — every code step is complete; the only deferred block is a clearly-labelled comment seam in T10.
- **Data caveat:** verification (T13) accounts for the blocked DB/login via the metrics tests + temporary preview route.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-02-dashboard-tabbed-redesign.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
