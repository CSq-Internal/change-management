# New-User Product Tour Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a role-aware, opt-in guided tour that spotlights key features for first-time users, auto-starting once per browser on desktop with a header replay button.

**Architecture:** A pure `buildTourSteps()` function produces a role-filtered driver.js step list targeting `data-tour` attributes on the always-present `AppShell` sidebar/header. A `ProductTour` client component mounted in `AppShell` owns the driver.js instance, runs auto-start (localStorage flag + desktop matchMedia), and listens for a `csq:start-tour` window event fired by a header "?" button. No mid-tour navigation, no backend.

**Tech Stack:** Next.js 16 App Router, React client components, driver.js (~5kb tour library), Zustand UI store, NextAuth session for roles, flat `t()` i18n (en/fr), Vitest + React Testing Library.

---

## Spec

`docs/superpowers/specs/2026-06-12-new-user-tour-design.md`

## Key codebase facts (verified)

- `AppShell` (`src/components/app-shell.tsx`): sidebar is `hidden lg:flex` → desktop breakpoint is **1024px** (`(min-width: 1024px)`). Nav links render at ~line 255 from `effectiveNavGroups`. Bell `Link` at ~391-404. Theme-toggle button ends ~360; settings menu `<div className="relative">` starts ~361. Role signals already computed: `anyAdmin = canManageAnyOpCo(...)` (~118), `groupAdmin = isGroupAdmin(...)` (~119).
- Role helpers live in `@/lib/permissions`: `canManageAnyOpCo(organizations, realmRoles)`, `isGroupAdmin(realmRoles)`.
- `useStore()` (`src/lib/store.ts`) exposes `language`; localStorage keys are prefixed `csq-`.
- i18n map `src/lib/i18n.ts`: English block ends near line 367 (after `requests.submitting`); French block similarly. `t(language, key)` returns the key itself when a key is missing.
- Global stylesheet: `src/app/globals.css` (imported in `src/app/layout.tsx`). Theme CSS vars: `--card`, `--card-foreground`, `--foreground`, `--muted-foreground`, `--border`, `--primary`, `--primary-foreground` (defined for light `:root` and dark `.dark`).
- driver.js API (verified via docs): `import { driver } from "driver.js"`; `import "driver.js/dist/driver.css"`; `driver({ steps, showProgress, popoverClass, nextBtnText, prevBtnText, doneBtnText, onDestroyed })`; `.drive()` starts; `.destroy()` tears down. A step with no `element` renders a centered popover. Step shape: `{ element?: string, popover: { title, description } }`. Step type is `DriveStep`, instance type is `Driver`.

## File structure

- **Create** `src/lib/tour/steps.ts` — pure `buildTourSteps()` returning `DriveStep[]`.
- **Create** `src/lib/tour/steps.test.ts` — unit tests for the builder.
- **Create** `src/components/tour/product-tour.tsx` — client component owning the driver instance.
- **Create** `src/components/tour/product-tour.test.tsx` — smoke test (driver mocked).
- **Modify** `src/lib/i18n.ts` — add `tour.*` keys (en + fr).
- **Modify** `src/components/app-shell.tsx` — `data-tour` attrs, header "?" button, mount `<ProductTour/>`.
- **Modify** `src/app/globals.css` — `.csq-tour` popover theming.
- **Modify** `package.json` / `pnpm-lock.yaml` — add `driver.js`.

## Notes / deliberate v1 simplifications

- **Mobile replay** relies on defensive step-filtering: on mobile the sidebar is hidden, so nav-targeted steps are skipped and the user sees welcome + header steps (notifications, help). Auto-driving the mobile drawer is deferred (out of scope, per spec "future").
- Nav `data-tour` attributes for admin items (`nav-users`, `nav-cab`, `nav-opcos`) only exist in the DOM when the admin nav group renders; `buildTourSteps` already gates those steps by role, and the defensive filter is a second safety net.

---

## Task 1: Install driver.js

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml`

- [ ] **Step 1: Install the dependency**

Run: `pnpm add driver.js`
Expected: adds `driver.js` to `dependencies`, updates `pnpm-lock.yaml`.

- [ ] **Step 2: Verify it resolves and note the version**

Run: `pnpm ls driver.js`
Expected: prints a single resolved version (e.g. `driver.js 1.x.x`). No peer-dep errors.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "build: add driver.js for the product tour"
```

