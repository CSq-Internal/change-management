import type { Prisma } from "@prisma/client"

export interface AdminActionInput {
  actorKeycloakId: string
  action: string
  summary: string
  opcoId?: string | null
  targetUserId?: string | null
  metadata?: Prisma.InputJsonValue
}

// Accepts a Prisma transaction client (or the full client) so callers can append
// the audit row inside the same transaction as the action it records.
type AuditClient = Pick<Prisma.TransactionClient, "user" | "adminAuditLog">

export async function recordAdminAction(tx: AuditClient, input: AdminActionInput): Promise<void> {
  const actor = await tx.user.findUnique({
    where: { keycloakId: input.actorKeycloakId },
    select: { id: true },
  })
  if (!actor) throw new Error("Cannot record admin action: actor not found")

  await tx.adminAuditLog.create({
    data: {
      actorId: actor.id,
      action: input.action,
      opcoId: input.opcoId ?? null,
      targetUserId: input.targetUserId ?? null,
      summary: input.summary,
      metadata: input.metadata,
    },
  })
}
