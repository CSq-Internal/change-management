# Responsive Design — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended here — verification is Playwright-at-mobile-viewport driven by the orchestrator) or superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the admin/settings pages usable on 360–390px phones by converting all 11 data tables to a shared stacked-card pattern and stacking the remaining multi-column grids — desktop unchanged.

**Architecture:** One global CSS recipe (`.responsive-table`) turns any standard `<table>` into labeled stacked cards below `sm` (640px) and leaves the real table at `sm`+. Each table opts in by adding the `responsive-table` class and a `data-label` on every `<td>`. No per-table component rewrite, no new dependency.

**Tech Stack:** Next.js 16 App Router, Tailwind CSS + a small plain-CSS block in `globals.css` (uses `content: attr(data-label)` which Tailwind can't express ergonomically), Playwright MCP for viewport verification, Vitest for the existing suite.

---

## Spec

`docs/superpowers/specs/2026-06-12-responsive-design-design.md` (Phase 2 sections: tables→stacked cards, remaining grids).

## Key facts (verified)

- The 11 `<table>` files (all follow `thead>th` + `tbody>tr>td`):
  1. `src/app/(dashboard)/opcos/opco-list.tsx` — cols: Name, Slug, Status, (actions)
  2. `src/app/(dashboard)/teams/team-list.tsx`
  3. `src/app/(dashboard)/cab/cab-table.tsx`
  4. `src/app/(dashboard)/delegations/delegation-list.tsx`
  5. `src/app/(dashboard)/admin-audit/audit-list.tsx`
  6. `src/app/(dashboard)/audits/audits-client.tsx`
  7. `src/app/(dashboard)/risk-register/risk-register-client.tsx`
  8. `src/app/(dashboard)/reports/reports-client.tsx` (the "SLA compliance" table)
  9. `src/app/(dashboard)/settings/integrations/integrations-client.tsx`
  10. `src/app/(dashboard)/settings/notifications/notifications-prefs-client.tsx`
  11. `src/components/dashboard/matching-changes-list.tsx` (dynamic `cols` array; cells include a `<Link>`)
- Tables wrap in `<Card><CardContent>`; cells contain plain text, `<Link>`s, badges, and action-button `<div>`s — all handled by the recipe (value sits on the right of each `label: value` row).
- Theme CSS vars available in `globals.css`: `--border`, `--muted-foreground`.
- Overflow gate (Playwright `browser_evaluate`): `() => document.documentElement.scrollWidth - window.innerWidth` → expect `<= 1`.
- Non-table grids to check: `approval-matrix/page.tsx`, `reports/reports-client.tsx`, `settings/profile/page.tsx` (profile already uses `md:grid-cols-2`, so it stacks; verify).

## Pre-flight (orchestrator)

Dev server on the **local** stack (`Environments: .env.local, .env`), Docker up, logged in as `devops@csquared.com` / `Admin2025$`. Playwright `browser_resize` 390×844.

---

## Task 1: Shared `.responsive-table` recipe + opcos template

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/app/(dashboard)/opcos/opco-list.tsx`

- [ ] **Step 1: Add the CSS recipe**

Append to `src/app/globals.css`:
```css
/* Responsive tables: below sm (640px), render each row as a labeled stacked card. */
@media (max-width: 639px) {
  table.responsive-table thead {
    display: none;
  }
  table.responsive-table,
  table.responsive-table tbody,
  table.responsive-table tr,
  table.responsive-table td {
    display: block;
    width: 100%;
  }
  table.responsive-table tr {
    margin-bottom: 0.625rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    padding: 0.25rem 0.75rem;
  }
  table.responsive-table tr:last-child {
    margin-bottom: 0;
  }
  table.responsive-table td {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    border: 0;
    padding: 0.4rem 0;
    text-align: right;
  }
  table.responsive-table td::before {
    content: attr(data-label);
    margin-right: auto;
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--muted-foreground);
    text-align: left;
  }
  table.responsive-table td[data-label=""]::before,
  table.responsive-table td:not([data-label])::before {
    content: none;
  }
}
```

- [ ] **Step 2: Apply to the opcos table (worked template)**

In `src/app/(dashboard)/opcos/opco-list.tsx`:
- Change `<table className="w-full text-sm">` → `<table className="responsive-table w-full text-sm">`.
- Add a `data-label` to each `<td>` matching its column header:
  - name cell: `<td className="px-4 py-2 font-medium" data-label={t(language, "opcosAdmin.colName")}>{o.name}</td>`
  - slug cell: `<td className="px-4 py-2" data-label={t(language, "opcosAdmin.colSlug")}>{o.slug}</td>`
  - status cell: `<td className="px-4 py-2" data-label={t(language, "opcosAdmin.colStatus")}>…</td>`
  - actions cell: `<td className="px-4 py-2" data-label="">…</td>`

- [ ] **Step 3: Verify in the browser (the template proof)**

Playwright at 390px → `/opcos`. Expect: each OpCo row is a card with `Name: …`, `Slug: …`, `Status: …` rows and the Rename/Archive buttons; NO wide table; overflow `<= 1`. Then `browser_resize` 1280 → reload: the real table is back with a header row. Screenshot both.

- [ ] **Step 4: Type-check & lint**

`pnpm tsc --noEmit && pnpm exec eslint "src/app/(dashboard)/opcos/opco-list.tsx"` → tsc clean, 0 eslint errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/globals.css "src/app/(dashboard)/opcos/opco-list.tsx"
git commit -m "feat(responsive): shared .responsive-table recipe + opcos stacked cards"
```

