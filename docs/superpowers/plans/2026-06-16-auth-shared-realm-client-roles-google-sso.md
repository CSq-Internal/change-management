# Auth Modernization: Shared Realm + Client Roles + Google SSO — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scope CMS group roles to the `csquared-cms` Keycloak client (not the shared realm), wire the v2 brokered+domain-restricted "Sign in with Google", and document the realm/Google operator setup.

**Architecture:** Two small code changes in the edge-safe auth layer + login page, plus an operator runbook doc. Group roles move from `realm_access.roles` → `resource_access["csquared-cms"].roles` (a one-line source change in `auth.config.ts`, session field name kept as `realmRoles`). Google sign-in is brokered through Keycloak via a `kc_idp_hint=google` authorization param on the existing Google button. All Keycloak/Google-console work is operator-performed and captured in a runbook.

**Tech Stack:** Next.js 16 App Router, NextAuth v5 (5.0.0-beta.31) Keycloak OIDC provider, Vitest + React Testing Library, Keycloak 26.

**Verified facts (already checked against current docs):**
- NextAuth v5 `signIn(provider, options, authorizationParams)` — the 3rd arg is appended to the authorize URL, so `{ kc_idp_hint: "google" }` reaches Keycloak.
- Keycloak 26: roles are in the **access token** by default, **not** the ID token. Client roles live in `resource_access.<clientId>.roles`. NextAuth's Keycloak `profile` is sourced from the ID token/userinfo, so the operator must enable "Add to ID token" + "Add to userinfo" on a **dedicated** `csquared-cms` client-roles mapper (Task 3).

---

## Branch setup (do once, before Task 1)

This work must not land directly on the `dev` integration branch. Create a feature branch off `dev`:

```bash
cd /Users/ckoranteng/change-management
git checkout dev
git checkout -b feat/auth-shared-realm-client-roles-google-sso
```

Expected: `Switched to a new branch 'feat/auth-shared-realm-client-roles-google-sso'`.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `src/auth.config.ts` | Edge-safe provider + token extraction | Derive `realmRoles` from `resource_access[KEYCLOAK_CLIENT_ID]` |
| `src/types/next-auth.d.ts` | Session/JWT type augmentation | Update the `realmRoles` comment (now CMS client roles) |
| `src/test/auth-enrichment.test.ts` | Enrichment + token-extraction tests | Update fixture to `resource_access`; add a discriminating test |
| `src/app/login/page.tsx` | Login UI + sign-in handlers | Google button passes `kc_idp_hint=google` |
| `src/app/login/page.test.tsx` (new) | Login page behavior | Assert per-button `signIn` args |
| `docs/keycloak-realm-and-google-sso-setup.md` (new) | Operator runbook | Realm rebuild, client roles mapper, Google SSO |

---

## Task 1: Move group roles from realm roles to `csquared-cms` client roles

**Files:**
- Modify: `src/auth.config.ts:17-27`
- Modify: `src/types/next-auth.d.ts:21`
- Test: `src/test/auth-enrichment.test.ts:30-37` (existing fixture) + new test

- [ ] **Step 1: Make the env deterministic in the test, and update the existing fixture to client roles**

In `src/test/auth-enrichment.test.ts`, extend the existing `beforeEach` (around line 22) to pin the client id:

```ts
  beforeEach(() => {
    process.env.KEYCLOAK_CLIENT_ID = 'csquared-cms'
    userFindUnique.mockReset()
    userUpsert.mockReset()
    findMany.mockReset()
  })
```

Then change the first test's `profile` (line 35) from `realm_access` to `resource_access`:

```ts
      profile: { sub: 'kc-sub-1', email: 'devops@csquared.com', email_verified: true, resource_access: { 'csquared-cms': { roles: ['group_admin'] } } },
```

(The assertion `expect(token.realmRoles).toEqual(['group_admin'])` on the next lines stays unchanged.)

- [ ] **Step 2: Add a discriminating test proving realm roles are ignored**

Add this test inside the `describe('auth enrichment', …)` block in `src/test/auth-enrichment.test.ts`:

```ts
  it('reads group roles from the csquared-cms client roles and ignores realm roles', async () => {
    userFindUnique.mockResolvedValue({ id: 'u1', keycloakId: 'kc-sub-1' })
    findMany.mockResolvedValue([])

    const token = await enrichedJwt({
      token: {},
      user: {},
      account,
      profile: {
        sub: 'kc-sub-1',
        email: 'devops@csquared.com',
        email_verified: true,
        // realm_access MUST be ignored; only the client's resource_access counts
        realm_access: { roles: ['group_admin'] },
        resource_access: { 'csquared-cms': { roles: ['group_auditor'] } },
      },
    })

    expect(token.realmRoles).toEqual(['group_auditor'])
  })
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm test src/test/auth-enrichment.test.ts`
Expected: FAIL — the existing test now gets `realmRoles: []` (no `realm_access` in fixture; code still reads `realm_access`), and the new test gets `['group_admin']` instead of `['group_auditor']`.

- [ ] **Step 4: Change the role source in `src/auth.config.ts`**

Replace the `jwt` callback body (lines 18-26) with:

