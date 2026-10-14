# CMS Google-only Sign-in Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One branded `/login` page whose only control is "Sign in with Google", an app-side refusal of anything but a verified `@csquared.com` account, and onboarding that never issues a password.

**Architecture:** A pure domain rule (`src/lib/sign-in-domain.ts`) is shared by an Auth.js `signIn` callback in the edge-safe `src/auth.config.ts` and by `onboardUser`. The login page is a client component redesigned as a two-panel layout with the existing Zustand language switch. The Keycloak side (a `cms-google-only` browser-flow override on the `csquared-cms` client) is configuration, documented here and applied by an operator.

**Tech Stack:** Next.js 16 App Router, NextAuth v5 (`5.0.0-beta.32`, Keycloak provider), Tailwind, lucide-react, React Email, Vitest + React Testing Library, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-14-cms-google-only-sign-in-design.md`

## Global Constraints

- Allowed accounts: email ends in exactly `@csquared.com` after trim + lowercase, and `email_verified === true`.
- The sign-in button calls `signIn("keycloak", { callbackUrl: "/" }, { kc_idp_hint: "google-csquared" })`, unchanged from today.
- `src/auth.config.ts` must not import the DB layer (it runs in the edge proxy).
- Brand panel colours: gradient `#0a3d91` to `#072b66`, eyebrow `#7fd0ff`. Breakpoint: Tailwind `md` (768px).
- All user-visible strings go through `t(language, key)` in `src/lib/i18n.ts`, English and French. Brand names ("CSquared") stay English.
- Run tests with `pnpm vitest run --exclude '.claude/**' <paths>`. Full gate: `pnpm test`, `pnpm tsc --noEmit`, `pnpm lint`.
- Commits: no `Co-Authored-By` or any AI trailer.
- Keycloak changes are on the `csquared-cms` client only. Never change realm-level settings (the realm is shared with the DMP).

## Review Focus

- A Google profile email in mixed case or with stray whitespace (`A@CSquared.com `) is a CSquared account and must be admitted. Pinned in Task 1.
- `src/auth.ts` overrides `callbacks` when composing; if the spread is ever dropped, the domain lock silently disappears. Pinned in Task 2.
- An unexpected or hostile `?error=` value (`OAuthCallback`, `<b>x</b>`) must show the generic retry banner and never echo the raw value. Pinned in Task 3.
- A French user on `/login` switches language with the pill and the choice persists (`setLanguage`). Pinned in Task 3.
- An admin typing `New@CSquared.com ` in the onboarding wizard is onboarded, not refused, because sign-in would admit that person. Pinned in Task 4.

---

### Task 1: The domain rule

**Files:**
- Create: `src/lib/sign-in-domain.ts`
- Test: `src/test/lib/sign-in-domain.test.ts`

**Interfaces:**
- Produces: `export function isAllowedSignInEmail(email: unknown): boolean`

- [ ] **Step 1: Write the failing test**

```ts
// src/test/lib/sign-in-domain.test.ts
import { describe, it, expect } from "vitest"
import { isAllowedSignInEmail } from "@/lib/sign-in-domain"

describe("isAllowedSignInEmail", () => {
  it.each(["a@csquared.com", "A@CSquared.com ", "  first.last@csquared.com"])("admits %j", (email) => {
    expect(isAllowedSignInEmail(email)).toBe(true)
  })

  it.each([
    "a@csquared.com.evil.io",
    "a@notcsquared.com",
    "a@sub.csquared.com",
    "csquared.com",
    "@csquared.com",
    "",
    "   ",
    undefined,
    null,
    42,
  ])("refuses %j", (email) => {
    expect(isAllowedSignInEmail(email)).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run --exclude '.claude/**' src/test/lib/sign-in-domain.test.ts`
Expected: FAIL, cannot resolve `@/lib/sign-in-domain`.

- [ ] **Step 3: Implement**

```ts
// src/lib/sign-in-domain.ts
const ALLOWED_SUFFIX = "@csquared.com"

/** The CMS is internal: only CSquared Google Workspace accounts may sign in or be onboarded. */
export function isAllowedSignInEmail(email: unknown): boolean {
  if (typeof email !== "string") return false
  const normalized = email.trim().toLowerCase()
  return normalized.length > ALLOWED_SUFFIX.length && normalized.endsWith(ALLOWED_SUFFIX)
}
```

- [ ] **Step 4: Run it to make sure it passes**

