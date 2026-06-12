import type { Prisma } from "@prisma/client"

export interface AdminActionInput {
  actorKeycloakId: string
  // Actor identity for lazy reconciliation. A group_admin is authorised by realm role
  // and may act before their Keycloak identity is linked to a DB user (e.g. their email
  // was unverified at first sign-in, so enrichedJwt skipped the upsert). When the actor
  // row is missing we link/create it by email here so admin actions don't hard-fail.
  actorEmail?: string | null
  actorName?: string | null
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
  let actor = await tx.user.findUnique({
    where: { keycloakId: input.actorKeycloakId },
    select: { id: true },
  })
  if (!actor) {
    // Link/create the actor by email (verified-email gating already happened upstream
    // in enrichedJwt; reaching here means it was skipped). Without an email we can't
    // safely reconcile, so preserve the original hard failure.
    if (!input.actorEmail) throw new Error("Cannot record admin action: actor not found")
    actor = await tx.user.upsert({
      where: { email: input.actorEmail },
      update: { keycloakId: input.actorKeycloakId },
      create: {
        keycloakId: input.actorKeycloakId,
        email: input.actorEmail,
        name: input.actorName ?? null,
      },
      select: { id: true },
    })
  }

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
