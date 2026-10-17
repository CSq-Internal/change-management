import { getPrisma } from "@/server/db"
import { isGroupAdmin } from "@/lib/permissions"
import { routedCabOpcoId, isGroupLevelInfra } from "@/lib/approver-routing"
import { hasVotedSince } from "@/lib/approval-cycle"

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

  const overrides = await db.approverAssignment.findMany({
    where: { infrastructureType: change.infrastructureType, opcoId: cabOpcoId, isActive: true },
    include: { user: { select: { id: true, name: true, email: true, isActive: true } } },
  })

  let routedUsers: ApproverUser[]
  if (overrides.length > 0) {
    routedUsers = overrides
      .filter((o) => o.user.isActive)
      .map((o) => ({ id: o.user.id, name: o.user.name, email: o.user.email }))
  } else {
    const members = await db.cABMembership.findMany({
      where: { opcoId: cabOpcoId, isActive: true },
      include: { user: { select: { id: true, name: true, email: true } } },
    })
    routedUsers = members.map((m) => m.user)
  }

  const routedIds = routedUsers.map((u) => u.id)
  const now = new Date()
  const delegations = routedIds.length === 0 ? [] : await db.approverDelegation.findMany({
    where: {
      opcoId: cabOpcoId, isActive: true,
      fromUserId: { in: routedIds },
      validFrom: { lte: now }, validUntil: { gte: now },
    },
    include: { toUser: { select: { id: true, name: true, email: true } } },
  })

  const seen = new Set<string>()
  const out: ApproverUser[] = []
  for (const u of [...routedUsers, ...delegations.map((d) => d.toUser)]) {
    if (!seen.has(u.id)) { seen.add(u.id); out.push(u) }
  }
  return out
}

/** Users explicitly named as approvers on a specific change (via ChangeAssignee.role). */
export async function getNamedApprovers(changeId: string): Promise<ApproverUser[]> {
  const db = getPrisma()
  const rows = await db.changeAssignee.findMany({
    where: { changeId, role: "approver" },
    include: { user: { select: { id: true, name: true, email: true, isActive: true } } },
  })
  return rows.filter((r) => r.user.isActive).map((r) => ({ id: r.user.id, name: r.user.name, email: r.user.email }))
}

/**
 * The approval rule for a non-group-admin, given the change's routed approvers and a check
 * for whether the user is named on it. Shared by the single-change check and the queue.
 */
async function approvesWith(
  userId: string, change: ChangeForAuth, routed: ApproverUser[], isNamed: () => Promise<boolean>,
): Promise<boolean> {
  if (routed.some((u) => u.id === userId)) return true
  // A nomination is not a standing grant. Re-check eligibility rather than trusting the
  // stored row: the nominee may since have left the CAB or lost their approver role, or
  // the change's infrastructure type may have moved to Equiano (group-level), which
  // would otherwise leave an OpCo approver authoritative over group infrastructure.
  return (await isNamed()) && isEligibleApprover(userId, change.opcoId, change.infrastructureType)
}

export async function canUserApproveChange(args: {
  userId: string
  realmRoles: string[]
  change: ChangeForAuth
  changeId?: string
}): Promise<boolean> {
  if (isGroupAdmin(args.realmRoles)) return true
  const { changeId } = args
  return approvesWith(args.userId, args.change, await getRoutedApprovers(args.change), async () =>
    !!changeId && (await getNamedApprovers(changeId)).some((u) => u.id === args.userId),
  )
}

