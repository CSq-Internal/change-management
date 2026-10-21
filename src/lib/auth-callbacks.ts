import authConfig from "@/auth.config"
import { coerceLocale } from "@/lib/i18n"
import { getPrisma } from "@/server/db"
import type { Session } from "next-auth"
import type { JWT } from "next-auth/jwt"

type Callbacks = NonNullable<typeof authConfig.callbacks>
type JwtParams = Parameters<NonNullable<Callbacks["jwt"]>>[0]
type SessionParams = Parameters<NonNullable<Callbacks["session"]>>[0]

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

/**
 * Strip a token's access and flag it so the client guard signs the user out. Used when
 * the identity maps to no DB user, or to a deactivated one: the DB, not Keycloak, decides
 * whether a CSquared person may use the CMS (the realm is shared with other apps).
 */
function orphan(token: JWT): JWT {
  token.orphaned = true
  token.organizations = []
  token.realmRoles = []
  token.orgsRefreshedAt = Date.now()
  return token
}

type GroupFlags = { isGroupAdmin: boolean; isGroupAuditor: boolean }

/** Group roles live on the User row and are granted in the CMS (setGroupRole), not Keycloak. */
function groupRoles(row: Partial<GroupFlags> | null | undefined): string[] {
  if (row?.isGroupAdmin) return ["group_admin"]
  if (row?.isGroupAuditor) return ["group_auditor"]
  return []
}

/**
 * Node-only enriched jwt callback. Runs the edge-safe base extraction first,
 * then — only on sign-in (account present) — sources OpCo memberships+roles
 * from the DB and stores them on the token.
 */
export async function enrichedJwt(params: JwtParams): Promise<JWT> {
  const token = (await authConfig.callbacks!.jwt!(params)) ?? params.token
  const { account, profile } = params

  if (account) {
    const db = getPrisma()
    const sub = token.keycloakId as string
    token.orphaned = false // a fresh sign-in is authoritative; clear any stale flag

    // Reconcile the DB user with this Keycloak identity. Pre-provisioned/seeded users
    // (and brand-new Keycloak users) won't have a row matching the real `sub` yet, so
    // role lookups and admin-action auditing (which resolve the DB user by keycloakId)
    // would fail.
    const p = (profile ?? {}) as {
      email?: string
      email_verified?: boolean
      name?: string
      preferred_username?: string
      locale?: string
    }
    // Names are IdP-sourced (the profile page states so). Keep the DB row's name in
    // sync so it can't drift from Keycloak (e.g. a seeded "Dev Admin" row adopting a
    // Keycloak identity named "DevOps Admin").
    const profileName = p.name ?? p.preferred_username ?? null

    const existing = await db.user.findUnique({ where: { keycloakId: sub } })
    let isActive = existing?.isActive ?? true
    let flags: Partial<GroupFlags> | null = existing
    if (!existing) {
      if (p.email) {
        const byEmail = await db.user.findUnique({ where: { email: p.email }, select: { id: true, isActive: true, isGroupAdmin: true, isGroupAuditor: true } })
        if (!byEmail) {
          // Brand-new identity (e.g. first brokered Google sign-in). A fresh row carries
          // zero OpCo assignments — no standing access — so creating it needs no verified
          // email. This is what makes self-registered users discoverable to admins.
          await db.user.create({
            data: { keycloakId: sub, email: p.email, name: profileName, locale: coerceLocale(p.locale) },
          })
        } else if (p.email_verified) {
          // Re-link a pre-provisioned/seeded row to this Keycloak identity. Gated on
          // email_verified so an UNVERIFIED email can never repoint an existing (possibly
          // privileged) row to a different sub — closing the account-takeover vector.
          await db.user.update({ where: { email: p.email }, data: { keycloakId: sub } })
          isActive = byEmail.isActive
          flags = byEmail
        }
      }
    }

    if (!isActive) return orphan(token)

    token.organizations = await loadOrganizations(db, sub)
    token.orgsRefreshedAt = Date.now()

    token.realmRoles = groupRoles(flags)

    // Names are IdP-sourced; re-sync the row when the token carries one. updateMany is a
    // no-op when no row matches (e.g. an unverified email that wasn't created/relinked).
    if (profileName) {
      await db.user.updateMany({ where: { keycloakId: sub }, data: { name: profileName } })
    }
  } else if (
    token.keycloakId &&
    (params.trigger === "update" || Date.now() - (token.orgsRefreshedAt ?? 0) > ORGS_TTL_MS)
  ) {
    // No fresh sign-in, but the cached orgs are stale (or the client called update(),
    // as it does right after joining an OpCo): reload OpCo assignments so an
    // access grant / role edit reaches the live session without re-login. Group roles are
    // reloaded with them.
    const db = getPrisma()
    const sub = token.keycloakId as string

    // Broken-link hardening: if this token's identity no longer maps to a DB user (row
    // deleted, DB reset, keycloakId relinked elsewhere), flag it as orphaned so the
    // client guard signs the user out instead of serving a silent no-access session.
    // We flag rather than return null: returning null can't clear the session cookie
    // during an RSC render, so the edge proxy keeps seeing a valid session and its
    // /login → / redirect fights the page's / → /login redirect (infinite loop). Client
    // signOut goes through the route handler, which DOES clear the cookie. Checks row
    // EXISTENCE, not org count — an access-less user (self-registered) still has a row.
    // A deactivated row is treated the same, so deactivation ends a live session within
    // the TTL, group roles included.
    const stillLinked = await db.user.findUnique({ where: { keycloakId: sub }, select: { isActive: true, isGroupAdmin: true, isGroupAuditor: true } })
    if (!stillLinked?.isActive) return orphan(token)

    token.orphaned = false
    token.organizations = await loadOrganizations(db, sub)
    token.realmRoles = groupRoles(stillLinked)
    token.orgsRefreshedAt = Date.now()
  }
  return token
}

/** Copies enriched token claims onto the session user (same shape as before). */
export function sessionFromToken({ session, token }: SessionParams): Session {
  session.user.keycloakId = (token.keycloakId as string) ?? ""
  session.user.organizations = token.organizations ?? []
  session.user.realmRoles = (token.realmRoles as string[]) ?? []
  session.user.image = (token.picture as string | null | undefined) ?? null
  session.user.orphaned = token.orphaned === true
  return session
}
