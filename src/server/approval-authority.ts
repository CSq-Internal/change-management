import { getPrisma } from "@/server/db"
import { isGroupAdmin } from "@/lib/permissions"
import { routedCabOpcoId } from "@/lib/approver-routing"

type ChangeForAuth = { infrastructureType: string; opcoId: string }
type ApproverUser = { id: string; name: string | null; email: string }

/**
 * Users authorized to approve a change: active members of the routed CAB
 * (group CAB for Equiano, the change's OpCo CAB otherwise) plus anyone holding
 * an active delegation from one of those members. Deduplicated by id.
 */
export async function getRoutedApprovers(change: ChangeForAuth): Promise<ApproverUser[]> {
  const db = getPrisma()
  const cabOpcoId = routedCabOpcoId(change.infrastructureType, change.opcoId)

  const members = await db.cABMembership.findMany({
    where: { opcoId: cabOpcoId, isActive: true },
    include: { user: { select: { id: true, name: true, email: true } } },
  })
  const memberIds = members.map((m) => m.userId)

  const now = new Date()
  const delegations = memberIds.length === 0 ? [] : await db.approverDelegation.findMany({
    where: {
      opcoId: cabOpcoId, isActive: true,
      fromUserId: { in: memberIds },
      validFrom: { lte: now }, validUntil: { gte: now },
    },
    include: { toUser: { select: { id: true, name: true, email: true } } },
  })

  const seen = new Set<string>()
  const out: ApproverUser[] = []
  for (const u of [...members.map((m) => m.user), ...delegations.map((d) => d.toUser)]) {
    if (!seen.has(u.id)) { seen.add(u.id); out.push(u) }
  }
  return out
}

export async function canUserApproveChange(args: {
  userId: string
  realmRoles: string[]
  change: ChangeForAuth
}): Promise<boolean> {
  if (isGroupAdmin(args.realmRoles)) return true
  const approvers = await getRoutedApprovers(args.change)
  return approvers.some((u) => u.id === args.userId)
}

/** Pending changes the user is authorized to approve (group_admin sees all). */
export async function listApprovableChanges(args: { userId: string; realmRoles: string[] }) {
  const db = getPrisma()
  const pending = await db.changeRequest.findMany({
    where: { status: "pending" },
    include: { requester: true, opco: true, approvals: true },
    orderBy: { createdAt: "asc" },
  })
  if (isGroupAdmin(args.realmRoles)) return pending

  const visible = []
  for (const c of pending) {
    if (await canUserApproveChange({ userId: args.userId, realmRoles: args.realmRoles, change: c })) {
      visible.push(c)
    }
  }
  return visible
}
