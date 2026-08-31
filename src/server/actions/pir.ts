// src/server/actions/pir.ts
"use server"

import { getPrisma } from "@/server/db"
import { getAppSession } from "@/lib/session"
import { notifyChange } from "@/server/notify"
import { isGroupAdmin, hasRoleInOpCo, canApprove } from "@/lib/permissions"
import type { PirOutcome } from "@prisma/client"

export async function submitPostImplementationReview(
  changeId: string,
  input: { outcome: PirOutcome; summary: string; backoutUsed: boolean },
) {
  const session = await getAppSession()
  const db = getPrisma()
  const user = await db.user.findUnique({ where: { keycloakId: session.keycloakId } })
  if (!user) throw new Error("User not found")

  const change = await db.changeRequest.findUnique({
    where: { id: changeId },
    include: { opco: true, pir: true },
  })
  if (!change) throw new Error("Change not found")
  if (change.status !== "implemented") {
    throw new Error("A PIR can only be recorded for an implemented change")
  }
  if (change.pir) throw new Error("This change already has a Post-Implementation Review")

  if (!input.summary?.trim()) {
    throw new Error("A summary is required for the Post-Implementation Review")
  }

  const authorized =
    isGroupAdmin(session.realmRoles) ||
    hasRoleInOpCo(session.organizations, change.opco.slug, "admin") ||
    canApprove(session.organizations, change.opco.slug) ||
    change.implementedById === user.id
  if (!authorized) throw new Error("Forbidden: not authorized to record a PIR for this change")

  // Expedited emergencies must be sanctioned (retrospective approval) before verification.
  if (change.expedited && !change.retroApprovedAt) {
    throw new Error("This emergency change needs a retrospective approval before it can be verified")
  }

  const pir = await db.$transaction(async (tx) => {
    const pir = await tx.postImplementationReview.create({
      data: {
        changeId,
        authorId: user.id,
        outcome: input.outcome,
        summary: input.summary.trim(),
        backoutUsed: input.backoutUsed,
      },
    })
    await tx.changeRequest.update({ where: { id: changeId }, data: { status: "verified" } })
    await tx.auditLog.create({
      data: {
        changeId, actorId: user.id, action: "pir_recorded",
        fromStatus: "implemented", toStatus: "verified",
        note: `PIR: ${input.outcome}${input.backoutUsed ? " (backout used)" : ""}`,
      },
    })
    return pir
  })

  // After the transaction commits — a notification must never hold a DB transaction open
  // nor roll one back.
  await notifyChange("change_verified", changeId, {
    actorId: user.id, actorName: user.name ?? user.email,
    outcome: input.outcome, note: input.summary.trim(),
  }).catch(() => {})

  return pir
}
