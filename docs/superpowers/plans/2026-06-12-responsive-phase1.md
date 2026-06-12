# Responsive Design — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. NOTE: verification here is **Playwright-at-mobile-viewport driven by the orchestrator** (it needs the running dev server + a logged-in browser session), so inline execution by the orchestrator is recommended over delegating verification to subagents.

**Goal:** Eliminate horizontal overflow app-wide via a one-line shell fix, and make the client-facing core flow (dashboard, request form, change detail, approvals, calendar) usable on 360–390px phones — desktop unchanged.

**Architecture:** The overflow is a flexbox `min-width:auto` trap in `AppShell`: the main content column won't shrink below its content, so it balloons to ~2456px on a 390px screen. Adding `min-w-0` + `overflow-x-clip` to that column lets it collapse to the viewport, after which the existing `flex-wrap`/`lg:grid-cols` content reflows. The only net-new UI is a mobile **agenda** view for the Calendar (the 7-column month grid is unusable at phone width).

**Tech Stack:** Next.js 16 App Router, Tailwind CSS (breakpoints `sm`=640px content boundary, `lg`=1024px shell-nav boundary), Playwright MCP for viewport verification, Vitest for the existing suite.

---

## Spec

`docs/superpowers/specs/2026-06-12-responsive-design-design.md`

## Key facts (verified)

- Culprit: `src/components/app-shell.tsx:303` — `<div className="flex flex-1 flex-col">` measures **2456px** inside a 390px parent. `main` (line ~524) is `mx-auto w-full max-w-6xl flex-1 px-4 py-8` + `lg:pl-72`/`lg:pl-20`; `w-full` already lets it shrink **once the parent can**.
- Already responsive (no change needed, just verify): request form root grid `grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] sm:grid-cols-1` (stacks below `lg`); change-detail root grid `grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]` (stacks below `lg`); dashboard filter bar `flex flex-wrap` (wraps); dashboard tabs `flex` with `flex-1` buttons.
- Calendar month grid: `grid grid-cols-7` of `min-h-24` cells — unusable at 390px. Component: `src/app/(dashboard)/calendar/calendar-client.tsx`; it already builds `chipsByDay` (Map<dayKey, CalChipData[]>, each sorted by `startMs`).
- Overflow gate (run in the browser via Playwright `browser_evaluate`):
  ```js
  () => document.documentElement.scrollWidth - window.innerWidth   // expect <= 1
  ```

## Pre-flight (orchestrator, once before Task 1)

Ensure the dev server runs against the **local** stack and you have a logged-in mobile session:
- `.env.local` (local Postgres/Keycloak) must be present; `pnpm dev` must log `Environments: .env.local, .env`. Docker (Keycloak :8080 + Postgres :5432) running. (Do NOT remove `.env.local` — `.env` is production.)
- In Playwright: `browser_resize` to 390×844, navigate to `http://localhost:3000/`, sign in as `devops@csquared.com` / `Admin2025$` if redirected to login.

---

## Task 1: Systemic shell fix (fixes overflow app-wide)

**Files:**
- Modify: `src/components/app-shell.tsx:303`

- [ ] **Step 1: Measure the overflow (red)**

With Playwright at 390px on `http://localhost:3000/`, run `browser_evaluate`:
```js
() => ({ overflow: document.documentElement.scrollWidth - window.innerWidth, column: document.querySelector('.flex.flex-1.flex-col')?.getBoundingClientRect().width })
```
Expected (before fix): `overflow` ≈ 2066 (2456 − 390), `column` ≈ 2456. This confirms the trap.

- [ ] **Step 2: Apply the fix**

In `src/components/app-shell.tsx`, change line 303 from:
```tsx
        <div className="flex flex-1 flex-col">
```
to:
```tsx
        <div className="flex flex-1 flex-col min-w-0 overflow-x-clip">
```
(`min-w-0` defeats the flex min-content trap; `overflow-x-clip` is a safety net against any stray wide child.)

- [ ] **Step 3: Verify the overflow is gone (green)**

Reload `http://localhost:3000/` at 390px, run:
```js
() => document.documentElement.scrollWidth - window.innerWidth
```
Expected: `<= 1`. Also re-check `column` width ≈ 390.

- [ ] **Step 4: Desktop regression**

`browser_resize` to 1280×800, reload `/`. Confirm the dashboard looks unchanged (sidebar at left, centered `max-w-6xl` content). Overflow check returns `<= 1`.