---

## Task 2: Apply the recipe to the remaining 10 tables

The transformation is identical and deterministic for each file: **(a)** add `responsive-table` to the file's `<table>` className; **(b)** for every `<td>`, add `data-label="<that column's header text>"` — the header text is the `<th>` content in the same column position (use the same `t(language, "…")` call the `<th>` uses); **(c)** for an actions/checkbox/icon cell with no meaningful header, use `data-label=""`. Use the opcos result from Task 1 as the reference.

Per-file notes (read each file's own `thead`/`cols` for the exact labels):
- `team-list.tsx`, `cab-table.tsx`, `delegation-list.tsx`, `admin-audit/audit-list.tsx`, `audits/audits-client.tsx`, `risk-register/risk-register-client.tsx`, `reports/reports-client.tsx` (SLA-compliance table only), `settings/integrations/integrations-client.tsx`, `settings/notifications/notifications-prefs-client.tsx` — straightforward `th`→`td` label mapping.
- `src/components/dashboard/matching-changes-list.tsx` — columns come from the `cols` array (`title, opcoName, infrastructureType, riskLevel, status, plannedStart, createdAt`). Set each `<td>`'s `data-label` to the matching `cols[i].label` value, e.g. `data-label={t(language, "dashboard.list.col.title")}`, etc. Keep the existing `overflow-x-auto` wrapper (harmless — cards won't overflow). Leave the `<Link>` inside the title cell unchanged.

- [ ] **Step 1: Transform all 10 files** (apply (a)/(b)/(c) above to each).

- [ ] **Step 2: Type-check & lint**

`pnpm tsc --noEmit && pnpm lint` → tsc clean, 0 eslint errors.

- [ ] **Step 3: Verify each table page at 390px**

Playwright at 390px, visit each: `/teams`, `/cab`, `/delegations`, `/admin-audit`, `/audits`, `/risk-register`, `/reports`, `/settings/integrations`, `/settings/notifications`, and `/` (open the "Matching changes" `<details>`). For each: rows render as labeled cards, `overflow <= 1`. Spot-screenshot 2–3 (e.g. `/cab`, `/risk-register`, `/settings/notifications`).

- [ ] **Step 4: Desktop regression**

`browser_resize` 1280; reload 2–3 of the above; confirm real tables with header rows, `overflow <= 1`.

- [ ] **Step 5: Commit**