---

## Task 2: Add tour i18n strings (en + fr)

**Files:**
- Modify: `src/lib/i18n.ts`

- [ ] **Step 1: Add the English keys**

In the English (`en`) translations object, add this block immediately after the line
`"requests.submitting": "Submitting…",`:

```ts
    "tour.next": "Next",
    "tour.prev": "Back",
    "tour.done": "Done",
    "tour.help": "Take a tour",
    "tour.welcome.title": "Welcome to the Change Management System",
    "tour.welcome.desc": "A quick tour of the key areas. You can skip anytime and replay it later from the “?” button in the header.",
    "tour.dashboard.title": "Dashboard",
    "tour.dashboard.desc": "Your control center — live change counts and SLA status at a glance.",
    "tour.requests.title": "Raise a request",
    "tour.requests.desc": "Submit a new change request and track the ones you’ve raised.",
    "tour.approvals.title": "Approvals",
    "tour.approvals.desc": "Changes awaiting a decision show up here for approvers.",
    "tour.changes.title": "Changes",
    "tour.changes.desc": "Browse the full change register and open any change’s detail hub.",
    "tour.calendar.title": "Calendar",
    "tour.calendar.desc": "See scheduled changes and blackout windows, and reschedule by dragging.",
    "tour.notifications.title": "Notifications",
    "tour.notifications.desc": "Alerts about your changes and approvals land here.",
    "tour.helpStep.title": "Replay the tour",
    "tour.helpStep.desc": "Click here anytime to take this tour again.",
    "tour.users.title": "User management",
    "tour.users.desc": "Add users and manage their OpCo assignments and roles.",
    "tour.cab.title": "Change Advisory Board",
    "tour.cab.desc": "Configure CAB membership that drives approval authority.",
    "tour.approvalMatrix.title": "Approval matrix",
    "tour.approvalMatrix.desc": "Tune who approves what, by infrastructure type and OpCo.",
    "tour.opcos.title": "Operating companies",
    "tour.opcos.desc": "Manage the operating companies (OpCos) in the group.",
```

- [ ] **Step 2: Add the French keys**

In the French (`fr`) translations object, add this block immediately after the line
`"requests.submitting": "Envoi…",`:

```ts
    "tour.next": "Suivant",
    "tour.prev": "Retour",
    "tour.done": "Terminer",
    "tour.help": "Faire le tour",
    "tour.welcome.title": "Bienvenue dans le systeme de gestion des changements",
    "tour.welcome.desc": "Un bref tour des zones cles. Vous pouvez passer a tout moment et le rejouer depuis le bouton « ? » dans l’en-tete.",
    "tour.dashboard.title": "Tableau de bord",
    "tour.dashboard.desc": "Votre centre de controle — compteurs de changements et statut SLA en un coup d’oeil.",
    "tour.requests.title": "Soumettre une demande",
    "tour.requests.desc": "Soumettez une nouvelle demande de changement et suivez celles que vous avez creees.",
    "tour.approvals.title": "Approbations",
    "tour.approvals.desc": "Les changements en attente de decision apparaissent ici pour les approbateurs.",
    "tour.changes.title": "Changements",
    "tour.changes.desc": "Parcourez le registre complet des changements et ouvrez le detail de chacun.",
    "tour.calendar.title": "Calendrier",
    "tour.calendar.desc": "Voir les changements planifies et les fenetres de gel, et reprogrammer par glisser-deposer.",
    "tour.notifications.title": "Notifications",
    "tour.notifications.desc": "Les alertes sur vos changements et approbations arrivent ici.",
    "tour.helpStep.title": "Rejouer le tour",
    "tour.helpStep.desc": "Cliquez ici a tout moment pour refaire ce tour.",
    "tour.users.title": "Gestion des utilisateurs",
    "tour.users.desc": "Ajoutez des utilisateurs et gerez leurs affectations OpCo et roles.",
    "tour.cab.title": "Comite consultatif des changements",
    "tour.cab.desc": "Configurez les membres du CAB qui determinent l’autorite d’approbation.",
    "tour.approvalMatrix.title": "Matrice d’approbation",
    "tour.approvalMatrix.desc": "Ajustez qui approuve quoi, par type d’infrastructure et OpCo.",
    "tour.opcos.title": "Societes operationnelles",
    "tour.opcos.desc": "Gerez les societes operationnelles (OpCo) du groupe.",
```

