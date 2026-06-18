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
    // would fail. Link-or-create by verified email and backfill the sub. Gated on
    // email_verified so we only trust Keycloak-asserted, verified addresses.
    const existing = await db.user.findUnique({ where: { keycloakId: sub } })
    if (!existing) {
      const p = (profile ?? {}) as {
        email?: string
        email_verified?: boolean
        name?: string
        preferred_username?: string
        locale?: string
      }
      if (p.email && p.email_verified) {
        await db.user.upsert({
          where: { email: p.email },
          update: { keycloakId: sub },
          create: { keycloakId: sub, email: p.email, name: p.name ?? p.preferred_username ?? null, locale: coerceLocale(p.locale) },
        })
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
