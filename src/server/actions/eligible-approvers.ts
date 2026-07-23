"use server"

import { getPrisma } from "@/server/db"
import { getAppSession } from "@/lib/session"
import { isGroupAdmin, isMemberOfOpCo } from "@/lib/permissions"
import { listEligibleApproversForScope } from "@/server/approval-authority"

/**
 * Approver candidates for a scope the caller is allowed to raise changes in.
 * Mirrors createChange's authz gate so the picker cannot enumerate other OpCos.
 */
export async function listEligibleApproversAction(opcoSlug: string, infrastructureType: string) {
  const session = await getAppSession()
  if (!isGroupAdmin(session.realmRoles) && !isMemberOfOpCo(session.organizations, opcoSlug)) {
    throw new Error("Forbidden: not a member of this OpCo")
  }
  const db = getPrisma()
  const me = await db.user.findUnique({
    where: { keycloakId: session.keycloakId },
    select: { id: true },
  })
  return listEligibleApproversForScope(opcoSlug, infrastructureType, me?.id)
}
