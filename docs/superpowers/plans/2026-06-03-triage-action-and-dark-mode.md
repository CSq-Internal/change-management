# Triage Action Field + Dark Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) Remove the brittle substring-sniffing that derives the triage advance-button label from the human-readable `why` string by carrying an explicit `action` on `WorklistItem`; (2) add a Light/Dark/System theme with a header quick-toggle and a Preferences control.

**Architecture:** Part 1 moves the label decision into the already-tested pure metrics layer (`buildDashboardData`), so `triage-view.tsx` becomes purely presentational — it maps `item.action` to an i18n label, no string inspection. Part 2 keeps theme state in the Zustand UI store (mirroring `language`/`fontScale`), resolves it through a pure `resolveTheme()` helper (unit-tested), applies `.dark` on `<html>` via an effect plus a `matchMedia` listener for live OS-follow, and prevents flash-of-wrong-theme with a tiny blocking script in the root layout.

**Tech Stack:** Next.js 15 App Router, TypeScript, Tailwind v4 (CSS-variable tokens; `.dark` palette and `@custom-variant dark` already exist in `globals.css`), Zustand, Vitest (jsdom + RTL), lucide-react, i18n via flat `t(language, key)` map.

---

## File Structure

**Part 1 — Triage action**
- Modify `src/lib/dashboard-metrics.ts` — add `WorklistAction` type + `action` field on `WorklistItem`; compute it in `buildDashboardData`.
- Modify `src/lib/dashboard-metrics.test.ts` — assert the `action` values.
- Modify `src/components/dashboard/triage-view.tsx` — drop `advanceLabel`; map `item.action` to an i18n label.
- Modify `src/lib/i18n.ts` — add `dashboard.action.*` keys (en + fr).

**Part 2 — Dark mode**
- Create `src/lib/theme.ts` — pure `ThemeMode`/`ResolvedTheme` types, `resolveTheme()`, `THEME_STORAGE_KEY`.
- Create `src/lib/theme.test.ts` — unit tests for `resolveTheme()`.
- Modify `src/lib/store.ts` — add `theme` + `setTheme`, persisted to `localStorage` under `csq-theme`.
- Modify `src/app/layout.tsx` — `suppressHydrationWarning` on `<html>` + blocking inline script that applies the stored theme before paint.
- Modify `src/components/app-shell.tsx` — hydrate `theme` on mount, apply `.dark` reactively with a `matchMedia` listener, add header sun/moon quick-toggle, add Theme section to the Preferences modal.
- Modify `src/lib/i18n.ts` — add `prefs.theme.*` and `theme.toggle` keys (en + fr).

---

## Part 1 — Triage explicit action

### Task 1: Carry `action` on `WorklistItem` (metrics layer)

