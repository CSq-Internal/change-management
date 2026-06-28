# V3 Auth-Flow Pass — Design

**Date:** 2026-06-27
**Status:** Approved design (pending written-spec review)

## Overview

Two independent authZ-lifecycle defects in the CSquared CMS, addressed as one pass
because they share the auth surface (`enrichedJwt` / Keycloak admin layer):

- **(A) Stale-JWT authZ propagation** — granting an access request or editing a user's
  OpCo roles does not reach the user's live session; they stay on their old authority
  until they sign out and back in. This undercuts the access-request feature.
- **(B) Keycloak⇄DB invite reconcile** — after a deliberate DB wipe, users still exist
  in Keycloak; re-inviting them produces accounts that can't sign in (no password reset
  on adopt; federated vs password users handled identically; first-broker-login
  collisions).

These are built and shipped together but are independent subsystems with independent
tests.

---

## Part A — Stale-JWT authZ propagation (TTL re-enrichment)

### Problem & root cause

The app uses NextAuth v5 **JWT session strategy** (no DB adapter), so the `jwt` callback
runs per request. `enrichedJwt` (`src/lib/auth-callbacks.ts`) sources OpCo
memberships/roles from the DB **only inside `if (account)`** — i.e. on initial sign-in.
On every later token refresh, `token.organizations` is carried over unchanged, and the
callback ignores `trigger: "update"`. Result: `approveAccessRequest` upserts a
`UserOpCoAssignment` (and admin role edits change the same table), but the target user's
live session keeps its stale `organizations` until re-login.

### Design

Re-enrich `token.organizations` from the DB on a short TTL.

1. **Timestamp the token.** Add `token.orgsRefreshedAt` (epoch ms), set every time
   `organizations` is loaded.
2. **Extract a loader.** Factor the existing "load active OpCo assignments by
   `keycloakId` → `organizations[]`" logic out of the `if (account)` block into a helper
   `loadOrganizations(db, keycloakId)` returning the `SessionOrganization[]` shape.
3. **Re-enrich when stale.** In `enrichedJwt`, after the existing sign-in branch:
   - On sign-in (`account` present): load organizations + set `orgsRefreshedAt = now`
     (unchanged behavior, now via the helper).
   - On any later call (no `account`): if `token.keycloakId` is present and
     `now - (token.orgsRefreshedAt ?? 0) > ORGS_TTL_MS`, reload organizations and set
     `orgsRefreshedAt = now`.
4. **TTL constant.** `const ORGS_TTL_MS = 60_000` (60s) — a named const in
   `auth-callbacks.ts`. Effect: grants/role edits reach the live session within ~60s, no
   re-login.

### Scope boundary

- Refreshes **DB-backed OpCo assignments** (`token.organizations`) only — which is
  exactly what both reported bugs are (`approveAccessRequest` and access-level edits both
  write `UserOpCoAssignment`).
- Does **not** refresh Keycloak-side **group roles** (`group_admin` / `group_auditor`).
  Those live in the Keycloak token and are mirrored to `User.isGroupAdmin` only at
  sign-in; re-reading the DB mirror on TTL would be a no-op (it only changes at sign-in).
  Changing a user's group role still requires re-login. Documented as a known limitation;
  not worth a per-request Keycloak Admin API read.

### Implementation notes / risks

- **Cookie persistence.** With JWT strategy, a token mutation returned from the `jwt`
  callback is re-signed into the cookie reliably in middleware / route handlers / server
  actions, but not always in a pure RSC read. Worst case: the `orgsRefreshedAt` stamp
  doesn't advance in the cookie for RSC-only flows, so those re-read every request — still
  correct, just a few extra reads on a low-traffic internal tool. Acceptable; covered by a
  test asserting (a) fresh-token path does NOT hit the DB, (b) stale-token path DOES and
  updates the stamp.
- The proxy/edge NextAuth instance uses `auth.config` (no DB) and is unaffected — it never
  re-enriches and never stamps; this is intentional.

### Testing

Unit tests in `src/test/auth-enrichment.test.ts`:
- Stale token (old `orgsRefreshedAt`, no `account`) → re-queries DB, updates
  `organizations` and `orgsRefreshedAt`.
- Fresh token (recent `orgsRefreshedAt`, no `account`) → does NOT query the DB.
- Sign-in (`account`) → loads organizations and sets `orgsRefreshedAt` (existing behavior
  preserved).

---

## Part B — Keycloak⇄DB invite reconcile

### Problem & root cause

`createOrFindKeycloakUser` already adopts an existing Keycloak user on HTTP 409
(`created: false`), and `onboardUser` already handles a wiped DB (`existing = null` →
adopt Keycloak user → recreate the DB row). So onboarding does not throw "already exists."
The real failures are at **login**:

