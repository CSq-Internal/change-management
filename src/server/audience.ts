// src/server/audience.ts
// Maps an event type to the people who should hear about it. Call sites say what
// happened; this decides who to tell.
import { getPrisma } from "@/server/db"
import { getRoutedApprovers, getNamedApprovers } from "@/server/approval-authority"
import type { NotifyEventType } from "@/lib/notifications"
import type { NotifyRecipient } from "@/server/notify"

export type AudienceRole =
  | "requester" | "assignees" | "voters" | "approversPending" | "opcoAdmins" | "groupCab"

export type AudienceChange = {
  id: string
  opcoId: string
  infrastructureType: string
  requesterId: string
}

/**
 * assignee_added / assignee_removed target one specific person, known only to the caller
 * (the diff of the assignee set). They pass recipients explicitly rather than going
 * through the resolver, hence their empty role lists.
 */
export const AUDIENCE: Record<NotifyEventType, AudienceRole[]> = {
  approval_requested:  ["approversPending"],
  approver_nudge:      ["approversPending"],
  change_approved:     ["requester"],
  change_rejected:     ["requester"],

  change_submitted:    ["requester"],
  change_implemented:  ["requester", "assignees", "voters"],
  change_verified:     ["requester", "opcoAdmins"],
  change_closed:       ["requester", "assignees"],
  change_reopened:     ["requester", "voters"],
  change_cancelled:    ["requester", "assignees", "voters"],
  change_rescheduled:  ["requester", "assignees", "voters"],

  assignee_added:      [],
  assignee_removed:    [],

  emergency_submitted: ["groupCab"],
  sla_escalated:       ["opcoAdmins"],
  retro_approved:      ["requester", "opcoAdmins"],
  retro_rejected:      ["requester", "opcoAdmins"],
  retro_overdue:       ["requester", "groupCab"],
}

/** Events where the actor is deliberately NOT suppressed — the notification IS the receipt. */
const RECEIPT_TYPES: NotifyEventType[] = ["change_submitted"]

async function idsForRole(role: AudienceRole, change: AudienceChange): Promise<string[]> {
  const db = getPrisma()
  switch (role) {
    case "requester":
      return [change.requesterId]
    case "assignees": {
      const rows = await db.changeAssignee.findMany({
        where: { changeId: change.id }, select: { userId: true },
      })
      return rows.map((r) => r.userId)
    }
    case "voters": {
      const rows = await db.approval.findMany({
        where: { changeId: change.id }, select: { approverId: true },
      })
      return rows.map((r) => r.approverId)
    }
    case "approversPending": {
      const [routed, named, votes] = await Promise.all([
        getRoutedApprovers({ infrastructureType: change.infrastructureType, opcoId: change.opcoId }),
        getNamedApprovers(change.id),
        db.approval.findMany({ where: { changeId: change.id }, select: { approverId: true } }),
      ])
      const voted = new Set(votes.map((v) => v.approverId))
      return [...routed, ...named].map((u) => u.id).filter((id) => !voted.has(id))
    }
    case "opcoAdmins": {
      const rows = await db.userOpCoAssignment.findMany({
        where: { opcoId: change.opcoId, role: "admin", isActive: true }, select: { userId: true },
      })
      return rows.map((r) => r.userId)
    }
    case "groupCab": {
      const rows = await db.cABMembership.findMany({
        where: { opcoId: null, isActive: true }, select: { userId: true },
      })
      return rows.map((r) => r.userId)
    }
  }
}

export async function resolveAudience(
  type: NotifyEventType,
  change: AudienceChange,
  actorId?: string,
): Promise<NotifyRecipient[]> {
  const roles = AUDIENCE[type] ?? []
  if (roles.length === 0) return []

  const idLists = await Promise.all(roles.map((r) => idsForRole(r, change)))
  const ids = new Set(idLists.flat())
  // The actor already knows what they just did. The exception is a receipt, where telling
  // them is the entire point.
  if (actorId && !RECEIPT_TYPES.includes(type)) ids.delete(actorId)
  if (ids.size === 0) return []

  const db = getPrisma()
  const users = await db.user.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, name: true, email: true, isActive: true },
  })
  return users
    .filter((u) => u.isActive)
    .map((u) => ({ userId: u.id, email: u.email, name: u.name }))
}
