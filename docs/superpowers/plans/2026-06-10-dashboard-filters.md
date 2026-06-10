# Dashboard Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent dashboard filter bar (infra type, OpCo, status, risk, date range) that re-scopes all three tabs and the top StatusBar, plus a collapsible "Matching changes" list with CSV export.

**Architecture:** Client-side filtering over the already-loaded in-scope changes. `page.tsx` passes the raw `DashboardChange[]` (+ a shared `now`) to the client; the client holds `FilterState`, computes `applyFilters(changes, filters)` in a `useMemo`, and re-runs `buildDashboardData(filtered, now)` to drive every view. Filter state persists to localStorage and the URL query string. No server round-trips.

**Tech Stack:** Next.js 16 App Router (server component → client component props), React, TypeScript, Tailwind, Vitest + React Testing Library. Pure logic in `src/lib/`, components in `src/components/dashboard/`.

---

## File Structure

- **`src/lib/dashboard-metrics.ts`** (modify) — add `infrastructureType` + `createdAt` to `DashboardChange`.
- **`src/app/page.tsx`** (modify) — select the two new columns, map them, and pass `changes`, `now`, `infraOptions`, `opcoOptions` to the client (drop the server-built `data` prop).
- **`src/lib/dashboard-filters.ts`** (create) — pure `FilterState` + `applyFilters` / `isActive` / `filterToQuery` / `queryToFilter` + `ALL_STATUSES` / `ALL_RISKS`.
- **`src/lib/dashboard-filters.test.ts`** (create) — unit tests for the pure lib.
- **`src/lib/i18n.ts`** (modify) — filter/list strings (en + fr).
- **`src/components/dashboard/multi-select.tsx`** (create) — reusable checkbox dropdown.
- **`src/components/dashboard/multi-select.test.tsx`** (create) — smoke test.
- **`src/components/dashboard/dashboard-filters.tsx`** (create) — the filter bar.
- **`src/components/dashboard/matching-changes-list.tsx`** (create) — collapsible sortable table + CSV export.
- **`src/app/dashboard-client.tsx`** (modify) — new props, filter state, `useMemo` derivation, persistence, render bar + list.
- **`src/app/dashboard-client.test.tsx`** (modify) — update props; add a filter-narrowing test.

---

## Task 1: Add `infrastructureType` + `createdAt` to the dashboard change shape

**Files:**
- Modify: `src/lib/dashboard-metrics.ts` (the `DashboardChange` interface)
- Modify: `src/app/page.tsx` (Prisma `select` + mapping)
- Modify: `src/app/dashboard-client.test.tsx` (fixtures — keep the build green)

- [ ] **Step 1: Add the two fields to `DashboardChange`**

In `src/lib/dashboard-metrics.ts`, extend the interface (after `opcoSlug`):

```ts
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
  infrastructureType: string
  createdAt: string
  ownerInitials: string
  expedited: boolean
  retroApprovalDueAt: string | null
  retroApprovedAt: string | null
}
```

- [ ] **Step 2: Select + map the columns in `page.tsx`**

In `src/app/page.tsx`, add to the `db.changeRequest.findMany` `select` (alongside `slaDeadline`/`plannedStart`):

```ts
        slaDeadline: true, plannedStart: true, infrastructureType: true, createdAt: true,
        expedited: true, retroApprovalDueAt: true, retroApprovedAt: true,
```

And in the `changes` mapping, add the two fields:

```ts
    opcoName: r.opco.name, opcoSlug: r.opco.slug,
    infrastructureType: r.infrastructureType,
    createdAt: r.createdAt.toISOString(),
    ownerInitials: initials(r.requester.name, r.requester.email),
```

- [ ] **Step 3: Update the existing test fixtures**

In `src/app/dashboard-client.test.tsx`, add `infrastructureType` + `createdAt` to each of the 5 fixture rows so they satisfy the type. Use a created date a few days before `now` and a representative infra type:

```ts
const changes: DashboardChange[] = [
  { id: "CHG-1", title: "Core router OS patch", status: "pending", riskLevel: "high", isEmergency: false, slaDeadline: iso(-1.5), plannedStart: iso(30), opcoName: "Liberia", opcoSlug: "liberia", infrastructureType: "Backbone IP Network", createdAt: iso(-48), ownerInitials: "JG", expedited: false, retroApprovalDueAt: null, retroApprovedAt: null },
  { id: "CHG-2", title: "BGP peering change", status: "pending", riskLevel: "high", isEmergency: false, slaDeadline: iso(1), plannedStart: iso(26), opcoName: "Ghana", opcoSlug: "ghana", infrastructureType: "Backbone IP Network", createdAt: iso(-40), ownerInitials: "KO", expedited: false, retroApprovalDueAt: null, retroApprovedAt: null },
  { id: "CHG-3", title: "DWDM card replacement", status: "approved", riskLevel: "high", isEmergency: false, slaDeadline: iso(6), plannedStart: iso(14), opcoName: "Uganda", opcoSlug: "uganda", infrastructureType: "Equiano Optics", createdAt: iso(-30), ownerInitials: "SN", expedited: false, retroApprovalDueAt: null, retroApprovedAt: null },
  { id: "CHG-4", title: "Submarine cable maintenance", status: "approved", riskLevel: "emergency", isEmergency: true, slaDeadline: iso(0.4), plannedStart: iso(9), opcoName: "Mauritius", opcoSlug: "mauritius", infrastructureType: "Equiano Optics", createdAt: iso(-20), ownerInitials: "RB", expedited: false, retroApprovalDueAt: null, retroApprovedAt: null },
  { id: "CHG-5", title: "Power redundancy test", status: "closed", riskLevel: "low", isEmergency: false, slaDeadline: null, plannedStart: null, opcoName: "Ghana", opcoSlug: "ghana", infrastructureType: "Power", createdAt: iso(-10), ownerInitials: "AM", expedited: false, retroApprovalDueAt: null, retroApprovedAt: null },
]
```

(Leave the rest of the test file unchanged for now — Task 7 rewrites the `props` object.)

- [ ] **Step 4: Verify the build + existing tests stay green**

Run: `pnpm tsc --noEmit && pnpm test src/app/dashboard-client.test.tsx`
Expected: tsc clean; the 3 existing DashboardClient tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboard-metrics.ts src/app/page.tsx src/app/dashboard-client.test.tsx
git commit -m "feat(dashboard): carry infrastructureType + createdAt on dashboard changes"
```

---

## Task 2: Pure filter library (`dashboard-filters.ts`) — TDD

**Files:**
- Create: `src/lib/dashboard-filters.ts`
- Test: `src/lib/dashboard-filters.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/dashboard-filters.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import {
  EMPTY_FILTERS, applyFilters, isActive, filterToQuery, queryToFilter, type FilterState,
} from "@/lib/dashboard-filters"
import type { DashboardChange } from "@/lib/dashboard-metrics"

const base: Omit<DashboardChange, "id"> = {
  title: "x", status: "pending", riskLevel: "high", isEmergency: false,
  slaDeadline: "2026-06-10T12:00:00.000Z", plannedStart: "2026-06-15T08:00:00.000Z",
  opcoName: "Ghana", opcoSlug: "ghana", infrastructureType: "Equiano Optics",
  createdAt: "2026-06-01T09:00:00.000Z", ownerInitials: "KO",
  expedited: false, retroApprovalDueAt: null, retroApprovedAt: null,
}
const mk = (id: string, over: Partial<DashboardChange>): DashboardChange => ({ ...base, id, ...over })

const rows: DashboardChange[] = [
  mk("a", { infrastructureType: "Equiano Optics", opcoSlug: "ghana", status: "pending", riskLevel: "high" }),
  mk("b", { infrastructureType: "Equiano IP", opcoSlug: "togo", status: "approved", riskLevel: "low" }),
  mk("c", { infrastructureType: "Power", opcoSlug: "ghana", status: "closed", riskLevel: "medium" }),
]

describe("applyFilters", () => {
  it("returns all rows when no filter is active", () => {
    expect(applyFilters(rows, EMPTY_FILTERS)).toHaveLength(3)
  })
  it("ORs within the infra field (Equiano = both Optics and IP)", () => {
    const f = { ...EMPTY_FILTERS, infraTypes: ["Equiano Optics", "Equiano IP"] }
    expect(applyFilters(rows, f).map((r) => r.id)).toEqual(["a", "b"])
  })
  it("ANDs across fields (Equiano Optics AND ghana)", () => {
    const f = { ...EMPTY_FILTERS, infraTypes: ["Equiano Optics"], opcoSlugs: ["ghana"] }
    expect(applyFilters(rows, f).map((r) => r.id)).toEqual(["a"])
  })
  it("filters by status and risk", () => {
    expect(applyFilters(rows, { ...EMPTY_FILTERS, statuses: ["approved"] }).map((r) => r.id)).toEqual(["b"])
    expect(applyFilters(rows, { ...EMPTY_FILTERS, risks: ["medium"] }).map((r) => r.id)).toEqual(["c"])
  })
  it("filters by the chosen date field within an inclusive range", () => {
    const f: FilterState = { ...EMPTY_FILTERS, dateField: "created", dateFrom: "2026-06-01", dateTo: "2026-06-01" }
    expect(applyFilters(rows, f)).toHaveLength(3) // all created 2026-06-01
    const planned: FilterState = { ...EMPTY_FILTERS, dateField: "planned", dateFrom: "2026-06-16", dateTo: "2026-06-20" }
    expect(applyFilters(rows, planned)).toHaveLength(0) // all planned 2026-06-15
  })
  it("excludes rows whose chosen date field is null when a range is set", () => {
    const noSla = [mk("z", { slaDeadline: null })]
    const f: FilterState = { ...EMPTY_FILTERS, dateField: "sla", dateFrom: "2026-06-01", dateTo: "2026-06-30" }
    expect(applyFilters(noSla, f)).toHaveLength(0)
  })
})