```ts
    jwt({ token, account, profile }) {
      if (account) token.accessToken = account.access_token
      if (profile) {
        const p = profile as Record<string, unknown>
        token.keycloakId = p.sub as string
        // Group-level roles are CMS *client* roles, scoped to this app within the
        // shared realm — read from resource_access[<client>].roles, not realm roles.
        const clientId = process.env.KEYCLOAK_CLIENT_ID ?? "csquared-cms"
        const resourceAccess = p.resource_access as
          | Record<string, { roles?: string[] }>
          | undefined
        token.realmRoles = resourceAccess?.[clientId]?.roles ?? []
      }
      return token
    },
```

- [ ] **Step 5: Update the type comment in `src/types/next-auth.d.ts`**

Change line 21 from:

```ts
      realmRoles: string[]  // "group_admin" | "group_auditor"
```

to:

```ts
      realmRoles: string[]  // CMS client roles on csquared-cms: "group_admin" | "group_auditor"
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm test src/test/auth-enrichment.test.ts`
Expected: PASS (all enrichment tests green).

- [ ] **Step 7: Type-check**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/auth.config.ts src/types/next-auth.d.ts src/test/auth-enrichment.test.ts
git commit -m "feat(auth): source group roles from csquared-cms client roles"
```

---

## Task 2: Wire Google sign-in via `kc_idp_hint`

**Files:**
- Modify: `src/app/login/page.tsx:16-18`
- Test: `src/app/login/page.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

Create `src/app/login/page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@testing-library/react"

const { signIn } = vi.hoisted(() => ({ signIn: vi.fn() }))
vi.mock("next-auth/react", () => ({ signIn }))
vi.mock("@/lib/store", () => ({ useStore: () => ({ language: "en" }) }))

import LoginPage from "@/app/login/page"

beforeEach(() => signIn.mockClear())
afterEach(() => cleanup())

describe("LoginPage", () => {
  it("work-credentials button signs in via keycloak with no idp hint", () => {
    render(<LoginPage />)
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }))
    expect(signIn).toHaveBeenCalledWith("keycloak", { callbackUrl: "/" })
  })

  it("Google button signs in via keycloak with kc_idp_hint=google", () => {
    render(<LoginPage />)
    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }))
    expect(signIn).toHaveBeenCalledWith(
      "keycloak",
      { callbackUrl: "/" },
      { kc_idp_hint: "google" }
    )
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/app/login/page.test.tsx`
Expected: FAIL — the Google test fails because `handleGoogleLogin` currently calls `signIn("keycloak", { callbackUrl: "/" })` with no third argument.

- [ ] **Step 3: Add the idp hint in `src/app/login/page.tsx`**

Replace `handleGoogleLogin` (lines 16-18) with:

```tsx
  async function handleGoogleLogin() {
    // Brokered Google sign-in: kc_idp_hint tells Keycloak to skip its own login
    // screen and redirect straight to the Google identity provider.
    await signIn("keycloak", { callbackUrl: "/" }, { kc_idp_hint: "google" })
  }
```

Leave `handleLogin` (work credentials) unchanged.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/app/login/page.test.tsx`
Expected: PASS (both tests green).

- [ ] **Step 5: Commit**

```bash
git add src/app/login/page.tsx src/app/login/page.test.tsx
git commit -m "feat(auth): brokered Google sign-in via kc_idp_hint"
```

---

## Task 3: Operator runbook — shared realm, client roles mapper, Google SSO

**Files:**
- Create: `docs/keycloak-realm-and-google-sso-setup.md`

No tests (documentation). Content must be complete and actionable.

- [ ] **Step 1: Create the runbook doc**

Create `docs/keycloak-realm-and-google-sso-setup.md` with exactly this content:

````markdown
# Keycloak realm + Google SSO setup (csquared-cms)

The CMS authenticates against the **shared internal realm `csquared`** on
`https://id.csquarednet.com`. CMS is one client (`csquared-cms`) in that realm — do not
create a CMS-specific realm. User identities are `@csquared.com` (Google Workspace);
hosting/IdP live on `csquarednet.com`.

## 1. App login client — `csquared-cms`
- Client authentication: **On** (confidential). Standard flow: **On** (auth code + PKCE).
- Valid redirect URIs:
  - `https://csq-cms.vercel.app/api/auth/callback/keycloak`
  - `http://localhost:3000/api/auth/callback/keycloak`
- Valid post-logout redirect URIs: `https://csq-cms.vercel.app/*` (+ localhost).
- Web origins: `+`.
- Credentials tab → copy secret → Vercel `KEYCLOAK_CLIENT_SECRET`.

## 2. Admin (provisioning) client — `csquared-cms-admin`
- Client authentication: **On**. Standard flow: **Off**. Service accounts roles: **On**.
- Service-account roles → assign `realm-management → manage-users` (required);
  `view-users`, `query-users` (recommended). `manage-organizations` optional (best-effort).
- Credentials tab → secret → Vercel `KEYCLOAK_ADMIN_CLIENT_SECRET`.