Run: `pnpm vitest run --exclude '.claude/**' src/test/lib/sign-in-domain.test.ts`
Expected: PASS (13 cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/sign-in-domain.ts src/test/lib/sign-in-domain.test.ts
git commit -m "feat(auth): one rule for which emails may use the CMS"
```

---

### Task 2: Refuse other accounts at sign-in

**Files:**
- Modify: `src/auth.config.ts` (the `callbacks` object)
- Test: `src/test/auth-config-pages.test.ts`, `src/test/auth.test.ts`

**Interfaces:**
- Consumes: `isAllowedSignInEmail(email: unknown): boolean` from Task 1.
- Produces: `authConfig.callbacks.signIn({ profile })` returning `boolean`. Auth.js turns `false` into a redirect to `pages.error` (`/login`) with `?error=AccessDenied`, and logs it through `logger.error`.

- [ ] **Step 1: Write the failing tests**

Append to `src/test/auth-config-pages.test.ts`, inside `describe("auth config", ...)`:

```ts
  describe("signIn callback: verified @csquared.com accounts only", () => {
    type SignInParams = Parameters<NonNullable<NonNullable<typeof authConfig.callbacks>["signIn"]>>[0]
    const signIn = (profile: Record<string, unknown> | undefined) =>
      authConfig.callbacks!.signIn!({ user: {}, account: null, profile } as unknown as SignInParams)

    it("admits a verified CSquared account", async () => {
      expect(await signIn({ email: "ada@csquared.com", email_verified: true })).toBe(true)
    })

    it("admits mixed case and stray whitespace", async () => {
      expect(await signIn({ email: " Ada@CSquared.com ", email_verified: true })).toBe(true)
    })

    it("refuses an unverified email", async () => {
      expect(await signIn({ email: "ada@csquared.com", email_verified: false })).toBe(false)
      expect(await signIn({ email: "ada@csquared.com" })).toBe(false)
    })

    it("refuses another domain and lookalikes", async () => {
      expect(await signIn({ email: "ada@gmail.com", email_verified: true })).toBe(false)
      expect(await signIn({ email: "ada@csquared.com.evil.io", email_verified: true })).toBe(false)
    })

    it("refuses a sign-in with no profile", async () => {
      expect(await signIn(undefined)).toBe(false)
    })
  })
```

Replace `src/test/auth.test.ts` with:

```ts
import { describe, it, expect, vi } from 'vitest'

const { captured } = vi.hoisted(() => ({ captured: { config: undefined as unknown } }))
vi.mock('next-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-auth')>()
  return {
    ...actual,
    default: (config: unknown) => {
      captured.config = config
      return actual.default(config as Parameters<typeof actual.default>[0])
    },
  }
})

