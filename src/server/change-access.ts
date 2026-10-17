import { getPrisma } from "@/server/db"
import { isGroupLevel, isMemberOfOpCo } from "@/lib/permissions"
import { canUserApproveChange } from "@/server/approval-authority"
import type { SessionOrganization } from "@/types/next-auth"

/**
 * Who may read a change, its documents and its evidence: group-level roles, members of
 * its OpCo, and anyone routed to approve it (the group CAB, delegates) from outside.
 */
export async function canViewChange(
  viewer: { keycloakId: string; organizations: SessionOrganization[]; realmRoles: string[] },
  change: { opcoId: string; infrastructureType: string; opco: { slug: string } },
): Promise<boolean> {
  if (isGroupLevel(viewer.realmRoles) || isMemberOfOpCo(viewer.organizations, change.opco.slug)) return true
  const user = await getPrisma().user.findUnique({ where: { keycloakId: viewer.keycloakId }, select: { id: true } })
  if (!user) return false
  return canUserApproveChange({
    userId: user.id, realmRoles: viewer.realmRoles,
    change: { infrastructureType: change.infrastructureType, opcoId: change.opcoId },
  })
}
