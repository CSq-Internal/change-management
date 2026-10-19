import type { Prisma } from "@prisma/client"
import { manageableOpCoSlugs } from "@/lib/permissions"
import type { SessionOrganization } from "@/types/next-auth"

/** The role requests a viewer can decide: the queue page lists these, the nav badge counts them. */
export function decidableAccessRequests(viewer: {
  organizations: SessionOrganization[]
  realmRoles: string[]
}): Prisma.AccessRequestWhereInput {
  const scope = manageableOpCoSlugs(viewer.organizations, viewer.realmRoles)
  return {
    status: "pending",
    user: { isActive: true },
    // Only group admins can grant admin (canAssignRole), so OpCo admins never see those.
    ...(scope === "all" ? {} : { opco: { slug: { in: scope } }, role: { not: "admin" as const } }),
  }
}