describe("isActive", () => {
  it("is false for empty filters and true once any field is set", () => {
    expect(isActive(EMPTY_FILTERS)).toBe(false)
    expect(isActive({ ...EMPTY_FILTERS, risks: ["low"] })).toBe(true)
    expect(isActive({ ...EMPTY_FILTERS, dateFrom: "2026-06-01" })).toBe(true)
  })
})

describe("query round-trip", () => {
  it("serializes and parses back to an equivalent filter", () => {
    const f: FilterState = {
      infraTypes: ["Equiano Optics", "Equiano IP"], opcoSlugs: ["ghana"],
      statuses: ["pending"], risks: ["high"], dateField: "created",
      dateFrom: "2026-06-01", dateTo: "2026-06-07",
    }
    expect(queryToFilter(filterToQuery(f))).toEqual(f)
  })
  it("drops unknown enum values on parse", () => {
    const parsed = queryToFilter("status=bogus,pending&risk=nope")
    expect(parsed.statuses).toEqual(["pending"])
    expect(parsed.risks).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/lib/dashboard-filters.test.ts`
Expected: FAIL — cannot resolve `@/lib/dashboard-filters` (module not created yet).

- [ ] **Step 3: Implement `dashboard-filters.ts`**

Create `src/lib/dashboard-filters.ts`:

```ts
import type { ChangeStatusName, DashboardChange, RiskLevelName } from "./dashboard-metrics"

export type DateField = "planned" | "created" | "sla"

export interface FilterState {
  infraTypes: string[]
  opcoSlugs: string[]
  statuses: ChangeStatusName[]
  risks: RiskLevelName[]
  dateField: DateField
  dateFrom: string | null // "YYYY-MM-DD", inclusive
  dateTo: string | null // "YYYY-MM-DD", inclusive
}

export const ALL_STATUSES: ChangeStatusName[] =
  ["draft", "pending", "approved", "rejected", "implemented", "verified", "closed", "cancelled"]
export const ALL_RISKS: RiskLevelName[] = ["low", "medium", "high", "emergency"]
const DATE_FIELDS: DateField[] = ["planned", "created", "sla"]

export const EMPTY_FILTERS: FilterState = {
  infraTypes: [], opcoSlugs: [], statuses: [], risks: [],
  dateField: "planned", dateFrom: null, dateTo: null,
}

export function isActive(f: FilterState): boolean {
  return f.infraTypes.length > 0 || f.opcoSlugs.length > 0 || f.statuses.length > 0 ||
    f.risks.length > 0 || f.dateFrom != null || f.dateTo != null
}

function dateValue(c: DashboardChange, field: DateField): string | null {
  if (field === "planned") return c.plannedStart
  if (field === "created") return c.createdAt
  return c.slaDeadline
}

export function applyFilters(changes: DashboardChange[], f: FilterState): DashboardChange[] {
  const fromMs = f.dateFrom ? Date.parse(`${f.dateFrom}T00:00:00`) : null
  const toMs = f.dateTo ? Date.parse(`${f.dateTo}T23:59:59.999`) : null
  return changes.filter((c) => {
    if (f.infraTypes.length && !f.infraTypes.includes(c.infrastructureType)) return false
    if (f.opcoSlugs.length && !f.opcoSlugs.includes(c.opcoSlug)) return false
    if (f.statuses.length && !f.statuses.includes(c.status)) return false
    if (f.risks.length && !f.risks.includes(c.riskLevel)) return false
    if (fromMs != null || toMs != null) {
      const v = dateValue(c, f.dateField)
      if (v == null) return false
      const ms = Date.parse(v)
      if (fromMs != null && ms < fromMs) return false
      if (toMs != null && ms > toMs) return false
    }
    return true
  })
}

export function filterToQuery(f: FilterState): string {
  const p = new URLSearchParams()
  if (f.infraTypes.length) p.set("infra", f.infraTypes.join(","))
  if (f.opcoSlugs.length) p.set("opco", f.opcoSlugs.join(","))
  if (f.statuses.length) p.set("status", f.statuses.join(","))
  if (f.risks.length) p.set("risk", f.risks.join(","))
  if (f.dateFrom || f.dateTo) {
    p.set("df", f.dateField)
    if (f.dateFrom) p.set("from", f.dateFrom)
    if (f.dateTo) p.set("to", f.dateTo)
  }
  return p.toString()
}

export function queryToFilter(qs: string): FilterState {
  const p = new URLSearchParams(qs)
  const list = (k: string) => { const v = p.get(k); return v ? v.split(",").filter(Boolean) : [] }
  const df = p.get("df")
  return {
    infraTypes: list("infra"),
    opcoSlugs: list("opco"),
    statuses: list("status").filter((s): s is ChangeStatusName => (ALL_STATUSES as string[]).includes(s)),
    risks: list("risk").filter((r): r is RiskLevelName => (ALL_RISKS as string[]).includes(r)),
    dateField: DATE_FIELDS.includes(df as DateField) ? (df as DateField) : "planned",
    dateFrom: p.get("from"),
    dateTo: p.get("to"),
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test src/lib/dashboard-filters.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboard-filters.ts src/lib/dashboard-filters.test.ts
git commit -m "feat(dashboard): pure filter predicate + URL round-trip"
```

---

## Task 3: i18n strings for the filter bar and list

**Files:**
- Modify: `src/lib/i18n.ts`

- [ ] **Step 1: Add the English keys**

In `src/lib/i18n.ts`, inside the `en: { ... }` block, alongside the other `"dashboard.*"` keys (before the block closes near `fr: {`), add:

```ts
    "dashboard.filters.infra": "Infra type",
    "dashboard.filters.opco": "OpCo",
    "dashboard.filters.status": "Status",
    "dashboard.filters.risk": "Risk",
    "dashboard.filters.date": "Date",
    "dashboard.filters.planned": "Planned",
    "dashboard.filters.created": "Created",
    "dashboard.filters.sla": "SLA deadline",
    "dashboard.filters.from": "From",
    "dashboard.filters.to": "To",
    "dashboard.filters.clear": "Clear all",
    "dashboard.filters.of": "of",
    "dashboard.list.title": "Matching changes",
    "dashboard.list.empty": "No changes match these filters",
    "dashboard.list.export": "Export CSV",
    "dashboard.list.col.title": "Title",
    "dashboard.list.col.opco": "OpCo",
    "dashboard.list.col.infra": "Infrastructure",
    "dashboard.list.col.risk": "Risk",
    "dashboard.list.col.status": "Status",
    "dashboard.list.col.planned": "Planned",
    "dashboard.list.col.created": "Created",
```

- [ ] **Step 2: Add the French keys**

Inside the `fr: { ... }` block, alongside its `"dashboard.*"` keys, add:

```ts
    "dashboard.filters.infra": "Type d'infra",
    "dashboard.filters.opco": "OpCo",
    "dashboard.filters.status": "Statut",
    "dashboard.filters.risk": "Risque",
    "dashboard.filters.date": "Date",
    "dashboard.filters.planned": "Planifiée",
    "dashboard.filters.created": "Créée",
    "dashboard.filters.sla": "Échéance SLA",
    "dashboard.filters.from": "Du",
    "dashboard.filters.to": "Au",
    "dashboard.filters.clear": "Tout effacer",
    "dashboard.filters.of": "sur",
    "dashboard.list.title": "Changements correspondants",
    "dashboard.list.empty": "Aucun changement ne correspond à ces filtres",
    "dashboard.list.export": "Exporter CSV",
    "dashboard.list.col.title": "Titre",
    "dashboard.list.col.opco": "OpCo",
    "dashboard.list.col.infra": "Infrastructure",
    "dashboard.list.col.risk": "Risque",
    "dashboard.list.col.status": "Statut",
    "dashboard.list.col.planned": "Planifiée",
    "dashboard.list.col.created": "Créée",
```

- [ ] **Step 3: Verify the build**

Run: `pnpm tsc --noEmit`
Expected: clean (no type errors; both language maps have matching keys).

- [ ] **Step 4: Commit**

```bash
git add src/lib/i18n.ts
git commit -m "feat(i18n): dashboard filter + list strings (en/fr)"
```

---

## Task 4: `MultiSelect` checkbox dropdown primitive

**Files:**
- Create: `src/components/dashboard/multi-select.tsx`
- Test: `src/components/dashboard/multi-select.test.tsx`

- [ ] **Step 1: Write the failing smoke test**

Create `src/components/dashboard/multi-select.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@testing-library/react"
import { MultiSelect } from "@/components/dashboard/multi-select"

afterEach(cleanup)

const options = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
]

describe("MultiSelect", () => {
  it("shows a count badge for selected items", () => {
    render(<MultiSelect label="Things" options={options} selected={["a"]} onChange={() => {}} />)
    expect(screen.getByText("1")).toBeInTheDocument()
  })
  it("toggles a value on checkbox change", () => {
    const onChange = vi.fn()
    render(<MultiSelect label="Things" options={options} selected={["a"]} onChange={onChange} />)
    fireEvent.click(screen.getByLabelText("Beta"))
    expect(onChange).toHaveBeenCalledWith(["a", "b"])
  })
  it("removes a value that was already selected", () => {
    const onChange = vi.fn()
    render(<MultiSelect label="Things" options={options} selected={["a", "b"]} onChange={onChange} />)
    fireEvent.click(screen.getByLabelText("Alpha"))
    expect(onChange).toHaveBeenCalledWith(["b"])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/components/dashboard/multi-select.test.tsx`
Expected: FAIL — cannot resolve `@/components/dashboard/multi-select`.

- [ ] **Step 3: Implement `MultiSelect`**

Create `src/components/dashboard/multi-select.tsx`:

```tsx
"use client"

export interface MultiSelectOption { value: string; label: string }

export function MultiSelect({
  label, options, selected, onChange,
}: {
  label: string
  options: MultiSelectOption[]
  selected: string[]
  onChange: (next: string[]) => void
}) {
  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v])

  return (
    <details className="relative">
      <summary className="flex h-9 cursor-pointer list-none items-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm font-medium">
        {label}
        {selected.length > 0 && (
          <span className="rounded-full bg-primary/10 px-1.5 text-xs text-primary tabular-nums">{selected.length}</span>
        )}
      </summary>
      <div className="absolute z-20 mt-1 max-h-64 w-56 overflow-auto rounded-md border border-border bg-card p-1 shadow-md">
        {options.map((o) => (
          <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
            <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
            {o.label}
          </label>
        ))}
      </div>
    </details>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/components/dashboard/multi-select.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/multi-select.tsx src/components/dashboard/multi-select.test.tsx
git commit -m "feat(dashboard): MultiSelect checkbox dropdown primitive"
```

---

## Task 5: `DashboardFilters` bar component

**Files:**
- Create: `src/components/dashboard/dashboard-filters.tsx`

- [ ] **Step 1: Implement the filter bar**

Create `src/components/dashboard/dashboard-filters.tsx`. The OpCo control is hidden when there is ≤1 OpCo in scope. The "N of M" indicator concatenates strings (i18n has no interpolation). `dateField` and date inputs only constrain results once a `from`/`to` is set.

```tsx
"use client"

import { t, type Language } from "@/lib/i18n"
import { MultiSelect } from "./multi-select"
import {
  ALL_RISKS, ALL_STATUSES, EMPTY_FILTERS, isActive,
  type DateField, type FilterState,
} from "@/lib/dashboard-filters"

export function DashboardFilters({
  filters, onChange, infraOptions, opcoOptions, total, matched, language,
}: {
  filters: FilterState
  onChange: (f: FilterState) => void
  infraOptions: string[]
  opcoOptions: { slug: string; name: string }[]
  total: number
  matched: number
  language: Language
}) {
  const set = (patch: Partial<FilterState>) => onChange({ ...filters, ...patch })
  const showOpco = opcoOptions.length > 1

  return (
    <div className="mb-3.5 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2">
      <MultiSelect
        label={t(language, "dashboard.filters.infra")}
        options={infraOptions.map((v) => ({ value: v, label: v }))}
        selected={filters.infraTypes}
        onChange={(v) => set({ infraTypes: v })}
      />
      {showOpco && (
        <MultiSelect
          label={t(language, "dashboard.filters.opco")}
          options={opcoOptions.map((o) => ({ value: o.slug, label: o.name }))}
          selected={filters.opcoSlugs}
          onChange={(v) => set({ opcoSlugs: v })}
        />
      )}
      <MultiSelect
        label={t(language, "dashboard.filters.status")}
        options={ALL_STATUSES.map((v) => ({ value: v, label: v }))}
        selected={filters.statuses}
        onChange={(v) => set({ statuses: v as FilterState["statuses"] })}
      />
      <MultiSelect
        label={t(language, "dashboard.filters.risk")}
        options={ALL_RISKS.map((v) => ({ value: v, label: v }))}
        selected={filters.risks}
        onChange={(v) => set({ risks: v as FilterState["risks"] })}
      />

      <select
        aria-label={t(language, "dashboard.filters.date")}
        value={filters.dateField}
        onChange={(e) => set({ dateField: e.target.value as DateField })}
        className="h-9 rounded-md border border-border bg-card px-2 text-sm"
      >
        <option value="planned">{t(language, "dashboard.filters.planned")}</option>
        <option value="created">{t(language, "dashboard.filters.created")}</option>
        <option value="sla">{t(language, "dashboard.filters.sla")}</option>
      </select>
      <input
        type="date"
        aria-label={t(language, "dashboard.filters.from")}
        value={filters.dateFrom ?? ""}
        onChange={(e) => set({ dateFrom: e.target.value || null })}
        className="h-9 rounded-md border border-border bg-card px-2 text-sm"
      />
      <input
        type="date"
        aria-label={t(language, "dashboard.filters.to")}
        value={filters.dateTo ?? ""}
        onChange={(e) => set({ dateTo: e.target.value || null })}
        className="h-9 rounded-md border border-border bg-card px-2 text-sm"
      />

      <span className="ml-auto text-xs text-muted-foreground tabular-nums">
        {matched} {t(language, "dashboard.filters.of")} {total}
      </span>
      {isActive(filters) && (
        <button
          onClick={() => onChange(EMPTY_FILTERS)}
          className="h-9 rounded-md px-3 text-sm font-medium text-primary hover:bg-muted"
        >
          {t(language, "dashboard.filters.clear")}
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify the build**

Run: `pnpm tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/dashboard-filters.tsx
git commit -m "feat(dashboard): filter bar component"
```

---

## Task 6: `MatchingChangesList` — collapsible sortable table + CSV export

**Files:**
- Create: `src/components/dashboard/matching-changes-list.tsx`

- [ ] **Step 1: Implement the list**

Create `src/components/dashboard/matching-changes-list.tsx`. Collapsed by default via `<details>`; header always shows the count. Sort by clicking a column header. "Export CSV" downloads the current filtered rows client-side.

```tsx
"use client"

import Link from "next/link"
import { useState } from "react"
import { t, type Language } from "@/lib/i18n"
import type { DashboardChange } from "@/lib/dashboard-metrics"

type SortKey = "title" | "opcoName" | "infrastructureType" | "riskLevel" | "status" | "plannedStart" | "createdAt"

function csvEscape(s: string) {
  return `"${s.replace(/"/g, '""')}"`
}
function toCsv(rows: DashboardChange[]): string {
  const header = ["ID", "Title", "OpCo", "Infrastructure", "Risk", "Status", "Planned", "Created"]
  const lines = rows.map((r) =>
    [r.id, r.title, r.opcoName, r.infrastructureType, r.riskLevel, r.status, r.plannedStart ?? "", r.createdAt]
      .map((v) => csvEscape(String(v))).join(","),
  )
  return [header.join(","), ...lines].join("\n")
}
function downloadCsv(rows: DashboardChange[]) {
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `changes-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

const fmtDate = (iso: string | null) => (iso ? iso.slice(0, 10) : "—")

export function MatchingChangesList({
  rows, language,
}: {
  rows: DashboardChange[]
  language: Language
}) {
  const [sortKey, setSortKey] = useState<SortKey>("createdAt")
  const [asc, setAsc] = useState(false)

  const sorted = [...rows].sort((a, b) => {
    const av = String(a[sortKey] ?? "")
    const bv = String(b[sortKey] ?? "")
    return asc ? av.localeCompare(bv) : bv.localeCompare(av)
  })
  const onSort = (k: SortKey) => {
    if (k === sortKey) setAsc(!asc)
    else { setSortKey(k); setAsc(true) }
  }

  const cols: { key: SortKey; label: string }[] = [
    { key: "title", label: t(language, "dashboard.list.col.title") },
    { key: "opcoName", label: t(language, "dashboard.list.col.opco") },
    { key: "infrastructureType", label: t(language, "dashboard.list.col.infra") },
    { key: "riskLevel", label: t(language, "dashboard.list.col.risk") },
    { key: "status", label: t(language, "dashboard.list.col.status") },
    { key: "plannedStart", label: t(language, "dashboard.list.col.planned") },
    { key: "createdAt", label: t(language, "dashboard.list.col.created") },
  ]

  return (
    <details className="mt-3.5 rounded-xl border border-border bg-card">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold">
        <span>{t(language, "dashboard.list.title")} · {rows.length}</span>
        <button
          onClick={(e) => { e.preventDefault(); downloadCsv(sorted) }}
          disabled={rows.length === 0}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
        >
          {t(language, "dashboard.list.export")}
        </button>
      </summary>
      {rows.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted-foreground">{t(language, "dashboard.list.empty")}</p>
      ) : (
        <div className="overflow-x-auto px-2 pb-2">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                {cols.map((c) => (
                  <th key={c.key} className="px-2 py-2">
                    <button onClick={() => onSort(c.key)} className="font-medium hover:text-foreground">
                      {c.label}{sortKey === c.key ? (asc ? " ▲" : " ▼") : ""}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.id} className="border-b border-border/50 hover:bg-muted/50">
                  <td className="px-2 py-2">
                    <Link href={`/changes/${r.id}`} className="text-primary hover:underline">{r.title}</Link>
                  </td>
                  <td className="px-2 py-2">{r.opcoName}</td>
                  <td className="px-2 py-2">{r.infrastructureType}</td>
                  <td className="px-2 py-2">{r.riskLevel}</td>
                  <td className="px-2 py-2">{r.status}</td>
                  <td className="px-2 py-2 tabular-nums">{fmtDate(r.plannedStart)}</td>
                  <td className="px-2 py-2 tabular-nums">{fmtDate(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  )
}
```

- [ ] **Step 2: Verify the build**

Run: `pnpm tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/matching-changes-list.tsx
git commit -m "feat(dashboard): matching-changes list with sort + CSV export"
```

---

## Task 7: Wire filters into the dashboard (client + page) and extend the test

**Files:**
- Modify: `src/app/dashboard-client.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/app/dashboard-client.test.tsx`

- [ ] **Step 1: Rework `dashboard-client.tsx` props and derivation**

Replace the imports + props interface + component body of `src/app/dashboard-client.tsx` with the version below. Changes: drop the prebuilt `data` prop in favor of `changes` + `now` (+ option lists); hold `filters` state; derive `data` via `useMemo`; persist to localStorage + URL; render the filter bar above the tabs and the list below the active view.

```tsx
"use client"

import { useEffect, useMemo, useState } from "react"
import { LayoutGrid, ListChecks, ChartBar } from "lucide-react"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import { buildDashboardData, type DashboardChange } from "@/lib/dashboard-metrics"
import { applyFilters, EMPTY_FILTERS, filterToQuery, isActive, queryToFilter, type FilterState } from "@/lib/dashboard-filters"
import { StatusBar } from "@/components/dashboard/status-bar"
import { DashboardFilters } from "@/components/dashboard/dashboard-filters"
import { MatchingChangesList } from "@/components/dashboard/matching-changes-list"
import { MonitorView, type FeedEvent } from "@/components/dashboard/monitor-view"
import { TriageView } from "@/components/dashboard/triage-view"
import { ReportView } from "@/components/dashboard/report-view"

type TabKey = "monitor" | "triage" | "report"

export interface DashboardProps {
  changes: DashboardChange[]
  now: number
  infraOptions: string[]
  opcoOptions: { slug: string; name: string }[]
  blackouts: { id: string; label: string; scope: string; endsIn: string; amber: boolean }[]
  feed: FeedEvent[]
  blackoutCount: number
}

const FILTERS_KEY = "csq-dashboard-filters"

export default function DashboardClient({ changes, now, infraOptions, opcoOptions, blackouts, feed, blackoutCount }: DashboardProps) {
  const { language } = useStore()
  const [tab, setTab] = useState<TabKey>("triage")
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS)

  // Restore tab + filters AFTER mount so SSR and first client render match (no hydration
  // mismatch). URL query wins over localStorage so shared links reproduce a filtered view.
  useEffect(() => {
    const savedTab = localStorage.getItem("csq-dashboard-tab")
    if (savedTab === "monitor" || savedTab === "triage" || savedTab === "report") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTab(savedTab)
    }
    const qs = window.location.search.replace(/^\?/, "")
    const fromUrl = qs ? queryToFilter(qs) : null
    if (fromUrl && isActive(fromUrl)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFilters(fromUrl)
      return
    }
    const savedFilters = localStorage.getItem(FILTERS_KEY)
    if (savedFilters) {
      try {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setFilters({ ...EMPTY_FILTERS, ...JSON.parse(savedFilters) })
      } catch { /* ignore malformed stored filters */ }
    }
  }, [])

  const select = (k: TabKey) => { setTab(k); localStorage.setItem("csq-dashboard-tab", k) }

  const changeFilters = (f: FilterState) => {
    setFilters(f)
    localStorage.setItem(FILTERS_KEY, JSON.stringify(f))
    const qs = filterToQuery(f)
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname)
  }

  const filtered = useMemo(() => applyFilters(changes, filters), [changes, filters])
  const data = useMemo(() => buildDashboardData(filtered, now), [filtered, now])

  const triageCount = data.triage.overdue.length + data.triage.awaiting.length + data.triage.advance.length

  return (
    <div>
      <StatusBar counts={data.counts} blackouts={blackoutCount} language={language} />

      <DashboardFilters
        filters={filters}
        onChange={changeFilters}
        infraOptions={infraOptions}
        opcoOptions={opcoOptions}
        total={changes.length}
        matched={filtered.length}
        language={language}
      />

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
          <ChartBar className="h-4 w-4" /> {t(language, "dashboard.tab.report")}
        </TabButton>
      </div>

      {tab === "monitor" && <MonitorView data={data} blackouts={blackouts} feed={feed} language={language} />}
      {tab === "triage" && <TriageView data={data} language={language} />}
      {tab === "report" && <ReportView data={data} language={language} />}

      <MatchingChangesList rows={filtered} language={language} />
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

- [ ] **Step 2: Update `page.tsx` to pass the new props**

In `src/app/page.tsx`, replace the `const data = buildDashboardData(changes, now)` line and the final `return` with code that derives the option lists and passes `changes` + `now` instead of `data`. (The `buildDashboardData` import is no longer used in `page.tsx` — remove it from the import on line 6, leaving `durLabel` and `type DashboardChange`.)

```ts
  const infraOptions = [...new Set(changes.map((c) => c.infrastructureType))].sort()
  const opcoOptions = [...new Map(changes.map((c) => [c.opcoSlug, c.opcoName])).entries()]
    .map(([slug, name]) => ({ slug, name }))
    .sort((a, b) => a.name.localeCompare(b.name))
```

Update the import line 6 to:

```ts
import { durLabel, type DashboardChange } from "@/lib/dashboard-metrics"
```

And the final return:

```tsx
  return (
    <DashboardClient
      changes={changes}
      now={now}
      infraOptions={infraOptions}
      opcoOptions={opcoOptions}
      blackouts={blackouts}
      feed={feed}
      blackoutCount={blackouts.length}
    />
  )
```

- [ ] **Step 3: Update + extend `dashboard-client.test.tsx`**

In `src/app/dashboard-client.test.tsx`, replace the `props` object (it referenced the removed `data` prop) and the import line. Remove `buildDashboardData` from the import; keep `type DashboardChange`. Replace `props`:

```ts
import { type DashboardChange } from "@/lib/dashboard-metrics"
```

Also harden test isolation — the component persists filters/tab to `localStorage` and restores them on mount, so clear it between tests. Replace `afterEach(cleanup)` with:

```ts
afterEach(() => { cleanup(); localStorage.clear() })
```

```ts
const props = {
  changes,
  now,
  infraOptions: [...new Set(changes.map((c) => c.infrastructureType))].sort(),
  opcoOptions: [...new Map(changes.map((c) => [c.opcoSlug, c.opcoName])).entries()]
    .map(([slug, name]) => ({ slug, name })),
  blackouts: [{ id: "b1", label: "Year-end freeze", scope: "Group", endsIn: "2d", amber: false }],
  feed: [{ id: "f1", changeId: "CHG-1", label: "submitted", actor: "S. Nakato", ago: "8m ago", tone: "bg-amber-500" }],
  blackoutCount: 1,
}
```

Then add a filter-narrowing test (the matching list count reflects the active filter). The `risk` MultiSelect renders a checkbox labelled `emergency`; only CHG-4 is emergency:

```ts
  it("narrows the matching list when a risk filter is applied", () => {
    render(<DashboardClient {...props} />)
    // Collapsed list header shows the full count first.
    expect(screen.getByText("Matching changes · 5")).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText("emergency"))
    expect(screen.getByText("Matching changes · 1")).toBeInTheDocument()
  })
```

- [ ] **Step 4: Run the full dashboard test suite + type-check**

Run: `pnpm tsc --noEmit && pnpm test src/app/dashboard-client.test.tsx src/lib/dashboard-filters.test.ts src/components/dashboard/multi-select.test.tsx`
Expected: tsc clean; all tests PASS (3 existing DashboardClient + 1 new + filter lib + MultiSelect).

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard-client.tsx src/app/page.tsx src/app/dashboard-client.test.tsx
git commit -m "feat(dashboard): wire filter bar + matching list into the dashboard"
```

---

## Task 8: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the entire test suite + lint + type-check**

Run: `pnpm tsc --noEmit && pnpm lint && pnpm test`
Expected: type-check clean, lint clean, all suites green (the integration Testcontainers test may fail/skip if Docker isn't running — that is pre-existing and unrelated).

- [ ] **Step 2: Manual smoke (dev server)**

Run `pnpm dev`, sign in, and on the dashboard:
- Confirm the filter bar appears under the StatusBar.
- Select two infra types (e.g. Equiano Optics + Equiano IP) → tiles/charts/StatusBar and the "N of M" count narrow.
- Set a date range with the date-field set to "Created" → results narrow accordingly.
- As a group-level user, confirm the OpCo control is present; as a single-OpCo user, confirm it is hidden.
- Expand "Matching changes", sort a column, click "Export CSV" → a `changes-YYYY-MM-DD.csv` downloads with the visible rows.
- Reload the page → the filter persists (URL query + localStorage); copy the URL to a new tab → the same filtered view loads.
- Click "Clear all" → returns to the full dashboard and the URL query clears.
```