- [ ] **Step 3: Verify type-check passes**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/i18n.ts
git commit -m "feat(i18n): product tour strings (en/fr)"
```

---

## Task 3: Pure step builder + unit tests

**Files:**
- Create: `src/lib/tour/steps.ts`
- Test: `src/lib/tour/steps.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/tour/steps.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { buildTourSteps } from "@/lib/tour/steps"

const base = { language: "en" as const, isAdmin: false, isGroupAdmin: false }

describe("buildTourSteps", () => {
  it("returns the 8 universal steps for a plain user, welcome first and help last", () => {
    const steps = buildTourSteps(base)
    expect(steps).toHaveLength(8)
    expect(steps[0].element).toBeUndefined() // welcome is a centered popover
    expect(steps[1].element).toBe('[data-tour="nav-dashboard"]')
    expect(steps.at(-1)!.element).toBe('[data-tour="tour-help"]')
  })

  it("includes the three admin steps when isAdmin", () => {
    const elements = buildTourSteps({ ...base, isAdmin: true }).map((s) => s.element)
    expect(elements).toContain('[data-tour="nav-users"]')
    expect(elements).toContain('[data-tour="nav-cab"]')
    expect(elements).toContain('[data-tour="nav-approval-matrix"]')
  })

  it("includes the opcos step only when isGroupAdmin", () => {
    expect(buildTourSteps(base).map((s) => s.element)).not.toContain('[data-tour="nav-opcos"]')
    expect(buildTourSteps({ ...base, isGroupAdmin: true }).map((s) => s.element)).toContain(
      '[data-tour="nav-opcos"]',
    )
  })

  it("resolves every popover string through t() in both languages (no raw keys leak)", () => {
    for (const language of ["en", "fr"] as const) {
      for (const s of buildTourSteps({ language, isAdmin: true, isGroupAdmin: true })) {
        expect(s.popover!.title).not.toMatch(/^tour\./)
        expect(s.popover!.description).not.toMatch(/^tour\./)
      }
    }
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/lib/tour/steps.test.ts`
Expected: FAIL — cannot resolve `@/lib/tour/steps` (module does not exist yet).

- [ ] **Step 3: Implement the builder**

Create `src/lib/tour/steps.ts`:

```ts
import type { DriveStep } from "driver.js"
import { t, type Language } from "@/lib/i18n"

export interface TourContext {
  language: Language
  isAdmin: boolean
  isGroupAdmin: boolean
}

function step(language: Language, element: string | undefined, titleKey: string, descKey: string): DriveStep {
  return {
    element,
    popover: { title: t(language, titleKey), description: t(language, descKey) },
  }
}

/** Ordered, role-filtered driver.js steps. Targets are `data-tour` attributes on AppShell. */
export function buildTourSteps({ language, isAdmin, isGroupAdmin }: TourContext): DriveStep[] {
  const steps: DriveStep[] = [
    step(language, undefined, "tour.welcome.title", "tour.welcome.desc"),
    step(language, '[data-tour="nav-dashboard"]', "tour.dashboard.title", "tour.dashboard.desc"),
    step(language, '[data-tour="nav-requests"]', "tour.requests.title", "tour.requests.desc"),
    step(language, '[data-tour="nav-approvals"]', "tour.approvals.title", "tour.approvals.desc"),
    step(language, '[data-tour="nav-changes"]', "tour.changes.title", "tour.changes.desc"),
    step(language, '[data-tour="nav-calendar"]', "tour.calendar.title", "tour.calendar.desc"),
    step(language, '[data-tour="tour-notifications"]', "tour.notifications.title", "tour.notifications.desc"),
  ]

  if (isAdmin) {
    steps.push(
      step(language, '[data-tour="nav-users"]', "tour.users.title", "tour.users.desc"),
      step(language, '[data-tour="nav-cab"]', "tour.cab.title", "tour.cab.desc"),
      step(language, '[data-tour="nav-approval-matrix"]', "tour.approvalMatrix.title", "tour.approvalMatrix.desc"),
    )
  }
  if (isGroupAdmin) {
    steps.push(step(language, '[data-tour="nav-opcos"]', "tour.opcos.title", "tour.opcos.desc"))
  }

  steps.push(step(language, '[data-tour="tour-help"]', "tour.helpStep.title", "tour.helpStep.desc"))
  return steps
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/lib/tour/steps.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/tour/steps.ts src/lib/tour/steps.test.ts
git commit -m "feat(tour): role-aware step builder + tests"
```

---

## Task 4: ProductTour client component + smoke test

**Files:**
- Create: `src/components/tour/product-tour.tsx`
- Test: `src/components/tour/product-tour.test.tsx`

- [ ] **Step 1: Write the failing smoke test**

Create `src/components/tour/product-tour.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, cleanup } from "@testing-library/react"

const drive = vi.fn()
const destroy = vi.fn()
const driverFactory = vi.fn(() => ({ drive, destroy }))

vi.mock("driver.js", () => ({ driver: driverFactory }))
vi.mock("driver.js/dist/driver.css", () => ({}))
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { organizations: [], realmRoles: [] } } }),
}))
vi.mock("@/lib/store", () => ({ useStore: () => ({ language: "en" }) }))