/** Pending changes the user is authorized to approve (group_admin sees all). */
export async function listApprovableChanges(args: { userId: string; realmRoles: string[] }) {
  const db = getPrisma()
  // Exclude the user's own requests — an approver can never act on a change they
  // requested (SoD, ISO 27001 A.5.3) — and changes they have voted on in this round,
  // which now await *other* approvers. A vote from before the latest submission was on
  // an earlier version of the plan, so that change is back in their queue.
  const all = await db.changeRequest.findMany({
    where: { status: "pending", requesterId: { not: args.userId } },
    include: {
      requester: true, opco: true, approvals: true,
      auditTrail: { where: { action: "submitted" }, orderBy: { at: "desc" }, take: 1, select: { at: true } },
    },
    orderBy: { createdAt: "asc" },
  })
  const pending = all.filter((c) => !hasVotedSince(c.approvals, c.auditTrail[0]?.at ?? null, args.userId))
  if (isGroupAdmin(args.realmRoles)) return pending

  // The queue backs the nav badge on every page, so look up each routed CAB once (pending
  // changes share a few OpCo × infra pairs) and the user's nominations in one query.
  const routed = new Map<string, Promise<ApproverUser[]>>()
  const routedFor = (c: ChangeForAuth) => {
    const key = `${c.infrastructureType}|${routedCabOpcoId(c.infrastructureType, c.opcoId)}`
    if (!routed.has(key)) routed.set(key, getRoutedApprovers(c))
    return routed.get(key)!
  }
  const named = new Set(
    (await db.changeAssignee.findMany({
      where: { userId: args.userId, role: "approver", changeId: { in: pending.map((c) => c.id) } },
      select: { changeId: true },
    })).map((r) => r.changeId),
  )

  const visible = []
  for (const c of pending) {
    if (await approvesWith(args.userId, c, await routedFor(c), async () => named.has(c.id))) visible.push(c)
  }
  return visible
}

/**
 * Users a requester may name as an approver on a change in this scope.
 *
 * Equiano infra is group-level: the group CAB and nobody else. All other infra is
 * per-OpCo: the OpCo CAB plus resident approver/admin role holders.
 *
 * Delegates are deliberately absent — a delegate's authority is time-boxed and already
 * resolved by getRoutedApprovers at notification time. Naming one directly would create
 * a second grant that outlives the delegation window.
 */
export async function listEligibleApprovers(
  opcoId: string,
  infrastructureType: string,
  excludeUserId?: string,
): Promise<ApproverUser[]> {
  const db = getPrisma()
  const groupLevel = isGroupLevelInfra(infrastructureType)

  const cab = await db.cABMembership.findMany({
    where: { opcoId: groupLevel ? null : opcoId, isActive: true },
    include: { user: { select: { id: true, name: true, email: true, isActive: true } } },
  })
  const candidates = cab.map((m) => m.user)

  if (!groupLevel) {
    const roleHolders = await db.userOpCoAssignment.findMany({
      where: { opcoId, isActive: true, role: { in: ["approver", "admin"] } },
      include: { user: { select: { id: true, name: true, email: true, isActive: true } } },
    })
    candidates.push(...roleHolders.map((a) => a.user))
  }

  const seen = new Set<string>()
  const out: ApproverUser[] = []
  for (const u of candidates) {
    if (!u.isActive) continue
    if (u.id === excludeUserId) continue
    if (seen.has(u.id)) continue
    seen.add(u.id)
    out.push({ id: u.id, name: u.name, email: u.email })
  }
  return out
}

/** Slug-keyed variant, for callers that have an OpCo slug rather than an id (the request form). */
export async function listEligibleApproversForScope(
  opcoSlug: string,
  infrastructureType: string,
  excludeUserId?: string,
): Promise<ApproverUser[]> {
  const db = getPrisma()
  const opco = await db.opCo.findUnique({ where: { slug: opcoSlug }, select: { id: true } })
  if (!opco) return []
  return listEligibleApprovers(opco.id, infrastructureType, excludeUserId)
}

/** Membership test against the same list, so the check can never diverge from the picker. */
export async function isEligibleApprover(
  userId: string,
  opcoId: string,
  infrastructureType: string,
): Promise<boolean> {
  const eligible = await listEligibleApprovers(opcoId, infrastructureType)
  return eligible.some((u) => u.id === userId)
}
