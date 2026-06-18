import type { Prisma } from "@prisma/client"
import { viewerTier, requestScopedSlugs } from "@/lib/permissions"
import type { SessionOrganization } from "@/types/next-auth"

/**
 * Prisma `where` selecting the change requests a user may browse:
 *   group  → {} (all)
 *   opco   → { opco: { slug: { in: <admin/approver slugs> } } }
 *   member → { requester: { keycloakId } } (own only)
 */
export function requestScope(user: {
  keycloakId: string
  organizations: SessionOrganization[]
  realmRoles: string[]
}): Prisma.ChangeRequestWhereInput {
  const tier = viewerTier(user.organizations, user.realmRoles)
  if (tier === "group") return {}
  if (tier === "opco") return { opco: { slug: { in: requestScopedSlugs(user.organizations) } } }
  return { requester: { keycloakId: user.keycloakId } }
}
