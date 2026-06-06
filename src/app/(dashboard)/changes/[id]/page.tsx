import { notFound, redirect } from "next/navigation"
import { auth } from "@/auth"
import { getChange } from "@/server/actions/changes"
import { getPrisma } from "@/server/db"
import { isGroupAdmin, hasRoleInOpCo } from "@/lib/permissions"
import { canUserApproveChange } from "@/server/approval-authority"
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
    attachments: change.attachments.map((a) => ({ id: a.id, kind: a.kind, filename: a.filename })),
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
  const caps: Caps = {
    isRequester: change.requester.keycloakId === me.keycloakId,
    canApprove: canApproveThis,
    isAdmin: isGroupAdmin(me.realmRoles) || hasRoleInOpCo(me.organizations, slug, "admin"),
    isCabMember: isGroupAdmin(me.realmRoles),
  }

  return <ChangeDetailClient change={serialize(change)} caps={caps} />
}