## 3. CMS client roles (scoped to this app)
- On the `csquared-cms` client → **Roles** → create `group_admin` and `group_auditor`.
- These are *client* roles, so they don't collide with other apps in the shared realm.
- Per-OpCo roles (requester/approver/auditor/admin) are stored in the app DB — NOT here.

## 4. Put client roles into the ID token (required)
By default Keycloak adds roles to the **access token only**. NextAuth reads the **ID token**,
so add a dedicated mapper on this client:
- `csquared-cms` client → **Client scopes** → `csquared-cms-dedicated` → **Add mapper** →
  **By configuration** → **User Client Role**.
  - Client ID: `csquared-cms`
  - Token Claim Name: `resource_access.${client_id}.roles`
  - Claim JSON Type: `String`, **Multivalued: On**
  - **Add to ID token: On**, **Add to userinfo: On**, Add to access token: On
- Result: the token carries `resource_access["csquared-cms"].roles = ["group_admin", …]`,
  which `auth.config.ts` reads into `session.user.realmRoles`.

## 5. Bootstrap admin user
- Create user `devops@csquared.com`, **Email verified: On**, set a password.
- Assign the `csquared-cms` client role `group_admin`. This alone yields group tier on
  first login (the app links the DB user by verified email; no DB seeding needed).

## 6. Google SSO — brokered, restricted to csquared.com

### Google Cloud (project owned by the csquared.com Workspace org)
- OAuth consent screen: **Internal** (primary domain boundary — only `csquared.com` consent).
- Create a **new** OAuth 2.0 client, type **Web application** (do not reuse a shared client).
- Authorized redirect URI:
  `https://id.csquarednet.com/realms/csquared/broker/google/endpoint`
- No extra Google APIs needed (basic OpenID/email/profile).

### Keycloak (realm-level Identity Provider — all internal apps inherit it)
- Realm `csquared` → **Identity Providers** → **Google**.
- Paste the Google client ID + secret.
- Set **Hosted Domain** = `csquared.com` (the `hd` hint).
- First-broker-login: add/keep a flow that **rejects** any brokered email not ending in
  `@csquared.com` (defense in depth behind Internal consent + `hd`).

## 7. Vercel env (re-verify) + redeploy
- `KEYCLOAK_ISSUER=https://id.csquarednet.com/realms/csquared`
- `KEYCLOAK_CLIENT_ID=csquared-cms`, `KEYCLOAK_CLIENT_SECRET=…`
- `KEYCLOAK_ADMIN_CLIENT_ID=csquared-cms-admin`, `KEYCLOAK_ADMIN_CLIENT_SECRET=…`
- `NEXTAUTH_SECRET=…`, `NEXTAUTH_URL=https://csq-cms.vercel.app`, `AUTH_TRUST_HOST=true`
- `EMAIL_FROM=<sender>@csquarednet.com` (Resend-verified domain)
- Env changes require a redeploy.

## 8. Production DB
Ensure prod Postgres is migrated (`prisma migrate deploy`) and has the OpCos. The bootstrap
admin works without DB seeding (email link + `group_admin` client role → group tier).
````

- [ ] **Step 2: Commit**

```bash
git add docs/keycloak-realm-and-google-sso-setup.md
git commit -m "docs: Keycloak shared-realm + client-roles + Google SSO runbook"
```

---

## Final verification (after all tasks)

- [ ] Run the full suite: `pnpm test` — expected: all green (was 375; +1 enrichment test, +2 login tests).
- [ ] `pnpm tsc --noEmit` — clean.
- [ ] `pnpm lint` — clean.
- [ ] Use superpowers:finishing-a-development-branch to integrate (merge `feat/...` → `dev`).
- [ ] Live verification on `https://csq-cms.vercel.app` is gated on the operator completing
      Task 3's Keycloak/Google config + redeploy; run the full authenticated Playwright sweep then.

---

## Self-Review

**Spec coverage:**
- Workstream 1 (shared realm rebuild) → Task 3 runbook (§1, §2, §5, §7, §8). ✅
- Workstream 2 (realm roles → client roles) → Task 1 (code) + Task 3 §3–§4 (Keycloak). ✅
- Workstream 3 (Google SSO brokered + domain-restricted) → Task 2 (code) + Task 3 §6. ✅
- Decision: keep `realmRoles` field name → Task 1 Step 4/5 (source change only, comment updated). ✅
- Decision: domain enforcement in Keycloak only → Task 3 §6; no app-side domain gate added. ✅
- Risk: client-roles-in-ID-token → Task 3 §4 (dedicated mapper, Add to ID token + userinfo). ✅
- Risk: `signIn` authorizationParams → verified; Task 2 uses the 3-arg form. ✅

**Placeholder scan:** `<sender>` and `…` in the runbook are operator-filled secret placeholders (intentional, values never in repo), not plan gaps. No TBD/TODO in code steps. ✅

**Type consistency:** Session field stays `realmRoles: string[]` throughout; `resource_access` shape `Record<string, { roles?: string[] }>` matches the fixture `{ 'csquared-cms': { roles: [...] } }`; `KEYCLOAK_CLIENT_ID` env keys the lookup and the fixture/`beforeEach` pin it to `csquared-cms`. ✅
