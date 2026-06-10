# Dashboard Filters — Design

**Date:** 2026-06-10
**Status:** Approved (pending spec review)

## Goal

Let users narrow the dashboard to a slice of changes — by infrastructure type, OpCo,
status, risk, and a date range — and both (a) re-scope every aggregate view to that slice
and (b) see the flat list of matching changes underneath. Example use: "all Equiano
changes in Ghana that were pending last week."

## Decisions

- **Both views, one filter:** a persistent filter bar re-scopes all three tabs
  (Monitor / Triage / Report) AND drives a collapsible "Matching changes" list section
  rendered beneath the active tab's aggregate content. No new tab.
- **Fields (all multi-select except date):**
  - Infra type — multi-select (so "Equiano Optics + Equiano IP" = all Equiano in one shot)
  - OpCo — multi-select; **hidden for single-OpCo users** (only meaningful for group-level)
  - Status — multi-select
  - Risk — multi-select
  - Date — a **date-field selector** (Planned start / Created / SLA deadline) + a from/to range
- **Filter logic:** OR within a field, AND across fields.
- **Top StatusBar reflects the filter** (everything narrows consistently — no separate
  unfiltered total).
- **CSV export** of the matching list is in for v1.

## Architecture — client-side filtering

`src/app/page.tsx` already loads every in-scope change (permission-scoped by OpCo) and maps
to `DashboardChange[]`, from which `buildDashboardData()` derives all three tabs. We filter
client-side over that already-loaded array rather than refetching:

- **`page.tsx`** — add `infrastructureType` and `createdAt` to the Prisma `select` and to the
  `DashboardChange` mapping; **pass the raw `DashboardChange[]` to the client** (today only the
  derived `DashboardData` is passed). Also pass the option lists the bar needs: the distinct
  OpCos in scope and the infra-type list.
- **`dashboard-client.tsx`** — holds `FilterState`; a `useMemo` computes
  `applyFilters(changes, filters, now)` → `filtered[]`, then `buildDashboardData(filtered, now)`
  feeds Monitor/Triage/Report and the StatusBar; the same `filtered[]` feeds the list.

**Why client-side:** instant (no round-trips), data is already loaded, demo-friendly. Trade-off:
all in-scope rows ship to the client — acceptable at this scale (scoped dashboards, low hundreds
of rows). If it outgrows that, the predicate moves server-side behind URL params with no UI change.

## Data model additions

`DashboardChange` (in `src/lib/dashboard-metrics.ts`) gains:

```ts
infrastructureType: string   // plain column on ChangeRequest
createdAt: string            // ISO; plain column on ChangeRequest
```

Both are existing plain columns — no JSON digging. `opcoName` / `opcoSlug` / `slaDeadline` /
`plannedStart` are already present.

## Components

### `src/lib/dashboard-filters.ts` (pure, unit-tested)

```ts
export type DateField = "planned" | "created" | "sla"
export interface FilterState {
  infraTypes: string[]
  opcoSlugs: string[]
  statuses: ChangeStatusName[]
  risks: RiskLevelName[]
  dateField: DateField
  dateFrom: string | null   // ISO date (inclusive, start of day)
  dateTo: string | null     // ISO date (inclusive, end of day)
}
export const EMPTY_FILTERS: FilterState
export function applyFilters(changes: DashboardChange[], f: FilterState): DashboardChange[]
export function isActive(f: FilterState): boolean      // any field set?
export function filterToQuery(f: FilterState): string  // URLSearchParams string
export function queryToFilter(qs: string): FilterState // parse back on mount
```

- Empty array for a field ⇒ that field is unconstrained (matches all).
- Date filter: a change matches if its chosen date field is non-null and falls within
  [dateFrom 00:00, dateTo 23:59:59]. A null date on the chosen field ⇒ excluded only when a
  date range is set.

### `DashboardFilters` component (the bar)

- Renders under the StatusBar, above the tab strip.
- Multi-select dropdowns for infra / OpCo / status / risk, surfaced as removable chips.
- Date-field dropdown + from/to date inputs (native `<input type="date">`).
- "Clear all" button; a live "**N of M**" count.
- OpCo control hidden when the user has ≤1 OpCo in scope.

### `MatchingChangesList` component

- Collapsible "Matching changes · N" section (collapsed by default) beneath the tab content.
- Sortable table: title, OpCo, infra type, risk, status, planned start, created.
- Each row links to `/changes/[id]`.
- "Export CSV" button — client-side Blob download of the current `filtered[]` (all visible
  columns), filename `changes-<yyyy-mm-dd>.csv`.
- Empty state: "No changes match these filters · Clear".

## State & shareability

- Filter state in React (`useState<FilterState>`).
- Persisted to `localStorage` under `csq-dashboard-filters` (mirrors existing
  `csq-dashboard-tab`).
- Reflected in the URL query string via `history.replaceState`, read back from
  `window.location.search` on mount (`queryToFilter`) — a filtered view is a shareable link,
  still with no server round-trip. localStorage is the fallback when no query string is present.

## Data flow

```
page.tsx (all in-scope DashboardChange[])
  └─> DashboardClient
        ├─ filters (state) ──> applyFilters() ──> filtered[]
        │                                            ├─> buildDashboardData(filtered) ─> StatusBar + Monitor/Triage/Report
        │                                            └─> MatchingChangesList (+ CSV export)
        └─ DashboardFilters (edits filters; option lists from props)
```

## Testing

- **`src/lib/dashboard-filters.test.ts`** — `applyFilters` per field; OR-within / AND-across;
  date-field switching (planned vs created vs sla); date boundary inclusivity; null-date
  exclusion when a range is set; `isActive`; round-trip `filterToQuery`/`queryToFilter`.
- **Extend `src/app/dashboard-client.test.tsx`** — filter bar renders; selecting a filter
  narrows the rendered StatusBar counts; "Matching changes" count matches.

## Out of scope (YAGNI)

- Server-side pagination / filtering.
- Saved filter presets / named views.
- Anything beyond CSV for export.