**Files:**
- Modify: `src/lib/dashboard-metrics.ts`
- Test: `src/lib/dashboard-metrics.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test to `src/lib/dashboard-metrics.test.ts` (after the existing `buildDashboardData` test, before EOF). It pins the action for every group. The advance group is sorted by `plannedStart` ascending, so for the fixture the order is `1054(-18h, implemented)`, `1045(-6h, implemented)`, `1048(+9h, approved/today)`, `1044(+14h, approved/today)`, `1053(+74h, approved/future)`.

```ts
test("buildDashboardData carries an explicit action per worklist item", () => {
  const d = buildDashboardData(fixture(), now)

  // overdue + awaiting are always a plain review
  expect(d.triage.overdue.every((w) => w.action === "review")).toBe(true)
  expect(d.triage.awaiting.every((w) => w.action === "review")).toBe(true)

  // advance: implemented -> verify; approved scheduled today -> start; approved later -> advance
  expect(d.triage.advance.map((w) => w.action)).toEqual([
    "verify", "verify", "start", "start", "advance",
  ])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/dashboard-metrics.test.ts`
Expected: FAIL — `w.action` is `undefined` (property does not exist yet), so the `.every(... === "review")` and `.map` assertions do not match.

- [ ] **Step 3: Add the type and compute the field**

In `src/lib/dashboard-metrics.ts`, add the action type next to the other worklist types (just above `export interface WorklistItem`):

```ts
export type WorklistAction = "review" | "start" | "advance" | "verify"
```

Add `action` to the interface:

```ts
export interface WorklistItem {
  id: string
  title: string
  opcoName: string
  risk: RiskLevelName
  ownerInitials: string
  why: string
  severity: "over" | "soon" | "go"
  action: WorklistAction
}
```

Inside `buildDashboardData`, add a same-day helper near the top of the function (after the `bySla` definition):

```ts
const startOfDay = (ms: number) => { const x = new Date(ms); x.setHours(0, 0, 0, 0); return x.getTime() }
const scheduledTodayOrPast = (planned: string | null) =>
  planned != null && Math.round((startOfDay(Date.parse(planned)) - startOfDay(nowMs)) / 86_400_000) <= 0
```

Set `action: "review"` on the `overdue` and `awaiting` mappers:

```ts
const overdue: WorklistItem[] = overdueChanges.map((c) => ({
  ...base(c), severity: "over", action: "review",
  why: `SLA breached ${durLabel(Date.parse(c.slaDeadline!) - nowMs)} ago`,
}))
const awaiting: WorklistItem[] = awaitingChanges.map((c) => {
  const remaining = Date.parse(c.slaDeadline!) - nowMs
  return { ...base(c), severity: remaining < AT_RISK_WINDOW_MS ? "soon" : "go", action: "review", why: `${durLabel(remaining)} to SLA` }
})
```

Compute `action` in the `advance` mapper:

```ts
const advance: WorklistItem[] = advanceChanges.map((c) => {
  const action: WorklistAction =
    c.status === "implemented" ? "verify"
      : scheduledTodayOrPast(c.plannedStart) ? "start"
        : "advance"
  return {
    ...base(c), severity: "go", action,
    why: c.status === "approved"
      ? (c.plannedStart ? `Approved · ${whenLabel(Date.parse(c.plannedStart), nowMs)}` : "Approved · ready to implement")
      : "Implemented · ready to verify",
  }
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/dashboard-metrics.test.ts`
Expected: PASS — all `buildDashboardData` tests green, including the new action test.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboard-metrics.ts src/lib/dashboard-metrics.test.ts
git commit -m "feat(dashboard): carry explicit action on triage WorklistItem"
```

### Task 2: Render the action label from i18n (presentational)

**Files:**
- Modify: `src/lib/i18n.ts`
- Modify: `src/components/dashboard/triage-view.tsx`

- [ ] **Step 1: Add the i18n keys**

In `src/lib/i18n.ts`, in the **en** block add (next to the other `dashboard.triage.*` keys, ~line 135):

```ts
    "dashboard.action.review": "Review",
    "dashboard.action.start": "Start",
    "dashboard.action.advance": "Advance",
    "dashboard.action.verify": "Verify",
```

In the **fr** block add (next to the fr `dashboard.triage.*` keys, ~line 485):

```ts
    "dashboard.action.review": "Examiner",
    "dashboard.action.start": "Démarrer",
    "dashboard.action.advance": "Avancer",
    "dashboard.action.verify": "Vérifier",
```

- [ ] **Step 2: Replace string-sniffing with the action field**

In `src/components/dashboard/triage-view.tsx`:

Update the import to pull in the action type:

```ts
import type { DashboardData, WorklistItem, WorklistAction } from "@/lib/dashboard-metrics"
```

Change `Row` to take the item and resolve its own label, removing the `actionLabel` prop:

```tsx
function Row({ item, language }: { item: WorklistItem; language: Language }) {
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
      <span className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground">{t(language, `dashboard.action.${item.action}`)}</span>
    </Link>
  )
}
```

In `TriageView`, delete the `advanceLabel` line entirely and update the three `.map` calls to pass `language` instead of `actionLabel`:

```tsx
export function TriageView({ data, language }: { data: DashboardData; language: Language }) {
  return (
    <div className="space-y-3">
      {/* ...the Chip grid is unchanged... */}

      <Card className="border-border/80 bg-card/90">
        <CardHeader className="flex flex-row items-center justify-between pb-1">
          <CardTitle className="flex items-center gap-2 text-sm"><ListChecks className="h-4 w-4 text-primary" /> {t(language, "dashboard.triage.worklist")}</CardTitle>
          <span className="text-xs text-muted-foreground">{t(language, "dashboard.triage.sortedByUrgency")}</span>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <GroupHeader dot="bg-rose-500" label={t(language, "dashboard.triage.overdue")} count={data.triage.overdue.length} />
          {data.triage.overdue.map((it) => <Row key={it.id} item={it} language={language} />)}
          <GroupHeader dot="bg-amber-500" label={t(language, "dashboard.triage.awaiting")} count={data.triage.awaiting.length} />
          {data.triage.awaiting.map((it) => <Row key={it.id} item={it} language={language} />)}
          <GroupHeader dot="bg-primary" label={t(language, "dashboard.triage.advance")} count={data.triage.advance.length} />
          {data.triage.advance.map((it) => <Row key={it.id} item={it} language={language} />)}
        </CardContent>
      </Card>
    </div>
  )
}
```

Note: `WorklistAction` is imported for type-completeness of the `dashboard.action.${item.action}` template key; if the linter flags it as unused, drop it from the import. The `severity`-based "over/soon" labels keep their previous "Review" wording for overdue/awaiting (now via `action: "review"`), matching prior behavior.

- [ ] **Step 3: Verify type-check, lint, and the render smoke test**

Run: `pnpm tsc --noEmit && pnpm lint && pnpm test src/app/dashboard-client.test.tsx`
Expected: tsc clean; lint shows no new errors (pre-existing tolerated warnings only); the 3 dashboard render tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/i18n.ts src/components/dashboard/triage-view.tsx
git commit -m "refactor(dashboard): render triage action label from data, not why-string"
```

---

## Part 2 — Dark mode (Light / Dark / System)

### Task 3: Pure theme resolver

**Files:**
- Create: `src/lib/theme.ts`
- Test: `src/lib/theme.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/theme.test.ts`:

```ts
import { test, expect } from "vitest"
import { resolveTheme, THEME_STORAGE_KEY } from "./theme"

test("resolveTheme returns the explicit choice for light/dark", () => {
  expect(resolveTheme("light", true)).toBe("light")
  expect(resolveTheme("light", false)).toBe("light")
  expect(resolveTheme("dark", false)).toBe("dark")
  expect(resolveTheme("dark", true)).toBe("dark")
})

test("resolveTheme follows the OS preference for system", () => {
  expect(resolveTheme("system", true)).toBe("dark")
  expect(resolveTheme("system", false)).toBe("light")
})

test("THEME_STORAGE_KEY matches the persisted localStorage key", () => {
  expect(THEME_STORAGE_KEY).toBe("csq-theme")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/theme.test.ts`
Expected: FAIL — cannot resolve module `./theme`.

- [ ] **Step 3: Create the module**

Create `src/lib/theme.ts`:

```ts
export type ThemeMode = "light" | "dark" | "system"
export type ResolvedTheme = "light" | "dark"

export const THEME_STORAGE_KEY = "csq-theme"

/** Resolve a stored mode to the concrete theme to paint. */
export function resolveTheme(mode: ThemeMode, systemPrefersDark: boolean): ResolvedTheme {
  if (mode === "system") return systemPrefersDark ? "dark" : "light"
  return mode
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/theme.test.ts`
Expected: PASS — all 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/theme.ts src/lib/theme.test.ts
git commit -m "feat(theme): pure resolveTheme helper + storage key"
```

### Task 4: Theme state in the store

**Files:**
- Modify: `src/lib/store.ts`

- [ ] **Step 1: Add theme to the store**

In `src/lib/store.ts`, import the type at the top:

```ts
import type { ThemeMode } from './theme'
```

Add to the `UIState` interface:

```ts
  theme: ThemeMode
  setTheme: (theme: ThemeMode) => void
```

Add to the `create` initializer (default `'system'`, persisted to `csq-theme`):

```ts
  theme: (typeof window !== 'undefined'
    ? (localStorage.getItem('csq-theme') as ThemeMode) : null) ?? 'system',
  setTheme: (theme) => {
    set({ theme })
    if (typeof window !== 'undefined') localStorage.setItem('csq-theme', theme)
  },
```

- [ ] **Step 2: Verify type-check**

Run: `pnpm tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/store.ts
git commit -m "feat(theme): theme mode in UI store, persisted to csq-theme"
```

### Task 5: Prevent flash-of-wrong-theme (root layout)

**Files:**
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Add suppressHydrationWarning + blocking script**

The script runs before React hydrates and before first paint, applying `.dark` from `localStorage` (defaulting to the OS preference for `system`). Because it mutates `<html>`'s class/style before hydration, `suppressHydrationWarning` is required to avoid a hydration warning.

In `src/app/layout.tsx`, change the `<html>` tag and add a `<head>` with the script:

```tsx
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var m=localStorage.getItem('csq-theme')||'system';var d=m==='dark'||(m==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var e=document.documentElement;e.classList.toggle('dark',d);e.style.colorScheme=d?'dark':'light';}catch(e){}})();`,
          }}
        />
      </head>
      <body className={cn(spaceGrotesk.variable, "min-h-dvh bg-background font-sans antialiased")}>
        {/* ...unchanged... */}
      </body>
    </html>
  )
```

- [ ] **Step 2: Verify type-check and build**

Run: `pnpm tsc --noEmit`
Expected: clean. (`dangerouslySetInnerHTML` with a static string passes lint; if `react/no-danger` flags it, add `{/* eslint-disable-next-line react/no-danger */}` above the `<script>`.)

- [ ] **Step 3: Commit**

```bash
git add src/app/layout.tsx
git commit -m "feat(theme): apply stored theme before paint to avoid FOUC"
```

### Task 6: Apply theme reactively in AppShell

**Files:**
- Modify: `src/components/app-shell.tsx`

- [ ] **Step 1: Import the resolver and pull theme from the store**

Add the import near the other `@/lib` imports:

```ts
import { resolveTheme, type ThemeMode } from "@/lib/theme"
```

Add `theme`/`setTheme` to the existing `useStore()` destructure (currently `language, fontScale, setLanguage, setFontScale`):

```ts
  const {
    language,
    fontScale,
    theme,
    setLanguage,
    setFontScale,
    setTheme,
  } = useStore()
```

Add resolved-theme local state (used by the header icon in Task 7), placed with the other `useState` calls near line 94:

```ts
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("light")
```

- [ ] **Step 2: Hydrate theme on mount and apply it reactively**

Extend the existing mount-hydration effect (the one reading `csq-language` / `csq-font-scale`, ~line 132) to also read the stored theme:

```ts
  useEffect(() => {
    if (typeof window === "undefined") return
    const savedLang = window.localStorage.getItem("csq-language") as "en" | "fr" | null
    const savedScale = window.localStorage.getItem("csq-font-scale")
    const savedTheme = window.localStorage.getItem("csq-theme") as ThemeMode | null
    if (savedLang) setLanguage(savedLang)
    if (savedScale) setFontScale(Number(savedScale))
    if (savedTheme) setTheme(savedTheme)
  }, [])
```

Add a new effect after the `fontScale` effect (~line 151) that applies `.dark` and follows the OS while in `system` mode:

```ts
  useEffect(() => {
    if (typeof window === "undefined") return
    const mql = window.matchMedia("(prefers-color-scheme: dark)")
    const apply = () => {
      const resolved = resolveTheme(theme, mql.matches)
      document.documentElement.classList.toggle("dark", resolved === "dark")
      document.documentElement.style.colorScheme = resolved
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResolvedTheme(resolved)
    }
    apply()
    if (theme === "system") {
      mql.addEventListener("change", apply)
      return () => mql.removeEventListener("change", apply)
    }
  }, [theme])
```

- [ ] **Step 3: Verify type-check, lint, and existing tests**

Run: `pnpm tsc --noEmit && pnpm lint && pnpm test`
Expected: tsc clean; lint no new errors; full suite PASS (the Testcontainers integration test needs Docker — run `pnpm test` with Docker up, or scope to the unit files with `pnpm test src/lib src/app src/test/lib src/test/actions src/test/auth.test.ts src/test/auth-enrichment.test.ts` if Docker is unavailable).

- [ ] **Step 4: Commit**

```bash
git add src/components/app-shell.tsx
git commit -m "feat(theme): hydrate + apply theme with live OS-follow in AppShell"
```

### Task 7: Header quick-toggle (sun/moon)

**Files:**
- Modify: `src/components/app-shell.tsx`
- Modify: `src/lib/i18n.ts`

- [ ] **Step 1: Add the toggle aria-label keys**

In `src/lib/i18n.ts`, add to the **en** block (near `prefs.*`):

```ts
    "theme.toggle": "Toggle theme",
```

And to the **fr** block:

```ts
    "theme.toggle": "Basculer le thème",
```

- [ ] **Step 2: Add Sun/Moon to the lucide import and render the button**

In `src/components/app-shell.tsx`, add `Sun` and `Moon` to the existing `lucide-react` import.

Place the toggle in the header just before the settings button cluster (immediately before the `<div className="relative">` that wraps the Settings button, ~line 317):

```tsx
                <button
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-card text-foreground transition hover:bg-muted"
                  onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
                  aria-label={translate("theme.toggle")}
                >
                  {resolvedTheme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                </button>
```

(The quick-toggle sets an explicit light/dark choice; `system` remains selectable from Preferences. The icon shows the action — a sun when currently dark, a moon when currently light.)

- [ ] **Step 3: Verify type-check, lint, and render smoke test**

Run: `pnpm tsc --noEmit && pnpm lint && pnpm test src/app/dashboard-client.test.tsx`
Expected: tsc clean; lint no new errors; render tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/app-shell.tsx src/lib/i18n.ts
git commit -m "feat(theme): header sun/moon quick-toggle"
```

### Task 8: Theme section in the Preferences modal

**Files:**
- Modify: `src/components/app-shell.tsx`
- Modify: `src/lib/i18n.ts`

- [ ] **Step 1: Add the Preferences theme keys**

In `src/lib/i18n.ts`, add to the **en** block (next to the other `prefs.*` keys):

```ts
    "prefs.theme": "Theme",
    "prefs.theme.light": "Light",
    "prefs.theme.dark": "Dark",
    "prefs.theme.system": "System",
```

And to the **fr** block:

```ts
    "prefs.theme": "Thème",
    "prefs.theme.light": "Clair",
    "prefs.theme.dark": "Sombre",
    "prefs.theme.system": "Système",
```

- [ ] **Step 2: Render the Theme section in the modal**

In `src/components/app-shell.tsx`, inside the preferences modal's `<div className="mt-4 space-y-4">` (after the Text-size block that closes ~line 513), add:

```tsx
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-slate-400">
                  {translate("prefs.theme")}
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {(["light", "dark", "system"] as ThemeMode[]).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setTheme(mode)}
                      className={`h-9 rounded-md border text-sm ${
                        theme === mode
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border bg-background text-muted-foreground hover:bg-muted"
                      }`}
                      aria-pressed={theme === mode}
                    >
                      {translate(`prefs.theme.${mode}`)}
                    </button>
                  ))}
                </div>
              </div>
```

- [ ] **Step 3: Verify type-check, lint, and render smoke test**

Run: `pnpm tsc --noEmit && pnpm lint && pnpm test src/app/dashboard-client.test.tsx`
Expected: tsc clean; lint no new errors; render tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/app-shell.tsx src/lib/i18n.ts
git commit -m "feat(theme): Light/Dark/System control in Preferences"
```

### Task 9: Full verification + deslop (phase gate)

**Files:** none (verification only)

- [ ] **Step 1: Run the full gate**

Run: `pnpm tsc --noEmit && pnpm lint && pnpm test && pnpm build`
Expected: tsc clean; lint no new errors vs. baseline; all tests PASS (Docker up for the integration test); production build succeeds.

- [ ] **Step 2: Manual smoke (dev server)**

Run: `pnpm dev`, then in the browser:
- Toggle the header sun/moon — the whole app flips light↔dark with no flash.
- In Preferences, pick System and change the OS appearance — the app follows live.
- Reload the page on Dark — no white flash before paint (FOUC script working).
- Triage tab: advance rows show Verify / Start / Advance correctly; overdue/awaiting show Review. Switch language to French — labels translate.

- [ ] **Step 3: Run the deslop skill**

Invoke `superpowers:deslop` over the changed files and address findings (per the project phase-gate convention: deslop + all tests passing before the work is considered done).

- [ ] **Step 4: Commit any deslop fixes**

```bash
git add -A
git commit -m "chore(theme): deslop pass"
```

---

## Self-Review

- **Spec coverage:** Triage string-sniffing removed (Tasks 1–2, `action` on `WorklistItem`, label from i18n). Dark mode with Light/Dark/System (Tasks 3–4 resolver+store), header quick-toggle (Task 7) and Preferences control (Task 8) — both placements per the chosen "Both". System mode follows the OS live via the `matchMedia` listener (Task 6). FOUC prevented (Task 5). i18n covered for en+fr in every user-facing string.
- **Type consistency:** `WorklistAction = "review" | "start" | "advance" | "verify"` defined in Task 1 and consumed in Task 2 via `dashboard.action.${item.action}`. `ThemeMode = "light" | "dark" | "system"` and `resolveTheme(mode, systemPrefersDark)` defined in Task 3, consumed identically in store (Task 4) and AppShell (Task 6). `THEME_STORAGE_KEY = "csq-theme"` matches the literal used in the layout script (Task 5) and store persistence (Task 4).
- **Placeholders:** none — every code step shows the exact code; every verify step shows the command and expected result.
- **Note on tests:** theme application is a DOM side-effect (consistent with the existing untested `language`/`fontScale` effects); the pure decision is unit-tested via `resolveTheme`, and the rest is covered by tsc/lint/build + the manual smoke, matching the project's current testing posture.
