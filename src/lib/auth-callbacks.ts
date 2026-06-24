import authConfig from "@/auth.config"
import { coerceLocale } from "@/lib/i18n"
import { getPrisma } from "@/server/db"
import type { Session } from "next-auth"
import type { JWT } from "next-auth/jwt"

type Callbacks = NonNullable<typeof authConfig.callbacks>
type JwtParams = Parameters<NonNullable<Callbacks["jwt"]>>[0]
type SessionParams = Parameters<NonNullable<Callbacks["session"]>>[0]

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

    // Reconcile the DB user with this Keycloak identity. Pre-provisioned/seeded users
    // (and brand-new Keycloak users) won't have a row matching the real `sub` yet, so
    // role lookups and admin-action auditing (which resolve the DB user by keycloakId)
    // would fail.
    const existing = await db.user.findUnique({ where: { keycloakId: sub } })
    if (!existing) {
      const p = (profile ?? {}) as {
        email?: string
        email_verified?: boolean
        name?: string
        preferred_username?: string
        locale?: string
      }
      if (p.email) {
        const byEmail = await db.user.findUnique({ where: { email: p.email }, select: { id: true } })
        if (!byEmail) {
          // Brand-new identity (e.g. first brokered Google sign-in). A fresh row carries
          // zero OpCo assignments — no standing access — so creating it needs no verified
          // email. This is what makes self-registered users discoverable to admins.
          await db.user.create({
            data: { keycloakId: sub, email: p.email, name: p.name ?? p.preferred_username ?? null, locale: coerceLocale(p.locale) },
          })
        } else if (p.email_verified) {
          // Re-link a pre-provisioned/seeded row to this Keycloak identity. Gated on
          // email_verified so an UNVERIFIED email can never repoint an existing (possibly
          // privileged) row to a different sub — closing the account-takeover vector.
          await db.user.update({ where: { email: p.email }, data: { keycloakId: sub } })
        }
      }
    }

    const assignments = await db.userOpCoAssignment.findMany({
      where: { isActive: true, user: { keycloakId: sub } },
      include: { opco: true },
    })
    token.organizations = assignments.map((a) => ({
      id: a.opco.id,
      name: a.opco.name,
      alias: a.opco.slug,
      roles: [a.role],
    }))
  }
  return token
}

/** Copies enriched token claims onto the session user (same shape as before). */
export function sessionFromToken({ session, token }: SessionParams): Session {
  session.user.keycloakId = (token.keycloakId as string) ?? ""
  session.user.organizations = token.organizations ?? []
  session.user.realmRoles = (token.realmRoles as string[]) ?? []
  return session
}
