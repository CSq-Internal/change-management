import { notFound, redirect } from "next/navigation"
import { auth } from "@/auth"
import { getChange } from "@/server/actions/changes"
import { getPrisma } from "@/server/db"
import { isGroupAdmin, hasRoleInOpCo, isGroupLevel, canAudit } from "@/lib/permissions"
import { canUserApproveChange, listEligibleApprovers } from "@/server/approval-authority"
import { hasVotedSince } from "@/lib/approval-cycle"
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
        // Without changeId the named-approver branch never runs, so a nominated approver
        // who is not on the routed CAB would land here from their notification and find
        // no decision buttons.
        changeId: change.id,
      })
    : false
  // Mirrors the implement-time SoD guard in updateChangeStatus: the *sole* approve-voter
  // cannot also implement. Surfaced so the client can warn before calling the server.
  const approveVoters = [...new Set(change.approvals.filter((a) => a.decision === "approve").map((a) => a.approverId))]
  const soleApproverIsMe = !!meUser && approveVoters.length === 1 && approveVoters[0] === meUser.id
  // Mirrors the stage scoping in submitApproval (@/lib/approval-cycle) so the page never
  // offers a decision the server would refuse. auditTrail is ordered `at: asc`, so the
  // last `submitted` entry opens the current cycle; an expedited change awaiting its
  // retrospective is instead scoped from implementedAt.
  const awaitingRetroDecision =
    change.status === "implemented" && change.expedited && !change.retroApprovedAt
  const lastSubmittedAt =
    change.auditTrail.filter((e) => e.action === "submitted").map((e) => e.at).pop() ?? null
  const hasVotedThisStage =
    !!meUser &&
    hasVotedSince(
      change.approvals,
      awaitingRetroDecision ? change.implementedAt : lastSubmittedAt,
      meUser.id
    )
  const caps: Caps = {
    isRequester: change.requester.keycloakId === me.keycloakId,
    canApprove: canApproveThis,
    isAdmin: isGroupAdmin(me.realmRoles) || hasRoleInOpCo(me.organizations, slug, "admin"),
    isCabMember: isGroupAdmin(me.realmRoles),
    canExportEvidence: isGroupLevel(me.realmRoles) || canAudit(me.organizations, me.realmRoles, slug),
    canManageAssignees: (change.requester.keycloakId === me.keycloakId) || isGroupAdmin(me.realmRoles) || hasRoleInOpCo(me.organizations, slug, "admin"),
    soleApproverIsMe,
    hasVotedThisStage,
  }

  // The dialog draws from two pools. Implementers may be any active user in the OpCo —
  // setChangeAssignees runs no eligibility check on them, and the requester is a common
  // choice. Approvers use the narrower rule (group CAB only for Equiano infra) with the
  // requester excluded, since submitApproval rejects self-approval.
  const [implementerRows, approverRows] = await Promise.all([
    db.userOpCoAssignment.findMany({
      where: { opco: { slug }, isActive: true },
      include: { user: { select: { id: true, name: true, email: true } } },
    }),
    listEligibleApprovers(change.opcoId, change.infrastructureType, change.requesterId),
  ])
  const assigneeCandidates = Array.from(new Map(
    implementerRows.map((a) => [a.user.id, { id: a.user.id, label: a.user.name ?? a.user.email }])
  ).values())
  const approverCandidates = approverRows.map((u) => ({ id: u.id, label: u.name ?? u.email }))

  return (
    <ChangeDetailClient
      change={serialize(change)}
      caps={caps}
      assigneeCandidates={assigneeCandidates}
      approverCandidates={approverCandidates}
    />
  )
}