- [ ] **Step 5: Commit**

```bash
git add src/components/app-shell.tsx
git commit -m "fix(responsive): defuse flexbox min-width trap so content fits the viewport"
```

---

## Task 2: Calendar mobile agenda view

**Files:**
- Modify: `src/app/(dashboard)/calendar/calendar-client.tsx`
- Modify: `src/lib/i18n.ts` (add `calendar.empty` en/fr)

- [ ] **Step 1: Add the empty-state i18n key (en + fr)**

In `src/lib/i18n.ts`, after the English `"calendar.today": ...` line, add:
```ts
    "calendar.empty": "No scheduled changes this month.",
```
After the French `"calendar.today": ...` line, add:
```ts
    "calendar.empty": "Aucun changement planifie ce mois-ci.",
```
(If the exact `calendar.today` key name differs, place these next to the other `calendar.*` keys in each language block.)

- [ ] **Step 2: Hide the month grid on phones**

In `calendar-client.tsx`, the month-grid `<Card className="border-border/80 bg-card/95">` (≈ line 84) becomes:
```tsx
      <Card className="hidden border-border/80 bg-card/95 sm:block">
```

- [ ] **Step 3: Add the agenda list (mobile only)**

Immediately AFTER that `</Card>` (the month-grid card, ≈ line 127) and BEFORE the closing `</div>` of the root container, insert:
```tsx
      {/* Mobile agenda: chronological list of this month's changes (the 7-col grid is unusable at phone width) */}
      <div className="space-y-4 sm:hidden">
        {agenda.length === 0 ? (
          <Card className="border-border/80 bg-card/95">
            <CardContent className="p-4 text-sm text-muted-foreground">{t(language, "calendar.empty")}</CardContent>
          </Card>
        ) : (
          agenda.map(([dayKey, dayChips]) => (
            <div key={dayKey} className="space-y-2">
              <h2 className="text-sm font-semibold text-muted-foreground">{formatDayLabel(dayKey, language)}</h2>
              <div className="space-y-1.5">
                {dayChips.map((chip) => (
                  <Link
                    key={chip.id}
                    href={`/changes/${chip.id}`}
                    className="block rounded-md border border-border bg-card p-2.5 hover:bg-muted/40"
                  >
                    <div className="flex items-center gap-2 text-sm">
                      {chip.blackout && <span title={t(language, "calendar.conflict.blackout")}>🚫</span>}
                      {chip.overlap && <span title={t(language, "calendar.conflict.overlap")}>⚠</span>}
                      <span className="font-medium">{chip.title}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {chip.timeLabel} · {chip.opcoName}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
```

- [ ] **Step 4: Add the `agenda` list and `formatDayLabel` helper**

In `calendar-client.tsx`, immediately AFTER the existing `for (const arr of chipsByDay.values()) arr.sort(...)` line (≈ line 44), add:
```tsx
  const agenda = [...chipsByDay.entries()].sort(([a], [b]) => a.localeCompare(b))
```
And add this module-scope helper near the top of the file (after the `WEEKDAYS` const, ≈ line 25):
```tsx
function formatDayLabel(key: string, language: string): string {
  const [y, m, d] = key.split("-").map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(language === "fr" ? "fr-FR" : "en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
}
```

- [ ] **Step 5: Type-check & lint**

Run: `pnpm tsc --noEmit && pnpm exec eslint "src/app/(dashboard)/calendar/calendar-client.tsx"`
Expected: tsc clean; eslint 0 errors.

- [ ] **Step 6: Verify in the browser**

