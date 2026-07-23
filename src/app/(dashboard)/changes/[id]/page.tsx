import { notFound, redirect } from "next/navigation"
import { auth } from "@/auth"
import { getChange } from "@/server/actions/changes"
import { getPrisma } from "@/server/db"
import { isGroupAdmin, hasRoleInOpCo, isGroupLevel, canAudit } from "@/lib/permissions"
import { canUserApproveChange, listEligibleApprovers } from "@/server/approval-authority"
import ChangeDetailClient from "./change-detail-client"
import type { SerializedChange, Caps } from "./change-detail-client"

function serialize(
  change: NonNullable<Awaited<ReturnType<typeof getChange>>>
): SerializedChange {
  return {
    id: change.id,
    title: change.title,
    description: change.description,
    category: change.category,
    riskLevel: change.riskLevel,
    status: change.status,
    isEmergency: change.isEmergency,
    contactEmail: change.contactEmail,
    infrastructureType: change.infrastructureType,
    changeReason: change.changeReason ?? null,
    impactScope: change.impactScope ?? null,
    implementationPlan: change.implementationPlan ?? null,
    testingPlan: change.testingPlan ?? null,
    backoutPlan: change.backoutPlan ?? null,
    attachments: change.attachments.map((a) => ({ id: a.id, kind: a.kind, filename: a.filename, externalUrl: a.externalUrl })),
    changeWindow: change.changeWindow ?? null,
    plannedStart: change.plannedStart?.toISOString() ?? null,
    plannedEnd: change.plannedEnd?.toISOString() ?? null,
    slaDeadline: change.slaDeadline?.toISOString() ?? null,
    createdAt: change.createdAt.toISOString(),
    updatedAt: change.updatedAt.toISOString(),
    opco: { slug: change.opco.slug, name: change.opco.name },
    requester: {
      keycloakId: change.requester.keycloakId,
      name: change.requester.name ?? null,
      email: change.requester.email,
    },
    approvals: change.approvals.map((a) => ({
      id: a.id,
      approverId: a.approverId,
      decision: a.decision,
      comment: a.comment ?? null,
      isCab: a.isCab,
      decidedAt: a.decidedAt.toISOString(),
      approver: { name: a.approver.name ?? null, email: a.approver.email },
    })),
    auditTrail: change.auditTrail.map((log) => ({
      id: log.id,
      action: log.action,
      fromStatus: log.fromStatus ?? null,
      toStatus: log.toStatus ?? null,
      note: log.note ?? null,
      at: log.at.toISOString(),
      actor: { name: log.actor.name ?? null, email: log.actor.email },
    })),
    implementedAt: change.implementedAt?.toISOString() ?? null,
    implementer: change.implementedBy ? { name: change.implementedBy.name ?? null, email: change.implementedBy.email } : null,
    expedited: change.expedited,
    retroApprovalDueAt: change.retroApprovalDueAt?.toISOString() ?? null,
    retroApprovedAt: change.retroApprovedAt?.toISOString() ?? null,
    hasPir: change.pir != null,
    assignees: change.assignees.map((a) => ({ userId: a.userId, role: a.role, label: a.user.name ?? a.user.email })),
  }
}

export default async function ChangeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const session = await auth()
  if (!session) redirect("/login")

  const change = await getChange(id)
  if (!change) notFound()

  const slug = change.opco.slug
  const me = session.user
  const db = getPrisma()
  const meUser = await db.user.findUnique({ where: { keycloakId: me.keycloakId }, select: { id: true } })
  const canApproveThis = meUser
    ? await canUserApproveChange({
        userId: meUser.id, realmRoles: me.realmRoles,
        change: { infrastructureType: change.infrastructureType, opcoId: change.opcoId },
      })
    : false
  // Mirrors the implement-time SoD guard in updateChangeStatus: the *sole* approve-voter
  // cannot also implement. Surfaced so the client can warn before calling the server.
  const approveVoters = [...new Set(change.approvals.filter((a) => a.decision === "approve").map((a) => a.approverId))]
  const soleApproverIsMe = !!meUser && approveVoters.length === 1 && approveVoters[0] === meUser.id
  const caps: Caps = {
    isRequester: change.requester.keycloakId === me.keycloakId,
    canApprove: canApproveThis,
    isAdmin: isGroupAdmin(me.realmRoles) || hasRoleInOpCo(me.organizations, slug, "admin"),
    isCabMember: isGroupAdmin(me.realmRoles),
    canExportEvidence: isGroupLevel(me.realmRoles) || canAudit(me.organizations, me.realmRoles, slug),
    canManageAssignees: (change.requester.keycloakId === me.keycloakId) || isGroupAdmin(me.realmRoles) || hasRoleInOpCo(me.organizations, slug, "admin"),
    soleApproverIsMe,
  }

  // Approver-eligible users for this change's scope — group CAB only for Equiano infra.
  // The requester is excluded: submitApproval rejects self-approval, so offering them
  // would be a dead end. Uses the same rule setChangeAssignees enforces, so the picker
  // can never offer someone the save will refuse.
  const assigneeCandidates = (
    await listEligibleApprovers(change.opcoId, change.infrastructureType, change.requesterId)
  ).map((u) => ({ id: u.id, label: u.name ?? u.email }))

  return <ChangeDetailClient change={serialize(change)} caps={caps} assigneeCandidates={assigneeCandidates} />
}
