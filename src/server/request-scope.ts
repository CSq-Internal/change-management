import type { Prisma } from "@prisma/client"
import { viewerTier, requestScopedSlugs } from "@/lib/permissions"
import type { SessionOrganization } from "@/types/next-auth"

/**
 * Prisma `where` selecting the change requests a user may browse:
 *   group  → {} (all)
 *   opco   → changes in their admin/approver OpCos, plus their own anywhere (an OpCo
 *            where they are only a requester still has their drafts)
 *   member → { requester: { keycloakId } } (own only)
 */
export function requestScope(user: {
  keycloakId: string
  organizations: SessionOrganization[]
  realmRoles: string[]
}): Prisma.ChangeRequestWhereInput {
  const tier = viewerTier(user.organizations, user.realmRoles)
  if (tier === "group") return {}
  const own = { requester: { keycloakId: user.keycloakId } }
  if (tier === "opco") return { OR: [{ opco: { slug: { in: requestScopedSlugs(user.organizations) } } }, own] }
  return own
}