```bash
git add <the 10 changed files>
git commit -m "feat(responsive): stacked-card tables across admin, settings, and dashboard list"
```

---

## Task 3: Remaining non-table grids

**Files (only where a fix is needed):**
- `src/app/(dashboard)/approval-matrix/page.tsx`
- `src/app/(dashboard)/reports/reports-client.tsx`
- `src/app/(dashboard)/settings/profile/page.tsx`

- [ ] **Step 1: Measure at 360px and 390px**

Playwright, for `/approval-matrix`, `/reports`, `/settings/profile`, run:
```js
() => {
  const vw = window.innerWidth
  const spill = [...document.querySelectorAll('main *')].filter(el => { const r = el.getBoundingClientRect(); return r.right > vw + 1 && r.width > 40 }).length
  return { overflow: document.documentElement.scrollWidth - vw, spill }
}
```
Record pages with `overflow > 1` or `spill > 0`.

- [ ] **Step 2: Fix offenders with the minimal additive recipe**

- A multi-column grid that stays wide → ensure it is 1 column below `sm`: a grid with `md:grid-cols-2` already stacks; one with an unprefixed `grid-cols-N` needs the count moved behind a breakpoint (e.g. `grid-cols-1 sm:grid-cols-2`).
- A grid/flex child that spills by its content min-width → add `min-w-0` to that child (same fix used on the request form in Phase 1).
- A genuinely wide inline block (rare) → wrap in `<div className="overflow-x-auto">`.

Keep every change additive (`sm:`/`md:` or `min-w-0`) so desktop is untouched. Re-measure after each.

- [ ] **Step 3: Re-measure + desktop regression**

All three pages return `overflow <= 1` and `spill 0` at 360px and 390px; reload at 1280px and confirm unchanged.

- [ ] **Step 4: Commit (only if changes were made)**

```bash
git add <changed files>
git commit -m "fix(responsive): stack remaining admin/settings grids on phones"
```
If Step 1 showed all three already passing, record it and skip the commit.

---

## Task 4: Phase 2 final verification

**Files:** none (verification only)

- [ ] **Step 1: Overflow gate across all Phase 2 pages**

Playwright at **360px** and **390px**, for each of `/opcos`, `/teams`, `/cab`, `/delegations`, `/admin-audit`, `/audits`, `/risk-register`, `/reports`, `/approval-matrix`, `/settings/integrations`, `/settings/notifications`, `/settings/profile`, run:
```js
() => document.documentElement.scrollWidth - window.innerWidth
```
Expected: `<= 1` everywhere.

- [ ] **Step 2: Visual spot-check**

390px screenshots of a representative few (`/cab`, `/risk-register`, `/reports`, `/settings/notifications`); confirm cards are readable and labels render.

- [ ] **Step 3: Test suite + static checks**

`pnpm test && pnpm tsc --noEmit && pnpm lint` → tests pass (Docker up → integration suites included), tsc clean, eslint 0 errors.

- [ ] **Step 4: Stop the dev server & clean up**

Stop `pnpm dev`; remove screenshot artifacts; confirm `git status` shows only intended changes (and the always-untracked `docs/CSquared-CMS-Project-Workplan.xlsx`).

---

## Self-review notes

- **Spec coverage:** all 11 tables → stacked cards (Tasks 1–2) ✓; shared/DRY pattern, not bespoke per table (Task 1 recipe) ✓; remaining grids stack (Task 3) ✓; no-overflow gate at 360/390 (Tasks 1–4) ✓; desktop unchanged regression (Tasks 1–4) ✓; suite green (Task 4) ✓.
- **No placeholders:** Task 2's transformation is a precise, deterministic algorithm (add class; `data-label` = the column's own `<th>` label; empty for action cells), fully demonstrated on opcos in Task 1 — the per-table labels live in each file's `thead`, which is the source of truth (repeating all 11 tables' markup would be noise).
- **Consistency:** the `responsive-table` class name and `data-label` attribute are used identically in the CSS recipe (Task 1) and every table (Tasks 1–2).
