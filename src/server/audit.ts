import type { Prisma } from "@prisma/client"

export interface AdminActionInput {
  actorKeycloakId: string
  action: string
  summary: string
  opcoId?: string | null
  targetUserId?: string | null
  metadata?: Prisma.InputJsonValue
}

// Minimal client shape needed; satisfied by both PrismaClient and a transaction client.
type AuditClient = {
  user: { findUnique: (args: unknown) => Promise<{ id: string } | null> }
  adminAuditLog: { create: (args: unknown) => Promise<unknown> }
}

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