Playwright at 390px → `http://localhost:3000/calendar`. Expect: NO 7-column grid; an agenda list grouped by day (e.g. the existing change on the 5th shows as a row with time + title + OpCo). Overflow check `<= 1`. Then `browser_resize` 1280 → reload: the month grid is back and the agenda is hidden.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(dashboard)/calendar/calendar-client.tsx" src/lib/i18n.ts
git commit -m "feat(responsive): mobile agenda view for the calendar"
```

---

## Task 3: Core-flow verification sweep + spot fixes

Most of these already use responsive grids; this task **measures each at 360px and 390px** and fixes only what still overflows, using the recipes below.

**Files (only if a fix is needed):**
- `src/app/dashboard-client.tsx`, `src/components/dashboard/*`
- `src/app/(dashboard)/requests/request-form.tsx`
- `src/app/(dashboard)/changes/[id]/change-detail-client.tsx`
- `src/app/(dashboard)/approvals/*`

- [ ] **Step 1: Measure each core page at 390px and 360px**

For each URL, Playwright `browser_resize` (390×844, then 360×800), navigate, and run:
```js
() => {
  const vw = window.innerWidth
  const wide = [...document.querySelectorAll('main *')]
    .map((el) => ({ w: Math.round(el.getBoundingClientRect().width), cls: (el.className||'').toString().slice(0,70), tag: el.tagName.toLowerCase() }))
    .filter((x) => x.w > vw + 4)
    .sort((a, b) => b.w - a.w)
  return { overflow: document.documentElement.scrollWidth - vw, worst: wide.slice(0, 5) }
}
```
URLs: `/` (dashboard — also click the Monitor/Triage/Report tabs), `/requests`, `/changes/<id>` (any id from `/changes`), `/approvals`.
Record which pages return `overflow > 1` and the `worst` offenders.

- [ ] **Step 2: Apply the matching fix recipe to each offender**

Use the smallest fix that clears the overflow; re-measure after each:
- **A flex row that won't wrap** → add `flex-wrap` (and `min-w-0` on flex children holding text/inputs).
- **A multi-column grid that stays wide** → add `sm:grid-cols-N` so it is 1 column below `sm` (default `grid` = 1 col; ensure no `grid-cols-N` without a `sm:`/`md:` prefix).
- **A wide fixed/inline-width element or long unbroken string** → add `min-w-0` on its flex/grid parent and `break-words`/`truncate` on the text; for an intentionally wide block (e.g. a code/URL cell) wrap it in `<div className="overflow-x-auto">`.
- **Native date inputs in the filter bar feeling cramped** (cosmetic, not overflow) → allow them to take a full row on phones with `w-full sm:w-auto`.

Keep every change additive (`sm:`/`md:` prefixes or `min-w-0`) so desktop is untouched.

- [ ] **Step 3: Re-measure all four pages at 360px and 390px**

Repeat Step 1's snippet. Gate: every page returns `overflow <= 1` at both widths, with each dashboard tab active.

- [ ] **Step 4: Desktop regression**

`browser_resize` 1280×800; reload `/`, `/requests`, a `/changes/<id>`, `/approvals`. Confirm layouts are visually unchanged from before and `overflow <= 1`.

- [ ] **Step 5: Commit (only the files you changed)**

```bash
git add <changed files>
git commit -m "fix(responsive): stack/reflow core-flow pages on phones"
```
If Step 1 showed every page already passing after Task 1, record that and skip the commit (no changes needed).

---

## Task 4: Phase 1 final verification

**Files:** none (verification only)

- [ ] **Step 1: Overflow gate across all Phase 1 pages**

Playwright at **360px** and **390px**, for each of `/`, `/requests`, `/changes/<id>`, `/approvals`, `/calendar`, run:
```js
() => document.documentElement.scrollWidth - window.innerWidth
```
Expected: `<= 1` on every page at both widths.

- [ ] **Step 2: Screenshot pass (390px)**

Capture a viewport screenshot of each Phase 1 page at 390px for the record; confirm content is readable and nothing is clipped.

- [ ] **Step 3: Test suite + static checks**

Run: `pnpm test && pnpm tsc --noEmit && pnpm lint`
Expected: all tests pass (Docker up → integration suites included); tsc clean; eslint 0 errors.

- [ ] **Step 4: Stop the dev server and clean up**

Stop `pnpm dev`; remove any screenshot artifacts from the repo root; confirm `git status` shows only intended changes (and the always-untracked `docs/CSquared-CMS-Project-Workplan.xlsx`).

---

## Self-review notes

- **Spec coverage:** systemic shell fix (Task 1) ✓; no-horizontal-overflow gate at 360/390 (Tasks 1,3,4) ✓; core-flow pages responsive (Tasks 1,3; request/detail already stack, verified) ✓; calendar agenda on phones (Task 2) ✓; desktop unchanged regression (Tasks 1,3,4) ✓; test suite green (Task 4) ✓. Phase 2 (tables→cards, admin/settings) intentionally deferred to a separate plan.
- **No placeholders:** the only measure-driven task (3) lists concrete fix recipes per offender type with exact Tailwind classes; if nothing overflows after Task 1, it's a no-op commit, which is the correct outcome.
- **Naming consistency:** `formatDayLabel(key, language)` and `agenda` defined and used in Task 2; overflow gate snippet identical across tasks.
