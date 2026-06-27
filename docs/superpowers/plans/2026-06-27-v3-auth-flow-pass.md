# V3 Auth-Flow Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make authZ changes reach a live session within ~60s without re-login (Part A), and make re-inviting a user who already exists in Keycloak produce a working login for both federated and password users (Part B).

**Architecture:** Part A adds TTL re-enrichment of `token.organizations` in the existing `enrichedJwt` JWT callback. Part B turns `onboardUser`'s existing "adopt existing Keycloak user" branch into a real reconcile (federated detection + enable/verify + password reset) backed by new `keycloak.ts` Admin-API helpers.

**Tech Stack:** Next.js 16, NextAuth v5 (JWT strategy), Prisma 7/Postgres, Keycloak Admin REST API, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-27-v3-auth-flow-pass-design.md`

---

## Part A — Stale-JWT authZ propagation (TTL re-enrichment)

### Task A1: TTL re-enrichment of organizations in `enrichedJwt`

**Files:**
- Modify: `src/types/next-auth.d.ts` (add `orgsRefreshedAt` to `JWT`)
- Modify: `src/lib/auth-callbacks.ts` (extract `loadOrganizations`, add `ORGS_TTL_MS`, TTL re-enrich)
- Test: `src/test/auth-enrichment.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/test/auth-enrichment.test.ts` (inside the `describe('auth enrichment', …)` block). These rely on the existing `mockUsers` / `findMany` / `account` harness.

```ts
  it('re-enriches organizations from the DB when the token is stale and there is no account', async () => {
    mockUsers({ bySub: { id: 'u1', keycloakId: 'kc-sub-1' } })
    findMany.mockResolvedValue([
      { role: 'approver', opco: { id: 'opco-ghana', name: 'CSquared Ghana', slug: 'ghana' } },
    ])

    const token = await enrichedJwt({
      // no account → token-refresh path
      token: { keycloakId: 'kc-sub-1', organizations: [], orgsRefreshedAt: 1 }, // stale (epoch 1ms)
      user: {},
      account: null,
    } as unknown as Parameters<typeof enrichedJwt>[0])

    expect(findMany).toHaveBeenCalledWith({
      where: { isActive: true, user: { keycloakId: 'kc-sub-1' } },
      include: { opco: true },
    })
    expect(token.organizations).toEqual([
      { id: 'opco-ghana', name: 'CSquared Ghana', alias: 'ghana', roles: ['approver'] },
    ])
    expect(typeof token.orgsRefreshedAt).toBe('number')
    expect(token.orgsRefreshedAt).toBeGreaterThan(1)
  })

  it('does NOT hit the DB on a fresh token refresh (within TTL)', async () => {
    const token = await enrichedJwt({
      token: { keycloakId: 'kc-sub-1', organizations: [], orgsRefreshedAt: Date.now() },
      user: {},
      account: null,
    } as unknown as Parameters<typeof enrichedJwt>[0])

    expect(findMany).not.toHaveBeenCalled()
    expect(token.keycloakId).toBe('kc-sub-1')
  })

  it('stamps orgsRefreshedAt on sign-in', async () => {
    mockUsers({ bySub: { id: 'u1', keycloakId: 'kc-sub-1' } })
    findMany.mockResolvedValue([])

    const token = await enrichedJwt({
      token: {},
      user: {},
      account,
      profile: { sub: 'kc-sub-1', email: 'devops@csquared.com', email_verified: true, resource_access: { 'csquared-cms': { roles: [] } } },
    })

    expect(typeof token.orgsRefreshedAt).toBe('number')
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/test/auth-enrichment.test.ts`
Expected: the three new tests FAIL (no TTL logic yet; `orgsRefreshedAt` undefined; stale path doesn't re-query).

- [ ] **Step 3: Add `orgsRefreshedAt` to the JWT type**

In `src/types/next-auth.d.ts`, extend the `JWT` interface:

```ts
declare module "next-auth/jwt" {
  interface JWT {
    keycloakId?: string
    organizations?: SessionOrganization[]
    realmRoles?: string[]
    accessToken?: string
    orgsRefreshedAt?: number // epoch ms of the last DB org load (Part A TTL re-enrichment)
  }
}
```

- [ ] **Step 4: Refactor `enrichedJwt` — extract loader, add TTL re-enrichment**

In `src/lib/auth-callbacks.ts`:

Add near the top (after imports):

```ts
// How long an enriched token's `organizations` is trusted before a refresh. Keeps
// access grants / role edits propagating to a live session without re-login, while
// bounding DB reads to ~1 per window per active user.
const ORGS_TTL_MS = 60_000

type Db = ReturnType<typeof getPrisma>

/** Load the user's active OpCo assignments as session organizations. */
async function loadOrganizations(db: Db, keycloakId: string) {
  const assignments = await db.userOpCoAssignment.findMany({
    where: { isActive: true, user: { keycloakId } },
    include: { opco: true },
  })
  return assignments.map((a) => ({
    id: a.opco.id,
    name: a.opco.name,
    alias: a.opco.slug,
    roles: [a.role],
  }))
}
```

Replace the assignments block inside `if (account)` (the `const assignments = …` through the `token.organizations = …` assignment) with:

```ts
    token.organizations = await loadOrganizations(db, sub)
    token.orgsRefreshedAt = Date.now()
```

Then, after the closing brace of the `if (account)` block and before `return token`, add the refresh path:

```ts
  } else if (
    token.keycloakId &&
    Date.now() - (token.orgsRefreshedAt ?? 0) > ORGS_TTL_MS
  ) {
    // No fresh sign-in, but the cached orgs are stale: reload OpCo assignments so an
    // access grant / role edit reaches the live session without re-login. Group roles
    // (realmRoles) are Keycloak-sourced and intentionally not refreshed here.
    const db = getPrisma()
    token.organizations = await loadOrganizations(db, token.keycloakId as string)
    token.orgsRefreshedAt = Date.now()
  }
```

> Note: the existing `if (account) {` becomes `if (account) { … } else if (…) { … }`. Keep the `return token` at the end.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run src/test/auth-enrichment.test.ts`
Expected: all tests PASS (the 13 existing + 3 new = 16).

- [ ] **Step 6: Typecheck**

Run: `rm -f tsconfig.tsbuildinfo && pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/types/next-auth.d.ts src/lib/auth-callbacks.ts src/test/auth-enrichment.test.ts
git commit -m "feat(auth): TTL re-enrich organizations so authZ changes propagate without re-login"
```

---

## Part B — Keycloak⇄DB invite reconcile

### Task B1: Keycloak Admin helpers — federated identities, password reset, email-verified

**Files:**
- Modify: `src/server/keycloak.ts`
- Test: `src/test/server/keycloak-reconcile.test.ts` (create)

- [ ] **Step 1: Write the failing tests**

Create `src/test/server/keycloak-reconcile.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const fetchMock = vi.fn()

describe('keycloak reconcile helpers', () => {
  beforeEach(() => {
    process.env.KEYCLOAK_ISSUER = 'https://id.example.com/realms/csquared'
    process.env.KEYCLOAK_ADMIN_CLIENT_SECRET = 'secret'
    vi.stubGlobal('fetch', fetchMock)
    // First call in each helper is getAdminToken → return a token.
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/protocol/openid-connect/token')) {
        return new Response(JSON.stringify({ access_token: 'admin-tok' }), { status: 200 })
      }
      return new Response('[]', { status: 200 })
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('getFederatedIdentities GETs the federated-identity endpoint and returns the list', async () => {
    const { getFederatedIdentities } = await import('@/server/keycloak')
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/protocol/openid-connect/token')) {
        return new Response(JSON.stringify({ access_token: 'admin-tok' }), { status: 200 })
      }
      return new Response(JSON.stringify([{ identityProvider: 'google-csquared', userId: 'g1' }]), { status: 200 })
    })

    const res = await getFederatedIdentities('kc-1')
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('/federated-identity'))
    expect(call?.[0]).toContain('/admin/realms/csquared/users/kc-1/federated-identity')
    expect(res).toEqual([{ identityProvider: 'google-csquared' }])
  })

  it('resetKeycloakPassword PUTs a temporary credential', async () => {
    const { resetKeycloakPassword } = await import('@/server/keycloak')
    await resetKeycloakPassword('kc-1', 'Temp123!')
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('/reset-password'))
    expect(call?.[0]).toContain('/admin/realms/csquared/users/kc-1/reset-password')
    expect(call?.[1]?.method).toBe('PUT')
    expect(JSON.parse(call?.[1]?.body as string)).toEqual({ type: 'password', value: 'Temp123!', temporary: true })
  })

  it('ensureKeycloakUserEnabledVerified PUTs enabled + emailVerified', async () => {
    const { ensureKeycloakUserEnabledVerified } = await import('@/server/keycloak')
    await ensureKeycloakUserEnabledVerified('kc-1')
    const call = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/users/kc-1'))
    expect(call?.[1]?.method).toBe('PUT')
    expect(JSON.parse(call?.[1]?.body as string)).toEqual({ enabled: true, emailVerified: true })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/test/server/keycloak-reconcile.test.ts`
Expected: FAIL — the three helpers don't exist yet.

- [ ] **Step 3: Add the helpers to `src/server/keycloak.ts`**

Append (they reuse the file-local `getAdminToken` / `kcEndpoints`):

```ts
/** Federated identity links (e.g. a brokered Google login) for a Keycloak user. */
export async function getFederatedIdentities(
  keycloakUserId: string
): Promise<Array<{ identityProvider: string }>> {
  const token = await getAdminToken()
  const { adminRealmUrl } = kcEndpoints()
  const res = await fetch(`${adminRealmUrl}/users/${keycloakUserId}/federated-identity`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 404) return []
  if (!res.ok) {
    throw new Error(`Failed to read federated identities: ${res.status} ${await res.text()}`)
  }
  const links = await res.json()
  if (!Array.isArray(links)) return []
  return links.map((l: { identityProvider?: string }) => ({ identityProvider: l.identityProvider ?? "" }))
}

/** Reset a Keycloak user's password (temporary by default) so an emailed invite works. */
export async function resetKeycloakPassword(
  keycloakUserId: string,
  password: string,
  temporary = true
): Promise<void> {
  const token = await getAdminToken()
  const { adminRealmUrl } = kcEndpoints()
  const res = await fetch(`${adminRealmUrl}/users/${keycloakUserId}/reset-password`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ type: "password", value: password, temporary }),
  })
  if (!res.ok) {
    throw new Error(`Failed to reset Keycloak password: ${res.status} ${await res.text()}`)
  }
}

/** Ensure an adopted user can actually authenticate: enabled + email verified. */
export async function ensureKeycloakUserEnabledVerified(keycloakUserId: string): Promise<void> {
  const token = await getAdminToken()
  const { adminRealmUrl } = kcEndpoints()
  const res = await fetch(`${adminRealmUrl}/users/${keycloakUserId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ enabled: true, emailVerified: true }),
  })
  if (res.status === 404) {
    console.warn(`Keycloak user ${keycloakUserId} not found (404) — treating as no-op.`)
    return
  }
  if (!res.ok) {
    throw new Error(`Failed to ensure user enabled/verified: ${res.status} ${await res.text()}`)
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/test/server/keycloak-reconcile.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/keycloak.ts src/test/server/keycloak-reconcile.test.ts
git commit -m "feat(keycloak): federated-identity, password-reset, enable+verify admin helpers"
```

### Task B2: Federated variant in `sendUserInvitationEmail`

**Files:**
- Modify: `src/server/email.ts`
- Test: `src/test/server/email-invite.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/test/server/email-invite.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const dispatch = vi.fn()
vi.mock('@/server/email-transport', () => ({})) // no-op if present; see note below

// Capture the dispatched HTML by spying on the module's transport. The simplest
// seam is to stub global fetch / the mailer; here we assert via a spy on dispatchEmail
// by re-importing after mocking. If dispatchEmail is module-private, assert on the
// exported behavior through a fetch/transport mock instead.

describe('sendUserInvitationEmail federated variant', () => {
  beforeEach(() => { dispatch.mockReset() })

  it('omits the temp password and uses Google copy when federated', async () => {
    const mod = await import('@/server/email')
    const spy = vi.spyOn(mod as unknown as { dispatchEmail: typeof dispatch }, 'dispatchEmail').mockImplementation(dispatch as never)
    await mod.sendUserInvitationEmail({
      to: 'pat@csquared.com', name: 'Pat', existingIdentity: true, federated: true,
      assignments: [{ opcoSlug: 'ghana', role: 'requester' }], locale: 'en',
    })
    const html = dispatch.mock.calls[0]?.[2] as string
    expect(html).toMatch(/Sign in with Google/i)
    expect(html).not.toMatch(/temporary password/i)
    spy.mockRestore()
  })
})
```

> **Implementer note:** `dispatchEmail` is currently module-private in `email.ts`. To make it testable, **export** `dispatchEmail` (it is already used internally) OR add a thin internal seam. Choose the minimal change: add `export` to the existing `function dispatchEmail(...)`. If a cleaner seam exists in the codebase (a transport mock used by other email tests), mirror that instead. Verify the chosen approach compiles and the test asserts the federated copy.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/test/server/email-invite.test.ts`
Expected: FAIL — `federated` not a valid option; Google copy absent.

- [ ] **Step 3: Add the `federated` branch**

In `src/server/email.ts`, extend the options and the password copy:

```ts
export async function sendUserInvitationEmail(opts: {
  to: string
  name: string
  tempPassword?: string
  existingIdentity: boolean
  federated?: boolean
  assignments: Array<{ opcoSlug: string; role: string }>
  locale?: Language
}) {
  const fr = opts.locale === "fr"
  const assignmentList = opts.assignments
    .map((a) => `<li>${escapeHtml(a.role)} ${fr ? "dans" : "in"} ${escapeHtml(a.opcoSlug)}</li>`)
    .join("")
  const passwordCopy = opts.federated
    ? (fr
        ? "<p>Connectez-vous avec Google (« Se connecter avec Google ») en utilisant votre adresse @csquared.com. Aucun mot de passe n'est requis.</p>"
        : "<p>Sign in with Google (\"Sign in with Google\") using your @csquared.com address. No password is required.</p>")
    : opts.existingIdentity
    ? (fr
        ? "<p>Utilisez votre mot de passe Keycloak existant. Si vous ne le connaissez pas, demandez à un administrateur de le réinitialiser dans Keycloak.</p>"
        : "<p>Use your existing Keycloak password. If you do not know it, ask an administrator to reset it in Keycloak.</p>")
    : (fr
        ? `<p>Votre mot de passe temporaire est : <strong>${escapeHtml(opts.tempPassword ?? "ChangeMe123!")}</strong></p><p>Il pourra vous être demandé de le changer à la première connexion.</p>`
        : `<p>Your temporary password is: <strong>${escapeHtml(opts.tempPassword ?? "ChangeMe123!")}</strong></p><p>You may be asked to change it on first sign-in.</p>`)

  // …unchanged dispatchEmail(...) call…
}
```

Keep the existing `dispatchEmail(...)` body unchanged.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/test/server/email-invite.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/email.ts src/test/server/email-invite.test.ts
git commit -m "feat(email): federated (Sign in with Google) variant for the user invitation email"
```

### Task B3: Reconcile branching in `onboardUser`'s adopt path

**Files:**
- Modify: `src/server/actions/users.ts`
- Test: `src/test/actions/users-reconcile.test.ts` (create)

- [ ] **Step 1: Write the failing tests**

Create `src/test/actions/users-reconcile.test.ts`. Mirror the mocking style of the existing `src/test/actions/*` suites (mock `@/server/keycloak`, `@/server/email`, `@/server/db`, and the session loader). Assert:

```ts
// Pseudocode-level expectations the implementer must realize against the real test harness:
// 1) Adopt + federated identity present:
//    - getFederatedIdentities → [{ identityProvider: 'google-csquared' }]
//    - resetKeycloakPassword NOT called
//    - ensureKeycloakUserEnabledVerified called with the kc id
//    - sendUserInvitationEmail called with federated: true
// 2) Adopt + NO federated identity (password user):
//    - getFederatedIdentities → []
//    - resetKeycloakPassword called with the temp password
//    - sendUserInvitationEmail called with federated: false/undefined
// 3) Brand-new user (createOrFindKeycloakUser returns created:true):
//    - getFederatedIdentities NOT called; resetKeycloakPassword NOT called
//    - temp-password invite (federated falsy)
```

Write these as real Vitest tests using the existing `users` action test patterns (find the closest existing suite, e.g. a `users-*.test.ts`, and copy its harness). Each test calls `onboardUser({...})` with one assignment and a stubbed admin session.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/test/actions/users-reconcile.test.ts`
Expected: FAIL — no reconcile branching yet.

- [ ] **Step 3: Implement reconcile in `onboardUser`**

In `src/server/actions/users.ts`, import the new helpers:

```ts
import {
  createOrFindKeycloakUser,
  assignToOrganization,
  getFederatedIdentities,
  resetKeycloakPassword,
  ensureKeycloakUserEnabledVerified,
} from "@/server/keycloak"
```

Replace the Keycloak-identity block (the `if (existing) { … } else { createOrFindKeycloakUser … }` section, lines ~46-54) with reconcile-aware logic. Track whether the adopted account is federated:

```ts
  let keycloakId: string
  let createdKeycloakIdentity = false
  let isFederated = false

  if (existing) {
    keycloakId = existing.keycloakId
  } else {
    const identity = await createOrFindKeycloakUser(input.email, input.name, input.tempPassword)
    keycloakId = identity.id
    createdKeycloakIdentity = identity.created
  }

  // Reconcile an ADOPTED Keycloak account (not freshly created) so a re-invite after a
  // DB wipe yields a working login: ensure it's enabled + verified, then either keep
  // the federated (Google) login or reset the password for password users.
  if (!createdKeycloakIdentity) {
    try {
      const links = await getFederatedIdentities(keycloakId)
      isFederated = links.length > 0
      await ensureKeycloakUserEnabledVerified(keycloakId)
      if (!isFederated) {
        await resetKeycloakPassword(keycloakId, input.tempPassword || "ChangeMe123!")
      }
    } catch (err) {
      console.warn(`[onboardUser] Keycloak reconcile skipped for ${input.email}:`, err)
    }
  }
```

Then update the invite email call to pass `federated`:

```ts
    await sendUserInvitationEmail({
      to: input.email,
      name: input.name,
      tempPassword: input.tempPassword || "ChangeMe123!",
      existingIdentity: !!existing || !createdKeycloakIdentity,
      federated: isFederated,
      assignments: input.assignments,
      locale: inviteLocale,
    })
```

Leave the DB transaction, audit, and assignment logic unchanged.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm vitest run src/test/actions/users-reconcile.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Full check + commit**

```bash
rm -f tsconfig.tsbuildinfo && pnpm tsc --noEmit
pnpm vitest run --exclude '**/integration/**'
git add src/server/actions/users.ts src/test/actions/users-reconcile.test.ts
git commit -m "feat(users): reconcile adopted Keycloak accounts on invite (federated vs password)"
```

### Task B4: First-broker-login operator doc

**Files:**
- Create: `docs/keycloak-first-broker-login-autolink.md`

- [ ] **Step 1: Write the doc**

Create `docs/keycloak-first-broker-login-autolink.md` describing, for `id.csquarednet.com` realm `csquared`:

- Why: after a DB wipe, re-invited users still exist in Keycloak; when they sign in with Google, the realm must **auto-link by verified email** instead of erroring "account already exists."
- Steps: Authentication → Flows → **First broker login** → ensure the *Detect existing broker user* / *Automatically set existing user* path is active (or a copy with "Automatically link" enabled), and that `google-csquared` IdP has **Trust Email = ON** (already set per the self-registration work).
- Verify: wipe-and-reinvite a test `@csquared.com` user, sign in with Google, confirm it links to the existing account (no "account exists" prompt) and lands authenticated.

Mirror the tone/structure of `docs/keycloak-google-picture-mapper.md`.

- [ ] **Step 2: Commit**

```bash
git add docs/keycloak-first-broker-login-autolink.md
git commit -m "docs(keycloak): first-broker-login auto-link setup for re-invited SSO users"
```

---

## Final verification (after all tasks)

- [ ] `rm -f tsconfig.tsbuildinfo && pnpm tsc --noEmit` → clean
- [ ] `pnpm lint` → 0 errors
- [ ] `pnpm vitest run --exclude '**/integration/**'` → all pass (existing + new)
- [ ] Dispatch a final whole-branch review, then use superpowers:finishing-a-development-branch.