describe('auth module exports', () => {
  it('exports handlers, auth, signIn, signOut', async () => {
    const mod = await import('@/auth')
    expect(mod.handlers).toBeDefined()
    expect(mod.auth).toBeDefined()
    expect(mod.signIn).toBeDefined()
    expect(mod.signOut).toBeDefined()
  })

  it('keeps the edge config signIn callback, so the domain lock is live', async () => {
    await import('@/auth')
    const authConfig = (await import('@/auth.config')).default
    const config = captured.config as { callbacks: Record<string, unknown> }
    expect(typeof config.callbacks.signIn).toBe('function')
    expect(config.callbacks.signIn).toBe(authConfig.callbacks!.signIn)
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm vitest run --exclude '.claude/**' src/test/auth-config-pages.test.ts src/test/auth.test.ts`
Expected: FAIL. The five `signIn` cases throw because `authConfig.callbacks.signIn` is undefined, and the composition test fails on `typeof ... toBe('function')`.

- [ ] **Step 3: Implement**

In `src/auth.config.ts`, add the import under the existing imports:

```ts
import { isAllowedSignInEmail } from "@/lib/sign-in-domain"
```

and add `signIn` as the first entry of `callbacks`, before `jwt`:

```ts
    // Google @csquared.com only. Keycloak's cms-google-only flow already forces Google;
    // this is the in-app lock if that client setting is ever reverted. A refusal lands on
    // /login?error=AccessDenied and is logged through logger.error above.
    signIn({ profile }) {
      return profile?.email_verified === true && isAllowedSignInEmail(profile.email)
    },
```

- [ ] **Step 4: Run them to make sure they pass**

Run: `pnpm vitest run --exclude '.claude/**' src/test/auth-config-pages.test.ts src/test/auth.test.ts src/test/auth-enrichment.test.ts`
Expected: PASS. In the composition test `config.callbacks.signIn` is now a function and identical to the edge config's.

- [ ] **Step 5: Commit**

```bash
git add src/auth.config.ts src/test/auth-config-pages.test.ts src/test/auth.test.ts
git commit -m "feat(auth): refuse anything but a verified @csquared.com account at sign-in"
```

---

### Task 3: The branded sign-in page

**Files:**
- Modify: `src/app/login/page.tsx` (full rewrite)
- Modify: `src/lib/i18n.ts` (the `auth.*` block in `en`, lines ~296-320, and in `fr`, lines ~1109-1133)
- Test: `src/app/login/page.test.tsx` (full rewrite)

**Interfaces:**
- Consumes: `useStore()` from `@/lib/store` (`language`, `setLanguage`), `t()` from `@/lib/i18n`, `signIn` from `next-auth/react`.
- Produces: nothing other tasks use.

- [ ] **Step 1: Write the failing test**

Replace `src/app/login/page.test.tsx` with:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@testing-library/react"

const { signIn, searchParams, store } = vi.hoisted(() => ({
  signIn: vi.fn(),
  searchParams: { current: new URLSearchParams() },
  store: { language: "en" as "en" | "fr", setLanguage: vi.fn() },
}))
vi.mock("next-auth/react", () => ({ signIn }))
vi.mock("next/navigation", () => ({ useSearchParams: () => searchParams.current }))
vi.mock("@/lib/store", () => ({ useStore: () => store }))

import LoginPage from "@/app/login/page"

beforeEach(() => {
  signIn.mockClear()
  store.setLanguage.mockClear()
  store.language = "en"
  searchParams.current = new URLSearchParams()
})
afterEach(() => cleanup())

describe("LoginPage", () => {
  it("offers Google as the only way in", () => {
    const { container } = render(<LoginPage />)
    expect(screen.getByRole("button", { name: "Sign in with Google" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^sign in$/i })).toBeNull()
    expect(container.querySelector("input")).toBeNull()
  })

  it("sends people to Google through the google-csquared IdP", () => {
    render(<LoginPage />)
    fireEvent.click(screen.getByRole("button", { name: "Sign in with Google" }))
    expect(signIn).toHaveBeenCalledWith("keycloak", { callbackUrl: "/" }, { kc_idp_hint: "google-csquared" })
  })

  it("tells people only CSquared accounts can sign in", () => {
    render(<LoginPage />)
    expect(screen.getByText("For CSquared staff only. Only @csquared.com accounts can sign in.")).toBeInTheDocument()
  })

  it("shows no banner on a plain visit", () => {
    render(<LoginPage />)
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("explains a refused account", () => {
    searchParams.current = new URLSearchParams("error=AccessDenied")
    render(<LoginPage />)
    const alert = screen.getByRole("alert")
    expect(alert.textContent).toContain("Access refused")
    expect(alert.textContent).toContain("Only @csquared.com accounts can sign in.")
  })

  it("explains a failed sign-in callback and offers a retry", () => {
    // Auth.js redirects here (pages.error) with ?error=Configuration when the OIDC
    // callback fails, e.g. a PKCE mismatch from a stale or duplicated login tab.
    searchParams.current = new URLSearchParams("error=Configuration")
    render(<LoginPage />)
    expect(screen.getByRole("alert").textContent).toContain("Sign-in didn't complete")
    fireEvent.click(screen.getByRole("button", { name: "Sign in with Google" }))
    expect(signIn).toHaveBeenCalledWith("keycloak", { callbackUrl: "/" }, { kc_idp_hint: "google-csquared" })
  })

  it("shows the generic banner for any other code and never echoes it", () => {
    searchParams.current = new URLSearchParams("error=<b>x</b>")
    render(<LoginPage />)
    const alert = screen.getByRole("alert")
    expect(alert.textContent).toContain("Sign-in didn't complete")
    expect(alert.textContent).not.toContain("<b>x</b>")
  })

  it("switches language from the pill", () => {
    render(<LoginPage />)
    fireEvent.click(screen.getByRole("button", { name: "FR" }))
    expect(store.setLanguage).toHaveBeenCalledWith("fr")
  })

  it("renders entirely in French", () => {
    store.language = "fr"
    searchParams.current = new URLSearchParams("error=AccessDenied")
    render(<LoginPage />)
    expect(screen.getByRole("button", { name: "Se connecter avec Google" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Connexion" })).toBeInTheDocument()
    expect(screen.getByRole("alert").textContent).toContain("Accès refusé")
    expect(screen.getAllByText("Chaque changement réseau, demandé, approuvé et tracé.").length).toBeGreaterThan(0)
    expect(screen.queryByText(/Sign in with Google|Access refused|Every network change/)).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run --exclude '.claude/**' src/app/login/page.test.tsx`
Expected: FAIL (no "Sign in with Google" button, the password button still exists).

- [ ] **Step 3: Update the strings**

In `src/lib/i18n.ts`, `en` block: replace the lines from `"auth.signIn"` through `"auth.requirement.symbol"` with:

```ts
    "auth.signIn": "Sign in",
    "auth.subtitle": "Use your CSquared Google account to continue.",
    "auth.google": "Sign in with Google",
    "auth.email": "Email",
    "auth.staffOnly": "For CSquared staff only. Only @csquared.com accounts can sign in.",
    "auth.language": "Language",
    "auth.brand.product": "Change Management",
    "auth.brand.eyebrow": "CHANGE MANAGEMENT SYSTEM",
    "auth.brand.headline": "Every network change, raised, approved and recorded.",
    "auth.brand.raise": "Raise a change",
    "auth.brand.raiseDesc": "One form for every OpCo and infrastructure type",
    "auth.brand.cab": "CAB approval",
    "auth.brand.cabDesc": "Routed to the right approvers, with separation of duties",
    "auth.brand.audit": "Audit-ready",
    "auth.brand.auditDesc": "Every decision and review kept for ISO 27001",
    "auth.brand.footer": "Ghana · Uganda · Liberia · Mauritius · DRC · Togo · Group",
    "auth.error.domain": "Access refused",
    "auth.error.domainDesc": "Only @csquared.com accounts can sign in.",
    "auth.error.callback": "Sign-in didn't complete",
    "auth.error.callbackDesc": "Your sign-in expired or was started in another tab. Please sign in again.",
```

`fr` block: replace the lines from `"auth.signIn"` through `"auth.requirement.symbol"` with:

```ts
    "auth.signIn": "Connexion",
    "auth.subtitle": "Utilisez votre compte Google CSquared pour continuer.",
    "auth.google": "Se connecter avec Google",
    "auth.email": "Email",
    "auth.staffOnly": "Réservé au personnel CSquared. Seuls les comptes @csquared.com peuvent se connecter.",
    "auth.language": "Langue",
    "auth.brand.product": "Gestion des changements",
    "auth.brand.eyebrow": "SYSTÈME DE GESTION DES CHANGEMENTS",
    "auth.brand.headline": "Chaque changement réseau, demandé, approuvé et tracé.",
    "auth.brand.raise": "Demander un changement",
    "auth.brand.raiseDesc": "Un seul formulaire pour chaque OpCo et type d’infrastructure",
    "auth.brand.cab": "Approbation CAB",
    "auth.brand.cabDesc": "Acheminée aux bons approbateurs, avec séparation des tâches",
    "auth.brand.audit": "Prêt pour l’audit",
    "auth.brand.auditDesc": "Chaque décision et revue conservée pour l’ISO 27001",
    "auth.brand.footer": "Ghana · Ouganda · Liberia · Maurice · RDC · Togo · Groupe",
    "auth.error.domain": "Accès refusé",
    "auth.error.domainDesc": "Seuls les comptes @csquared.com peuvent se connecter.",
    "auth.error.callback": "La connexion n'a pas abouti",
    "auth.error.callbackDesc": "Votre connexion a expiré ou a été lancée dans un autre onglet. Veuillez vous reconnecter.",
```

`auth.email` stays because `src/app/(dashboard)/settings/profile/page.tsx` uses it. Before saving, confirm nothing else uses the removed keys:

Run: `grep -rnE '"auth\.(or|password|showPassword|hidePassword|submit|passwordRequirements|requirement\.|error\.(policy|missing|failed))' src | grep -v src/lib/i18n.ts`
Expected: only `src/app/login/page.tsx` (rewritten in Step 4), nothing else. If anything else appears, keep that key.

- [ ] **Step 4: Rewrite the page**

```tsx
// src/app/login/page.tsx
"use client"

import { Suspense } from "react"
import Image from "next/image"
import { useSearchParams } from "next/navigation"
import { signIn } from "next-auth/react"
import { ArrowUpRight, ClipboardCheck, ShieldCheck, type LucideIcon } from "lucide-react"
import { useStore } from "@/lib/store"
import { t, type Language } from "@/lib/i18n"
import { Button } from "@/components/ui/button"

const FEATURES: Array<{ icon: LucideIcon; title: string; desc: string }> = [
  { icon: ArrowUpRight, title: "auth.brand.raise", desc: "auth.brand.raiseDesc" },
  { icon: ShieldCheck, title: "auth.brand.cab", desc: "auth.brand.cabDesc" },
  { icon: ClipboardCheck, title: "auth.brand.audit", desc: "auth.brand.auditDesc" },
]

export default function LoginPage() {
  // useSearchParams needs a Suspense boundary so the page can still prerender.
  return (
    <Suspense>
      <SignIn />
    </Suspense>
  )
}

function SignIn() {
  const { language, setLanguage } = useStore()
  const error = useSearchParams().get("error")
  // AccessDenied = the signIn callback refused the account. Anything else is a failed
  // or stale callback; never echo the raw code.
  const banner = error === "AccessDenied" ? "auth.error.domain" : "auth.error.callback"

  async function handleGoogleLogin() {
    // kc_idp_hint skips Keycloak's own page and goes straight to the dedicated,
    // csquared.com-restricted Google identity provider for this app.
    await signIn("keycloak", { callbackUrl: "/" }, { kc_idp_hint: "google-csquared" })
  }

  return (
    <div className="flex min-h-dvh flex-col md:grid md:grid-cols-[1.05fr_1fr]">
      <header className="flex items-center gap-2 bg-[#0a3d91] px-4 py-3 text-white md:hidden">
        <Logo size={26} />
        <span className="font-semibold">CSquared</span>
        <span className="text-sm opacity-75">· {t(language, "auth.brand.product")}</span>
      </header>

      <aside className="hidden flex-col bg-gradient-to-br from-[#0a3d91] to-[#072b66] p-10 text-white md:flex">
        <div className="flex items-center gap-3">
          <Logo size={36} />
          <span className="text-lg font-semibold">CSquared</span>
        </div>
        <div className="my-auto max-w-md py-10">
          <p className="text-xs font-bold tracking-[0.16em] text-[#7fd0ff]">{t(language, "auth.brand.eyebrow")}</p>
          <p className="mt-3 text-3xl font-bold leading-tight">{t(language, "auth.brand.headline")}</p>
          <ul className="mt-8 space-y-5">
            {FEATURES.map(({ icon: Icon, title, desc }) => (
              <li key={title} className="flex gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-[#00a3ff]/35 bg-[#00a3ff]/15 text-[#7fd0ff]">
                  <Icon className="size-4" aria-hidden />
                </span>
                <span>
                  <span className="block font-medium">{t(language, title)}</span>
                  <span className="block text-sm opacity-70">{t(language, desc)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs opacity-65">{t(language, "auth.brand.footer")}</p>
      </aside>

      <main className="relative flex flex-1 flex-col justify-center px-6 py-16 md:px-16">
        <LanguageSwitch language={language} onChange={setLanguage} />
        <div className="mx-auto w-full max-w-sm">
          <h1 className="text-3xl font-bold">{t(language, "auth.signIn")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t(language, "auth.subtitle")}</p>
          {error && (
            <div role="alert" className="mt-6 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
              <p className="font-medium">{t(language, banner)}</p>
              <p className="text-muted-foreground">{t(language, `${banner}Desc`)}</p>
            </div>
          )}
          <Button variant="outline" className="mt-6 h-11 w-full gap-3 text-sm font-semibold" onClick={handleGoogleLogin}>
            <GoogleMark />
            {t(language, "auth.google")}
          </Button>
          <p className="mt-4 text-xs text-muted-foreground">{t(language, "auth.staffOnly")}</p>
        </div>
      </main>
    </div>
  )
}

function Logo({ size }: { size: number }) {
  return (
    <Image src="/csquared-icon.png" alt="CSquared logo" width={size} height={size} unoptimized className="shrink-0 rounded-full bg-white" />
  )
}

function LanguageSwitch({ language, onChange }: { language: Language; onChange: (l: Language) => void }) {
  return (
    <div role="group" aria-label={t(language, "auth.language")} className="absolute right-4 top-4 flex gap-0.5 rounded-full border p-0.5 text-xs">
      {(["en", "fr"] as const).map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={language === l}
          onClick={() => onChange(l)}
          className={`rounded-full px-2.5 py-1 font-medium ${language === l ? "bg-[#0a3d91] text-white" : "text-muted-foreground"}`}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  )
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="size-[18px]" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  )
}
```

- [ ] **Step 5: Run it to make sure it passes**

Run: `pnpm vitest run --exclude '.claude/**' src/app/login/page.test.tsx`
Expected: PASS (9 tests). If the French test's `getAllByText` finds nothing, the headline is rendered only in the `md:flex` aside, which jsdom still renders (Tailwind classes do not hide elements in jsdom), so check the key spelling first.

- [ ] **Step 6: Type-check and lint the two files**

Run: `pnpm tsc --noEmit && pnpm lint src/app/login src/lib/i18n.ts`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/login/page.tsx src/app/login/page.test.tsx src/lib/i18n.ts
git commit -m "feat(login): one branded sign-in page with Google as the only way in"
```

---

### Task 4: Onboarding without passwords

**Files:**
- Modify: `src/server/keycloak.ts` (`createKeycloakUser`, `createOrFindKeycloakUser`; delete `getFederatedIdentities` and `resetKeycloakPassword`)
- Modify: `src/server/actions/users.ts` (`onboardUser`, imports)
- Modify: `src/server/email.tsx` (`sendUserInvitationEmail`)
- Modify: `src/emails/invitation.tsx`
- Modify: `src/app/(dashboard)/users/onboard-wizard.tsx`
- Modify: `src/lib/i18n.ts` (remove `users.wizard.password`, `users.wizard.passwordPlaceholder`, `users.wizard.passwordHint` in `en` and `fr`)
- Test: `src/test/actions/users-authz.test.ts`, `src/test/actions/users-reconcile.test.ts`, `src/test/server/email-invite.test.ts`, `src/test/server/email.test.ts`, `src/test/emails/render.test.ts`, `src/test/server/keycloak.test.ts`, `src/test/server/keycloak-reconcile.test.ts`

**Interfaces:**
- Consumes: `isAllowedSignInEmail(email: unknown): boolean` from Task 1.
- Produces:
  - `onboardUser(input: { name: string; email: string; assignments: Array<{ opcoSlug: string; role: Role }> })`
  - `createOrFindKeycloakUser(email: string, name: string): Promise<{ id: string; created: boolean }>`
  - `createKeycloakUser(email: string, name: string): Promise<string>`
  - `sendUserInvitationEmail(opts: { to: string; name: string; assignments: Array<{ opcoSlug: string; role: string }>; locale?: Language })`
  - `InvitationEmailProps = { name: string; assignments: Array<{ opcoSlug: string; role: string }>; lang: Language }`

- [ ] **Step 1: Rewrite the onboarding tests to the new contract**

In `src/test/actions/users-authz.test.ts`:
- Delete `tempPassword: "p",` from every `onboardUser({...})` call (six places).
- In "lets a group_admin create a brand-new user...", replace the `sendUserInvitationEmail` expectation with:

```ts
    expect(sendUserInvitationEmail).toHaveBeenCalledWith({
      to: "new@csquared.com",
      name: "New",
      assignments: [{ opcoSlug: "ghana", role: "requester" }],
      locale: "en",
    })
    expect(createOrFindKeycloakUser).toHaveBeenCalledWith("new@csquared.com", "New")
```

- In "links an existing email..." and "links a Keycloak-only existing email...", replace each `expect.objectContaining({ to: ..., existingIdentity: true })` with `expect.objectContaining({ to: "<same address>" })`, and rename the second test to `"links a Keycloak-only existing email instead of creating a new identity"`.
- Add, inside the same `describe`:

```ts
  it("refuses an address outside @csquared.com before touching Keycloak", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    await expect(onboardUser({
      name: "Partner", email: "pat@partner.com",
      assignments: [{ opcoSlug: "ghana", role: "requester" }],
    })).rejects.toThrow("Only @csquared.com addresses can be onboarded.")
    expect(createOrFindKeycloakUser).not.toHaveBeenCalled()
    expect(mockDb.user.create).not.toHaveBeenCalled()
  })

  it("onboards a CSquared address typed with capitals or spaces", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    await onboardUser({
      name: "New", email: "New@CSquared.com ",
      assignments: [{ opcoSlug: "ghana", role: "requester" }],
    })
    expect(createOrFindKeycloakUser).toHaveBeenCalledTimes(1)
  })
```

Replace the `describe('onboardUser — adopt-path reconcile (Task B3)', ...)` block in `src/test/actions/users-reconcile.test.ts` (keep its `beforeEach`) with these tests, and remove `getFederatedIdentities` and `resetKeycloakPassword` from the `vi.mock('@/server/keycloak', ...)` factory and the import list at the top of the file:

```ts
  it('adopted Keycloak account: enabled + verified, no password touched', async () => {
    vi.mocked(createOrFindKeycloakUser).mockResolvedValueOnce({ id: 'kc-1', created: false })

    await onboardUser({
      name: 'Adopted User', email: 'adopted@csquared.com',
      assignments: [{ opcoSlug: 'ghana', role: 'requester' }],
    })

    expect(ensureKeycloakUserEnabledVerified).toHaveBeenCalledWith('kc-1')
    expect(sendUserInvitationEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'adopted@csquared.com' }))
  })

  it('brand-new user: no reconcile, Google invite', async () => {
    vi.mocked(createOrFindKeycloakUser).mockResolvedValueOnce({ id: 'kc-new', created: true })

    await onboardUser({
      name: 'New User', email: 'new@csquared.com',
      assignments: [{ opcoSlug: 'ghana', role: 'requester' }],
    })

    expect(ensureKeycloakUserEnabledVerified).not.toHaveBeenCalled()
    expect(sendUserInvitationEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'new@csquared.com' }))
  })