import ProductTour from "@/components/tour/product-tour"

beforeEach(() => {
  localStorage.clear()
  drive.mockClear()
  driverFactory.mockClear()
  window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia
})
afterEach(() => cleanup())

describe("ProductTour", () => {
  it("auto-starts once on desktop when unseen, and sets the seen flag", () => {
    render(<ProductTour />)
    expect(drive).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem("csq-tour-seen")).toBe("1")
  })

  it("does not auto-start when csq-tour-seen is already set", () => {
    localStorage.setItem("csq-tour-seen", "1")
    render(<ProductTour />)
    expect(drive).not.toHaveBeenCalled()
  })

  it("starts when a csq:start-tour event fires (replay)", () => {
    localStorage.setItem("csq-tour-seen", "1")
    render(<ProductTour />)
    expect(drive).not.toHaveBeenCalled()
    window.dispatchEvent(new Event("csq:start-tour"))
    expect(drive).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/components/tour/product-tour.test.tsx`
Expected: FAIL — cannot resolve `@/components/tour/product-tour`.

- [ ] **Step 3: Implement the component**

Create `src/components/tour/product-tour.tsx`:

```tsx
"use client"

import { useEffect, useRef } from "react"
import { useSession } from "next-auth/react"
import { driver, type Driver } from "driver.js"
import "driver.js/dist/driver.css"
import { useStore } from "@/lib/store"
import { canManageAnyOpCo, isGroupAdmin } from "@/lib/permissions"
import { buildTourSteps } from "@/lib/tour/steps"
import { t } from "@/lib/i18n"

const SEEN_KEY = "csq-tour-seen"
const START_EVENT = "csq:start-tour"
const DESKTOP_QUERY = "(min-width: 1024px)" // matches AppShell `lg` sidebar visibility

export default function ProductTour() {
  const { data: session } = useSession()
  const { language } = useStore()
  const driverRef = useRef<Driver | null>(null)

  useEffect(() => {
    const user = session?.user
    if (!user) return

    const isAdmin = canManageAnyOpCo(user.organizations, user.realmRoles)
    const groupAdmin = isGroupAdmin(user.realmRoles)

    function start() {
      driverRef.current?.destroy()
      const steps = buildTourSteps({ language, isAdmin, isGroupAdmin: groupAdmin }).filter(
        (s) => !s.element || document.querySelector(s.element as string),
      )
      if (steps.length === 0) return
      const d = driver({
        showProgress: true,
        popoverClass: "csq-tour",
        nextBtnText: t(language, "tour.next"),
        prevBtnText: t(language, "tour.prev"),
        doneBtnText: t(language, "tour.done"),
        steps,
        onDestroyed: () => {
          driverRef.current = null
        },
      })
      driverRef.current = d
      d.drive()
    }

    const onStart = () => start()
    window.addEventListener(START_EVENT, onStart)

    if (!localStorage.getItem(SEEN_KEY) && window.matchMedia(DESKTOP_QUERY).matches) {
      localStorage.setItem(SEEN_KEY, "1")
      start()
    }

    return () => {
      window.removeEventListener(START_EVENT, onStart)
      driverRef.current?.destroy()
    }
  }, [session, language])

  return null
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/components/tour/product-tour.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/tour/product-tour.tsx src/components/tour/product-tour.test.tsx
git commit -m "feat(tour): ProductTour client component + smoke tests"
```

---

## Task 5: Wire into AppShell (targets + help button + mount)

**Files:**
- Modify: `src/components/app-shell.tsx`

- [ ] **Step 1: Add the `tour` field to the targeted nav items**

In the `navGroups` array, add a `tour` property to these items (leave all other items unchanged):

```ts
{ href: "/", labelKey: "nav.dashboard", icon: BarChart3, tour: "nav-dashboard" },
{ href: "/requests", labelKey: "nav.requests", icon: ClipboardList, tour: "nav-requests" },
{ href: "/approvals", labelKey: "nav.approvals", icon: ShieldCheck, tour: "nav-approvals" },
{ href: "/changes", labelKey: "nav.changes", icon: GitCompare, tour: "nav-changes" },
// in the User Management group:
{ href: "/users", labelKey: "nav.users", icon: Users, gate: "admin", tour: "nav-users" },
{ href: "/cab", labelKey: "nav.cab", icon: Gavel, gate: "admin", tour: "nav-cab" },
{ href: "/opcos", labelKey: "nav.opcos", icon: Building2, gate: "groupAdmin", tour: "nav-opcos" },
// in the Insights group:
{ href: "/calendar", labelKey: "nav.calendar", icon: CalendarDays, tour: "nav-calendar" },
{ href: "/approval-matrix", labelKey: "nav.approvalMatrix", icon: Sliders, tour: "nav-approval-matrix" },
```

- [ ] **Step 2: Render the `data-tour` attribute on the nav Link**

In the nav-link `<Link>` (~line 255), add the attribute. Change the opening tag from:

```tsx
                      <Link
                        key={item.href}
                        href={item.href}
                        className={cn(
```

to:

```tsx
                      <Link
                        key={item.href}
                        href={item.href}
                        data-tour={(item as { tour?: string }).tour}
                        className={cn(
```

- [ ] **Step 3: Tag the notification bell**

On the bell `Link` (~line 392), add `data-tour="tour-notifications"`. Change:

```tsx
                  <Link
                    href="/notifications/history"
                    className="relative inline-flex h-9 w-9 items-center justify-center rounded-full bg-card text-foreground transition hover:bg-muted"
                    aria-label={translate("nav.notificationHistory")}
                  >
```

to:

```tsx
                  <Link
                    href="/notifications/history"
                    data-tour="tour-notifications"
                    className="relative inline-flex h-9 w-9 items-center justify-center rounded-full bg-card text-foreground transition hover:bg-muted"
                    aria-label={translate("nav.notificationHistory")}
                  >
```

- [ ] **Step 4: Import the help icon and the ProductTour component**

Add `HelpCircle` to the existing `lucide-react` import (alongside `Menu`, `Settings`, etc.):

```ts
  HelpCircle,
```

Add this import near the other component imports (e.g. after the `Toaster` import line):

```ts
import ProductTour from "@/components/tour/product-tour"
```

- [ ] **Step 5: Add the "?" help button in the header**

Immediately AFTER the theme-toggle `<button>` (the one with `aria-label={translate("theme.toggle")}`, ~line 360) and BEFORE the settings-menu `<div className="relative">` (~line 361), insert:

```tsx
                <button
                  data-tour="tour-help"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-card text-foreground transition hover:bg-muted"
                  onClick={() => window.dispatchEvent(new Event("csq:start-tour"))}
                  aria-label={translate("tour.help")}
                >
                  <HelpCircle className="h-4 w-4" />
                </button>
```

- [ ] **Step 6: Mount ProductTour for authenticated users**

Find where `<Toaster />` is rendered in the `AppShell` return (`grep -n "<Toaster" src/components/app-shell.tsx`). Immediately after it, add:

```tsx
      {currentUser && <ProductTour />}
```

- [ ] **Step 7: Verify type-check and lint pass**

Run: `pnpm tsc --noEmit && pnpm exec eslint src/components/app-shell.tsx`
Expected: tsc clean; eslint reports 0 errors (pre-existing warnings are fine).

- [ ] **Step 8: Commit**

```bash
git add src/components/app-shell.tsx
git commit -m "feat(tour): wire targets, header replay button, and mount into AppShell"
```

---

## Task 6: Theme the driver.js popover

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 1: Append the popover theming**

Add to the end of `src/app/globals.css`:

```css
/* Product tour (driver.js) popover — themed via app CSS variables (light + dark). */
.driver-popover.csq-tour {
  background-color: var(--card);
  color: var(--foreground);
  border: 1px solid var(--border);
  border-radius: 0.75rem;
}
.driver-popover.csq-tour .driver-popover-title {
  font-weight: 600;
  color: var(--foreground);
}
.driver-popover.csq-tour .driver-popover-description {
  color: var(--muted-foreground);
}
.driver-popover.csq-tour .driver-popover-progress-text {
  color: var(--muted-foreground);
}
.driver-popover.csq-tour .driver-popover-arrow {
  color: var(--card);
}
.driver-popover.csq-tour button.driver-popover-next-btn {
  background-color: var(--primary);
  color: var(--primary-foreground);
  text-shadow: none;
  border: none;
  border-radius: 0.5rem;
}
.driver-popover.csq-tour button.driver-popover-prev-btn {
  color: var(--foreground);
  text-shadow: none;
}
```

- [ ] **Step 2: Verify the build compiles the CSS**

Run: `pnpm build`
Expected: build succeeds (Prisma generate + Next build). If the build needs a database URL and fails for unrelated DB reasons, instead run `pnpm tsc --noEmit` and confirm no CSS/TS errors; the CSS is plain and will not break the build.

- [ ] **Step 3: Commit**

```bash
git add src/app/globals.css
git commit -m "style(tour): theme driver.js popover for light/dark"
```

---

## Task 7: Full verification (tests + live smoke)

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit suite**

Run: `pnpm test`
Expected: all suites pass except the two Testcontainers integration files (`isolation`, `admin-governance`), which fail-by-design without Docker. New `steps` (4) and `product-tour` (3) tests pass.

- [ ] **Step 2: Type-check and lint the whole project**

Run: `pnpm tsc --noEmit && pnpm lint`
Expected: tsc clean; eslint 0 errors.

- [ ] **Step 3: Live smoke against the running app (Playwright MCP)**

Start the local stack (Postgres + Keycloak via docker compose, migrate + seed, then `pnpm dev` — see `reference_local_dev_stack` runbook). Then with the Playwright MCP:
1. Clear storage / use a fresh context, sign in as `devops@csquared.com` / `Admin2025$`.
2. Confirm the tour **auto-starts** on the dashboard (desktop viewport ≥1024px) and the first popover is the centered Welcome.
3. Click through **Next** to the end; confirm admin steps (Users, CAB, Approval Matrix, OpCos) appear for this admin account and each spotlight lands on the correct sidebar item.
4. Reload — confirm it does **not** auto-start again (seen flag set).
5. Click the header **"?"** button — confirm the tour **replays**.
6. Switch language to French via preferences and replay — confirm popover copy is French.
7. Toggle dark mode and replay — confirm the popover is readable (themed).

- [ ] **Step 4: Final confirmation**

Confirm no console errors during the tour run. The feature is complete when steps 1-3 of this task pass.

---

## Self-review notes

- **Spec coverage:** auto-start once/browser (Task 4) ✓; role-aware steps (Task 3) ✓; localStorage seen-flag `csq-tour-seen` (Task 4) ✓; header replay button + `csq:start-tour` event (Tasks 4, 5) ✓; desktop-only auto-start via matchMedia 1024px (Task 4) ✓; defensive missing-target filtering (Task 4) ✓; en/fr copy (Task 2) ✓; theme override (Task 6) ✓; unit + smoke + Playwright tests (Tasks 3, 4, 7) ✓.
- **Naming consistency:** `SEEN_KEY="csq-tour-seen"`, `START_EVENT="csq:start-tour"`, `popoverClass="csq-tour"`, `data-tour` selectors, and `buildTourSteps`/`TourContext` are used identically across builder, component, tests, AppShell, and CSS.
- **Mobile:** intentionally degraded to defensive filtering for v1 (documented above), not a gap.
