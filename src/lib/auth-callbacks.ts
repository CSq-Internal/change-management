import authConfig from "@/auth.config"
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
  const { account } = params

  if (account) {
    const db = getPrisma()
    const assignments = await db.userOpCoAssignment.findMany({
      where: { isActive: true, user: { keycloakId: token.keycloakId } },
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