```

- [ ] **Step 2: Rewrite the email and Keycloak tests**

Replace the `describe(...)` in `src/test/server/email-invite.test.ts` with:

```ts
describe('sendUserInvitationEmail', () => {
  it.each([
    ['en', /Sign in with Google/, /password/i],
    ['fr', /Se connecter avec Google/, /mot de passe/i],
  ] as const)('tells people to sign in with Google and never mentions a password (%s)', async (locale, google, password) => {
    const { sendUserInvitationEmail } = await import('@/server/email')
    await sendUserInvitationEmail({
      to: 'pat@csquared.com',
      name: 'Pat',
      assignments: [{ opcoSlug: 'ghana', role: 'requester' }],
      locale,
    })
    const html = lastHtml()
    expect(html).toMatch(google)
    expect(html).not.toMatch(password)
  })
})
```

In `src/test/server/email.test.ts`, the "invitation: French subject" test becomes:

```ts
  it('invitation: French subject when locale=fr', async () => {
    const { sendUserInvitationEmail } = await import('@/server/email')
    await sendUserInvitationEmail({ to: 'a@x.com', name: 'Ada', assignments: [{ opcoSlug: 'drc', role: 'requester' }], locale: 'fr' })
    expect(lastSubject()).toMatch(/invité/i)
    expect(lastHtml()).toMatch(/Se connecter avec Google/)
  })
