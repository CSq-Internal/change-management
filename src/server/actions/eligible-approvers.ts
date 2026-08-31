"use server"

import { getPrisma } from "@/server/db"
import { getAppSession } from "@/lib/session"
import { isGroupAdmin, isMemberOfOpCo } from "@/lib/permissions"
import { listEligibleApproversForScope } from "@/server/approval-authority"

/**
 * Approver candidates for a scope the caller is allowed to raise changes in.
 * Mirrors createChange's authz gate so the picker cannot enumerate other OpCos.
 *
 * `changeId` is supplied when editing an existing change. The server rejects naming the
 * change's *requester* as an approver, which is not always the caller — an admin editing
 * someone else's draft must not be offered that requester.
 */
export async function listEligibleApproversAction(
  opcoSlug: string,
  infrastructureType: string,
  changeId?: string,
) {
  const session = await getAppSession()
  if (!isGroupAdmin(session.realmRoles) && !isMemberOfOpCo(session.organizations, opcoSlug)) {
    throw new Error("Forbidden: not a member of this OpCo")
  }
  const db = getPrisma()
  const me = await db.user.findUnique({
    where: { keycloakId: session.keycloakId },
    select: { id: true },
  })
  const change = changeId
    ? await db.changeRequest.findUnique({ where: { id: changeId }, select: { requesterId: true } })
    : null
  return listEligibleApproversForScope(opcoSlug, infrastructureType, change?.requesterId ?? me?.id)
}