1. **No password reset on adopt.** When adopting an existing Keycloak user, the emailed
   temp password is never applied, so password-based users can't sign in with it.
2. **Federated vs password users treated identically.** Live users are mixed: some sign in
   via brokered Google SSO (no password), some via Keycloak password (e.g. the devops
   account). A federated user should get a "sign in with Google" invite, not a temp
   password; a password user needs the password actually set.
3. **First-broker-login collision (operator-side).** A pre-created password account with a
   given email can collide with the incoming Google federated identity unless the realm's
   first-broker-login flow auto-links by verified email.

### Design

Make the adopt path in `onboardUser` a real reconcile.

1. **Detect federated identity.** New `getFederatedIdentities(kcUserId)` helper in
   `src/server/keycloak.ts` (`GET /users/{id}/federated-identity`). A non-empty result
   (e.g. a `google` / `google-csquared` link) ⇒ SSO user.
2. **Idempotently fix account state.** Ensure `enabled: true` and `emailVerified: true`
   on the adopted user (extend the existing enable path — `reactivateKeycloakUser` already
   sets `enabled: true`; add `emailVerified`).
3. **Branch on type:**
   - **Federated (Google):** do NOT set a password. Send the invite email in a
     **federated variant** ("sign in with Google", no credentials).
   - **Password user:** call new `resetKeycloakPassword(kcUserId, tempPassword)`
     (`PUT /users/{id}/reset-password`, `temporary: true`) so the emailed temp password
     works, then send the temp-password invite.
4. **Brand-new user (`created: true`):** unchanged — temp password as today.

The invite email (`sendUserInvitationEmail`) gains a `federated` flag to select copy. The
existing `existingIdentity` flag is retained; `federated` refines it.

### New `keycloak.ts` helpers

- `getFederatedIdentities(kcUserId): Promise<Array<{ identityProvider: string }>>`
- `resetKeycloakPassword(kcUserId, password, temporary = true): Promise<void>`
- Extend the enable path so adoption can set `emailVerified: true` (small addition to the
  existing user-update helper or a focused `ensureUserEnabledVerified(kcUserId)`).

### Operator dependency (documented, not codeable here)

The realm's **first-broker-login flow must auto-link by verified email** so a re-invited
user signing in with Google links to the pre-existing account instead of erroring
"account already exists." With the `google-csquared` IdP's *Trust Email = ON* this is the
standard configuration. Captured in a new
`docs/keycloak-first-broker-login-autolink.md`, mirroring the picture-mapper doc.

### Scope

- **Invite-time reconcile only.** No bulk "import every Keycloak user → DB" job — re-inviting
  individuals covers the deliberate-DB-wipe case (YAGNI).
- No change to the self-registration access-request flow; this complements it.

### Testing

Server-action tests in `src/test/actions/` (mock the `keycloak.ts` helpers):
- Adopt + **federated** identity → no `resetKeycloakPassword` call; invite sent with
  `federated: true`; account ensured enabled+verified.
- Adopt + **password** user → `resetKeycloakPassword` called with the temp password; invite
  sent without the federated flag.
- Brand-new user → `createOrFindKeycloakUser` with `created: true`, temp password path
  unchanged.
- `keycloak.ts` helper unit tests for `getFederatedIdentities` / `resetKeycloakPassword`
  request shape (fetch mocked).

---

## Out of scope (this pass)

- Refreshing Keycloak **group roles** into a live session without re-login (Part A scope
  note).
- Bulk Keycloak→DB reconciliation / import (Part B scope note).
- Cascade "DB wipe → delete Keycloak users" cleanup.
- Near-realtime push (SSE/websockets) — separate shelved item
  (`project_ux_realtime_and_profile_revisions`).

## File structure

| File | Change |
|------|--------|
| `src/lib/auth-callbacks.ts` | Part A: `loadOrganizations` helper, `ORGS_TTL_MS`, TTL re-enrich, `orgsRefreshedAt` |
| `src/types/next-auth.d.ts` | Part A: add `orgsRefreshedAt?: number` to the `JWT` interface |
| `src/server/keycloak.ts` | Part B: `getFederatedIdentities`, `resetKeycloakPassword`, enable+verify |
| `src/server/actions/users.ts` | Part B: reconcile branching in `onboardUser`'s adopt path |
| `src/server/email.ts` | Part B: `federated` variant in `sendUserInvitationEmail` |
| `docs/keycloak-first-broker-login-autolink.md` | Part B: operator setup doc |
| `src/test/auth-enrichment.test.ts` | Part A tests |
| `src/test/actions/*` | Part B tests |

## References

- Parked record: `project_v3_auth_flow_pass` memory.
- Related: `project_self_registration_access_requests`, `project_ux_realtime_and_profile_revisions`.
