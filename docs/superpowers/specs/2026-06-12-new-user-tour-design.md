# New-user product tour — design

**Date:** 2026-06-12
**Type:** Implementation spec
**Status:** Approved — ready for implementation plan.

## Why this exists

The CSquared CMS is feature-dense and role-gated; a first-time user lands with no
orientation. We want an opt-in guided tour — the familiar "let me show you around" overlay
that spotlights key features one step at a time — to onboard real new users and to present a
polished, self-explaining product to clients and senior management.

## Goal & success criteria

A new user signing in for the first time on desktop sees a guided tour auto-start, spotlighting
the features relevant **to their role**, with Next/Back/Skip controls, in their selected
language. They can replay it anytime from a Help control in the header. It never re-appears
automatically once dismissed/completed.

- Auto-starts once per browser on first login (desktop).
- Steps are role-aware: admins/group-admins see additional steps; plain users don't see
  steps for features they lack.
- Fully translated (en/fr) via the existing `t()` map.
- Zero backend: no schema change, no server action.

## Approach (the key decision)

**Spotlight the persistent app shell; do not drive navigation.** `AppShell`
(`src/components/app-shell.tsx`) renders the sidebar and top header on every authenticated page,
so the whole tour runs over the current page by highlighting nav items and header controls in
sequence — no route changes, no waiting on page loads or form state. This is the v1 scope.

*Rejected for v1:* a "do-it-with-me" walkthrough that navigates through actually raising a
request. It needs mid-tour navigation, page-load waits, and form orchestration — high
complexity for marginal demo value. Recorded as a future enhancement.

## Library

**driver.js** — tiny (~5kb), zero-dependency, framework-agnostic. Targets elements by CSS
selector, renders a spotlight + popover, and provides Next/Back/Close out of the box. The exact
current package name, version, and API (driver constructor, `steps`, `drive()`, popover config)
will be verified against current docs during planning before any code is written.

## Behavior

- **Auto-start:** on mount, if `localStorage["csq-tour-seen"]` is unset, start the tour and set
  the flag. Matches the existing `csq-*` localStorage convention in `src/lib/store.ts`.
- **Replay:** a "?" Help button in the `AppShell` top header dispatches a
  `window` event `csq:start-tour`; the tour component listens and (re)starts. No new global
  state; the button is decoupled from the tour instance. Replay ignores the seen-flag.
- **Desktop-only auto-start:** the sidebar is a hidden drawer below the sidebar breakpoint, so
  there are no visible targets on mobile. Auto-start fires only when the sidebar is visible
  (matchMedia on the same breakpoint AppShell uses). Manual replay still works on mobile and
  opens the nav drawer first so targets exist.
- **Defensive skipping:** any step whose target selector is not present in the DOM is filtered
  out before the tour starts, so a missing/renamed element degrades gracefully instead of
  breaking the run.
- **i18n:** every popover title/description is produced via `t(language, key)`.
- **Theme:** a small CSS override styles the driver.js popover to match the app's light/dark
  theme (driver.js ships its own base CSS which is imported once).

## Step content (role-aware)

Steps are assembled from the same role signals the nav uses: `anyAdmin`
(`canManageAnyOpCo`), `groupAdmin` (`isGroupAdmin`) from the session
(see `app-shell.tsx` lines ~118-128).

**All roles:**
1. Welcome — centered, no target — what the system is.
2. Dashboard (`nav-dashboard`) — live counts + SLA status.
3. Requests (`nav-requests`) — raise a change here.
4. Approvals (`nav-approvals`) — items awaiting decisions.
5. Changes (`nav-changes`) — the full change register.
6. Calendar (`nav-calendar`) — scheduled changes + blackout windows.
7. Notifications bell (`tour-notifications`, header) — alerts land here.
8. Help/Preferences (`tour-help`, header) — replay the tour, switch language/theme.

**Admins only** (`anyAdmin`), inserted before the closing Help step:
- Users (`nav-users`) — manage users + OpCo assignments.
- CAB (`nav-cab`) — configure the Change Advisory Board.
- Approval Matrix (`nav-approval-matrix`) — tune who approves what.

**Group admins only** (`groupAdmin`):
- OpCos (`nav-opcos`) — manage operating companies.

## Components & data flow

- **`src/lib/tour/steps.ts`** — pure `buildTourSteps({ language, isAdmin, isGroupAdmin })`
  returns the ordered driver.js step array (each: target selector + translated popover copy).
  No DOM/driver imports → unit-testable in isolation.
- **`src/components/tour/product-tour.tsx`** — `"use client"` component mounted once inside
  `AppShell`. Reads role from `useSession()` and `language` from `useStore()`, builds steps,
  owns the driver.js instance, runs auto-start (localStorage + desktop matchMedia), and
  subscribes to the `csq:start-tour` event for replay. Renders nothing visible.
- **`AppShell` edits:**
  - Add `data-tour="nav-<key>"` attributes to nav `Link`s and `data-tour` to the
    notification bell and the help/preferences control.
  - Add a "?" Help button in the header that dispatches `csq:start-tour`.
  - Mount `<ProductTour />` once.
- **i18n:** add `tour.*` keys (welcome + per-step title/description + nav labels for the Help
  button) to both `en` and `fr` blocks in `src/lib/i18n.ts`.

The tour reads only client-side state (session role, language, localStorage). No server
involvement.

## Testing

- **Unit — `src/lib/tour/steps.test.ts`:**
  - plain user → exactly the 8 universal steps, in order;
  - `isAdmin` → admin steps (Users/CAB/Approval Matrix) present;
  - `isGroupAdmin` → OpCos step present;
  - every step's title/description differs from its key (i.e. resolves through `t()`), in both
    `en` and `fr`.
- **Smoke — `src/components/tour/product-tour.test.tsx`:** component mounts without crashing
  with driver.js mocked; does not auto-start when `csq-tour-seen` is set.
- **Playwright (running app):** fresh storage auto-starts on desktop; Next/Back/Skip work;
  Help button replays; en and fr copy render; admin sees admin steps. Per the standing
  preference for browser smoke tests against the live app.

## Out of scope (future)

- "Do-it-with-me" navigation walkthroughs (actually stepping through raising/approving a change).
- Per-user server-side seen-flag (cross-device) — current choice is per-browser localStorage.
- Contextual/per-page mini-tours.