```

In `src/test/emails/render.test.ts` line 13, change the invitation props to `{ name: "A", assignments: [{ opcoSlug: "ghana", role: "requester" }], lang }`.

In `src/test/server/keycloak.test.ts`: change both `createKeycloakUser('a@x.com', 'Ada Lovelace', 'temp-pw')` calls to `createKeycloakUser('a@x.com', 'Ada Lovelace')`, and at the end of the first test add:

```ts
    const body = JSON.parse((opts as RequestInit).body as string)
    expect(body).not.toHaveProperty('credentials')
    expect(body).toMatchObject({ username: 'a@x.com', email: 'a@x.com', enabled: true, emailVerified: true })
```

In `src/test/server/keycloak-reconcile.test.ts`, delete the `getFederatedIdentities ...` and `resetKeycloakPassword PUTs a temporary credential` tests.

- [ ] **Step 3: Run them to make sure they fail**

Run: `pnpm vitest run --exclude '.claude/**' src/test/actions/users-authz.test.ts src/test/actions/users-reconcile.test.ts src/test/server/email-invite.test.ts src/test/server/email.test.ts src/test/server/keycloak.test.ts`
Expected: FAIL. The new-domain test does not throw, the invite still mentions a password, and the create-user body still has `credentials`.

- [ ] **Step 4: Keycloak helpers**

In `src/server/keycloak.ts`:

```ts
export async function createKeycloakUser(email: string, name: string): Promise<string> {
  const result = await createOrFindKeycloakUser(email, name)
  return result.id
}

