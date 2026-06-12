# Responsive design (mobile + desktop) — design

**Date:** 2026-06-12
**Type:** Implementation spec (phased)
**Status:** Approved — ready for implementation plan (Phase 1 first).

## Why this exists

The CSquared CMS was built desktop-first. On a phone it is effectively unusable: the main
content column renders **~2456px wide inside a 390px viewport**, so the whole app scrolls
horizontally and content is off-screen. The goal is a UI that works well on phones (360–390px)
through desktop, in time to demo on mobile next week.

## Goal & success criteria

- **No horizontal overflow** on any page at 360px and 390px: `document.documentElement.scrollWidth <= window.innerWidth`.
- Every client-facing page is **readable and operable** on a phone without pinch-zoom or sideways scrolling.
- Desktop layout is unchanged (this is additive/responsive, not a redesign).
- Phase 1 is independently shippable and demo-ready before Phase 2 begins.

## Root cause (verified)

DOM ancestry at 390px:

```
body (390) → … → div.flex.min-h-screen (390) → div.flex.flex-1.flex-col (2456) → main.max-w-6xl (1152)
```

Two compounding bugs in `src/components/app-shell.tsx`:

1. **Flexbox `min-width: auto` trap** — the main content column (`flex flex-1 flex-col`) is a flex
   item with the default `min-width: auto`, so it grows to its content's intrinsic size instead of
   being constrained to the viewport. It balloons to 2456px.
2. **`main` width never reduces** — `main` uses `max-w-6xl` (1152px) with no small-screen
   reduction, so it stays 1152px even at 390px.

Because the column never shrinks to the viewport, the already-`flex-wrap` bars inside (status bar,
filter bar, tabs) never get the chance to wrap.

## Approach

Tailwind breakpoints. **`sm` (640px)** is the mobile→desktop boundary for *content* (stacking,
cards). The shell already switches its nav at **`lg` (1024px)** (sidebar ↔ hamburger drawer +
horizontal nav); that stays. Tablets (640–1024px) get the desktop content layout with the mobile
nav drawer — acceptable. Target floor: **360px**.

Work is phased. Phase 1 is demo-ready on its own.

### Phase 1a — Systemic shell fix (one small change, fixes every page)

In `src/components/app-shell.tsx`, on the main content column (`flex flex-1 flex-col`) and `main`:
- Add `min-w-0` to the flex column so it can shrink to the viewport (defuses the min-content trap).
- Make `main` width responsive: full-width on small screens, `max-w-6xl` only caps on larger
  screens (keep `mx-auto` centering and the existing `lg:pl-72`/`lg:pl-20` sidebar offset).
- Add a defensive `overflow-x-clip` on the column as a safety net against stray wide children.

Expected result: the content column collapses 2456px → ~390px and the existing `flex-wrap` bars
reflow. This alone removes horizontal scrolling across the whole app.

### Phase 1b — Core-flow content (client-facing pages)

Make these fully responsive at ≤640px:
- **Dashboard** (`src/app/page.tsx`, `src/app/dashboard-client.tsx`,
  `src/components/dashboard/*`): filter bar wraps/condenses; Monitor/Triage/Report tabs go
  full-width; KPI tiles and the worklist + matching-changes list stack to one column.
- **Request form** (`src/app/(dashboard)/requests/request-form.tsx`): the `2fr/1fr` grid collapses
  to a single column; the "My Requests" aside drops below the form on phones.
- **Change detail** (`src/app/(dashboard)/changes/[id]/change-detail-client.tsx`): the 2-column
  hub stacks (status/actions panel below the overview).
- **Approvals** (`src/app/(dashboard)/approvals/*`): list/cards reflow to one column.
- **Calendar** (`src/app/(dashboard)/calendar/*`): on phones, render an **agenda/list view**
  (chronological list of upcoming changes + blackout windows) instead of a squished 7-column month
  grid; the month grid returns at `sm`/`md`+.

### Phase 2 — Admin, settings, and the 11 tables

- **Tables → stacked cards** (chosen pattern): under `sm`, each row renders as a labeled card
  (`Field: value` rows + actions); the real `<table>` returns at `sm`+. Pages: Users, OpCos, Teams,
  CAB, Delegations, Audits, Admin Audit, Risk Register, Reports, and the settings tables
  (integrations, notification prefs), plus `matching-changes-list`.
- **Remaining grids stack**: approval-matrix, settings/profile, reports multi-column sections.

## Reusable table→cards pattern

Build one shared recipe so all 11 tables convert consistently (DRY), not bespoke markup each:
- A small helper/component (e.g. `src/components/ui/responsive-table.tsx`) or a documented
  class recipe that renders the same data as a `<table>` at `sm+` and as a stack of labeled
  cards below `sm`. Each table adopts it with minimal change. The exact API is decided during
  planning after reviewing 2–3 of the existing tables for a common shape.

## Testing & verification

- **Automated overflow check (primary gate):** for each page, at 360px and 390px, assert
  `document.documentElement.scrollWidth <= window.innerWidth` via Playwright. This objectively
  proves "no horizontal overflow" and catches regressions.
- **Visual pass:** Playwright screenshots at 390px for each page in the phase (light theme;
  dark already verified separately).
- **Desktop regression:** spot-check key pages at 1280px to confirm the desktop layout is
  unchanged.
- Existing unit/integration suite must stay green (`pnpm test`); these are mostly layout/CSS
  changes so logic tests are unaffected, but any component render tests must still pass.

## Out of scope

- Visual redesign / new components beyond what responsiveness requires.
- The separate French SSR hydration mismatch (tracked elsewhere).
- Native-app concerns (PWA, offline); this is responsive web only.