export async function createOrFindKeycloakUser(
  email: string,
  name: string
): Promise<{ id: string; created: boolean }> {
```

Delete the `credentials: [{ type: "password", value: tempPassword, temporary: true }],` line from the POST body; add above `const res = await fetch(...)`:

```ts
  // No credentials: CMS sign-in is Google-only. The first Google sign-in links to this
  // account by verified email (first-broker-login auto-link on google-csquared).
```

Delete the whole `getFederatedIdentities` function and the whole `resetKeycloakPassword` function (with its doc comment).

- [ ] **Step 5: `onboardUser`**

In `src/server/actions/users.ts`:
- Import line 8 becomes:

```ts
import { createOrFindKeycloakUser, assignToOrganization, deactivateKeycloakUser, reactivateKeycloakUser, ensureKeycloakUserEnabledVerified } from "@/server/keycloak"
```

- Add `import { isAllowedSignInEmail } from "@/lib/sign-in-domain"` with the other `@/lib` imports.
- Remove `tempPassword: string` from the `onboardUser` input type.
- After `if (input.assignments.length === 0) throw ...`, add:

```ts
  if (!isAllowedSignInEmail(input.email)) throw new Error("Only @csquared.com addresses can be onboarded.")
```

- Remove `let isFederated = false`.
- `createOrFindKeycloakUser(input.email, input.name, input.tempPassword)` becomes `createOrFindKeycloakUser(input.email, input.name)`.
- Replace the adopted-account block (the comment starting `// Reconcile an ADOPTED Keycloak account` through its closing `}`) with:

```ts
  // An ADOPTED Keycloak account (a re-invite after a DB wipe, or someone already on the
  // shared realm) must be able to sign in: enable + verify it. Its password is never
  // touched, so a CMS invite cannot lock anyone out of another app on the realm.
  if (!createdKeycloakIdentity) {
    try {
      await ensureKeycloakUserEnabledVerified(keycloakId)
    } catch (err) {
      console.warn(`[onboardUser] Keycloak reconcile skipped for ${input.email}:`, err)
    }
  }
```

- The `sendUserInvitationEmail({...})` call becomes:

```ts
    await sendUserInvitationEmail({
      to: input.email,
      name: input.name,
      assignments: input.assignments,
      locale: inviteLocale,
    })
```

- [ ] **Step 6: The invitation email**

In `src/server/email.tsx`, `sendUserInvitationEmail` becomes:

```tsx
export async function sendUserInvitationEmail(opts: {
  to: string
  name: string
  assignments: Array<{ opcoSlug: string; role: string }>
  locale?: Language
}) {
  const fr = opts.locale === "fr"
  const subject = fr ? "Vous êtes invité à CSquared CMS" : "You're invited to CSquared CMS"
  const el = <InvitationEmail name={opts.name} assignments={opts.assignments} lang={opts.locale ?? "en"} />
  const html = await render(el)
  const text = await render(el, { plainText: true })
  await dispatchEmail(opts.to, subject, html, text)
}
```

In `src/emails/invitation.tsx`, replace the props interface and the copy selection:

```tsx
export interface InvitationEmailProps {
  name: string
  assignments: Array<{ opcoSlug: string; role: string }>
  lang: Language
}

export default function InvitationEmail({ name, assignments, lang }: InvitationEmailProps) {
  const fr = lang === "fr"
  const signInCopy = fr
    ? "Connectez-vous avec Google (« Se connecter avec Google ») en utilisant votre adresse @csquared.com."
    : 'Sign in with Google ("Sign in with Google") using your @csquared.com address.'
```

and change `<Text className="text-sm text-slate-700">{passwordCopy}</Text>` to `{signInCopy}`. The French copy drops "Aucun mot de passe n'est requis" so the email never contains "mot de passe"; the English drops "No password is required." for the same reason.

- [ ] **Step 7: The wizard**

In `src/app/(dashboard)/users/onboard-wizard.tsx`:
- Delete `const [password, setPassword] = useState("")`.
- `await onboardUser({ name, email, tempPassword: password || "ChangeMe123!", assignments })` becomes `await onboardUser({ name, email, assignments })`.
- Delete the `<div>` that wraps the `users.wizard.password` label, its `<Input type="password" ...>` and the `users.wizard.passwordHint` paragraph (step 1).
- Delete `<p>{t(language, "users.wizard.passwordHint")}</p>` in the review step (step 2).

In `src/lib/i18n.ts`, delete `users.wizard.password`, `users.wizard.passwordPlaceholder` and `users.wizard.passwordHint` from both `en` and `fr`. Confirm:

Run: `grep -rn "users.wizard.password\|tempPassword\|ChangeMe123\|resetKeycloakPassword\|getFederatedIdentities" src`
Expected: no output.

- [ ] **Step 8: Run the tests, type-check and lint**

Run: `pnpm vitest run --exclude '.claude/**' src/test/actions src/test/server src/test/emails && pnpm tsc --noEmit && pnpm lint`
Expected: PASS, no type errors, no lint errors.

- [ ] **Step 9: Commit**

```bash
git add src/server/keycloak.ts src/server/actions/users.ts src/server/email.tsx src/emails/invitation.tsx "src/app/(dashboard)/users/onboard-wizard.tsx" src/lib/i18n.ts src/test/actions/users-authz.test.ts src/test/actions/users-reconcile.test.ts src/test/server/email-invite.test.ts src/test/server/email.test.ts src/test/emails/render.test.ts src/test/server/keycloak.test.ts src/test/server/keycloak-reconcile.test.ts
git commit -m "feat(users): onboarding issues no passwords and refuses non-CSquared addresses"
```

---

### Task 5: Operator docs

**Files:**
- Create: `docs/keycloak-cms-google-only-flow.md`
- Modify: `deploy/PROD-RUNBOOK.md` (after the **3b** block in section 3)
- Modify: `CLAUDE.md` (the Auth paragraph)
- Modify (other branch): `docs/superpowers/specs/2026-10-08-db-group-roles-provisioning-design.md` on `feat/db-group-roles`

- [ ] **Step 1: Write the operator doc**

```markdown
# CMS sign-in: Google only (Keycloak operator steps)

The CMS signs people in with Google `@csquared.com` accounts only. The app already
refuses anything else (`signIn` callback in `src/auth.config.ts`). This Keycloak setting
makes sure the CMS never shows a password form, even when someone types the Keycloak
address by hand.

Realm `csquared` on `id.csquarednet.com` is shared with the DMP and other apps.
Everything below is on the `csquared-cms` client or a new, unattached flow. Do not change
the realm's own browser flow.

## Before you start

List the CMS's Keycloak accounts with no Google link (Users → user → Identity provider
links). A real `@csquared.com` mailbox links itself on its first Google sign-in. An
address with no mailbox loses CMS access once this is on; emergency access is the
Keycloak admin console.

## 1. Create the flow

1. Authentication → **Create flow**. Name `cms-google-only`, type **Basic flow**. Create.
2. **Add execution** → **Identity Provider Redirector**. Requirement **Required**.
3. Its ⚙ settings: alias `cms-google-csquared`, **Default Identity Provider**
   `google-csquared`. Save.

No Cookie step, on purpose: a Keycloak session started elsewhere (a DMP password
sign-in) must not carry into the CMS.

## 2. Attach it to the CMS client only

Clients → `csquared-cms` → **Advanced** → *Authentication flow overrides* →
**Browser flow** = `cms-google-only`. Save. It takes effect at once; no restart.

## 3. Check

- Open `https://id.csquarednet.com/realms/csquared/protocol/openid-connect/auth?client_id=csquared-cms&response_type=code&scope=openid&redirect_uri=https%3A%2F%2Fcms.csquarednet.com%2Fapi%2Fauth%2Fcallback%2Fkeycloak`
  in a private window. It must go straight to Google and never show a password form.
- Sign in to https://cms.csquarednet.com with your own account, sign out, and sign in again.
- Try a non-`@csquared.com` Google account: Google refuses it, or the CMS shows
  "Access refused".

## Undo

Clients → `csquared-cms` → Advanced → clear the **Browser flow** override. Save.

## Also required

`google-csquared` keeps **Trust Email = ON** and hosted domain `csquared.com`
(see `docs/keycloak-first-broker-login-autolink.md`).
```

- [ ] **Step 2: Link it from the runbook**

In `deploy/PROD-RUNBOOK.md`, insert after the **3b** bullet list (before the `> **About manage-organizations ...` note):

```markdown
**3c. Google-only sign-in** (after the app is live)
- Follow `docs/keycloak-cms-google-only-flow.md`: a `cms-google-only` browser-flow
  override on `csquared-cms`, so the CMS never shows a password form.
```

- [ ] **Step 3: Update CLAUDE.md**

In the Auth paragraph of `CLAUDE.md`, replace the last sentence (`The seeded admin account is ...`) with:

```markdown
Sign-in is Google `@csquared.com` only: `/login` has one button (`kc_idp_hint=google-csquared`), the `signIn` callback in `src/auth.config.ts` refuses any other account via `src/lib/sign-in-domain.ts`, and in prod the `csquared-cms` client uses the `cms-google-only` Keycloak flow (`docs/keycloak-cms-google-only-flow.md`). Onboarding creates Keycloak accounts with no password. The seeded `devops@csquared.com` / `Admin2025$` account is for the local Keycloak only.
```

- [ ] **Step 4: Commit**

```bash
git add docs/keycloak-cms-google-only-flow.md deploy/PROD-RUNBOOK.md CLAUDE.md
git commit -m "docs(auth): Google-only sign-in operator steps"
```

- [ ] **Step 5: Mark the superseded invite section on `feat/db-group-roles`**

```bash
git switch feat/db-group-roles
```

At the top of `docs/superpowers/specs/2026-10-08-db-group-roles-provisioning-design.md`, under the title, add:

```markdown
> **2026-10-14:** the invite design in this spec (`inviteIdentity`, `execute-actions-email`
> set-password links) is superseded by `2026-10-14-cms-google-only-sign-in-design.md` on
> `dev`: CMS sign-in is Google-only and onboarding issues no password. The group-role
> sections still stand.
```

```bash
git add docs/superpowers/specs/2026-10-08-db-group-roles-provisioning-design.md
git commit -m "docs(spec): invite section superseded by Google-only sign-in"
git switch feat/cms-google-only-sign-in
```

---

### Task 6: Browser check, gate, PR

**Files:** none new.

- [ ] **Step 1: Start the app**

Port 3000 may be taken by the DMP. `/login` needs no database.

Run (background): `PORT=3100 pnpm dev`
Then wait for `Ready` in its output.

- [ ] **Step 2: Check the page with the Playwright MCP**

At `http://localhost:3100/login`, take a screenshot at each of:
- 1440×900, 820×1180, 390×844, with no `error`
- 1440×900 with `?error=AccessDenied`
- 390×844 with `?error=Configuration`
- 1440×900 after clicking `FR`

Check: the brand panel shows only at 820 and 1440; the phone shows the navy header bar; no horizontal scroll at 390 (`document.documentElement.scrollWidth <= 390` via `browser_evaluate`); banners match the codes; French has no English left. Click "Sign in with Google" and check with `browser_network_requests` that a request carries `kc_idp_hint=google-csquared`. Where it lands does not matter locally: `KEYCLOAK_ISSUER` in `.env` may point at a Keycloak on :8080 that the DMP's containers own. Fix anything off and commit it with Task 3's files.

- [ ] **Step 3: Full gate**

Run: `pnpm test && pnpm tsc --noEmit && pnpm lint`
Expected: all green (the Testcontainers isolation suite needs Docker running).

Then run the `deslop` skill over `git diff dev...HEAD` and apply what it finds that is in scope.

- [ ] **Step 4: Push and open the PR into `dev`**

```bash
git push -u origin feat/cms-google-only-sign-in
gh pr create --base dev --title "Google-only sign-in: one branded page, @csquared.com accounts only" --body-file <scratchpad>/prs/google-only.md
```

The PR body lists the four parts (page, app lock, onboarding, docs), the Keycloak step as a post-deploy operator action, and ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
