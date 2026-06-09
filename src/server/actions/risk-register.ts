"use server"

import { getPrisma } from "@/server/db"
import { getAppSession } from "@/lib/session"
import { isGroupAdmin, isGroupLevel, hasRoleInOpCo } from "@/lib/permissions"
import { recordAdminAction } from "@/server/audit"
import type { RiskCategory, RiskStatus } from "@prisma/client"

export type RiskInput = {
  title: string
  description: string
  category: RiskCategory
  likelihood: number
  impact: number
  owner: string
  mitigationPlan: string | null
  status: RiskStatus
  reviewDate: string | null
  opcoSlug: string | null
}

function validate(input: RiskInput) {
  if (!input.title.trim() || !input.description.trim() || !input.owner.trim())
    throw new Error("Title, description and owner are required")
  if (![input.likelihood, input.impact].every((n) => Number.isInteger(n) && n >= 1 && n <= 5))
    throw new Error("Likelihood and impact must be integers from 1 to 5")
}

async function assertCanManage(opcoSlug: string | null) {
  const session = await getAppSession()
  const allowed = opcoSlug === null
    ? isGroupAdmin(session.realmRoles)
    : isGroupAdmin(session.realmRoles) || hasRoleInOpCo(session.organizations, opcoSlug, "admin")
  if (!allowed) throw new Error("Forbidden: not authorized to manage risks in this scope")
  return session
}

export async function listRisks() {
  const session = await getAppSession()
  const db = getPrisma()
  const groupLevel = isGroupLevel(session.realmRoles)
  const opcoSlugs = session.organizations.map((o) => o.alias)
  return db.riskRegister.findMany({
    where: groupLevel ? {} : { OR: [{ opcoId: null }, { opco: { slug: { in: opcoSlugs } } }] },
    include: { opco: { select: { name: true, slug: true } } },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  })
}

export async function createRisk(input: RiskInput) {
  validate(input)
  const session = await assertCanManage(input.opcoSlug)
  const db = getPrisma()
  const opco = input.opcoSlug ? await db.opCo.findUnique({ where: { slug: input.opcoSlug } }) : null
  if (input.opcoSlug && !opco) throw new Error("OpCo not found")

  return db.$transaction(async (tx) => {
    const actor = await tx.user.findUnique({ where: { keycloakId: session.keycloakId }, select: { id: true } })
    if (!actor) throw new Error("User not found")
    const risk = await tx.riskRegister.create({
      data: {
        title: input.title, description: input.description, category: input.category,
        likelihood: input.likelihood, impact: input.impact, owner: input.owner,
        mitigationPlan: input.mitigationPlan, status: input.status,
        reviewDate: input.reviewDate ? new Date(input.reviewDate) : null,
        opcoId: opco?.id ?? null, createdById: actor.id,
      },
    })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId, actorEmail: session.email, actorName: session.name, action: "risk_created",
      opcoId: opco?.id ?? null, summary: `Created risk "${input.title}"`,
    })
    return risk
  })
}

export async function updateRisk(id: string, input: RiskInput) {
  validate(input)
  const db = getPrisma()
  const existing = await db.riskRegister.findUnique({ where: { id }, include: { opco: { select: { slug: true } } } })
  if (!existing) throw new Error("Risk not found")
  await assertCanManage(existing.opco?.slug ?? null)
  const session = await assertCanManage(input.opcoSlug)
  const opco = input.opcoSlug ? await db.opCo.findUnique({ where: { slug: input.opcoSlug } }) : null
  if (input.opcoSlug && !opco) throw new Error("OpCo not found")

  return db.$transaction(async (tx) => {
    const risk = await tx.riskRegister.update({
      where: { id },
      data: {
        title: input.title, description: input.description, category: input.category,
        likelihood: input.likelihood, impact: input.impact, owner: input.owner,
        mitigationPlan: input.mitigationPlan, status: input.status,
        reviewDate: input.reviewDate ? new Date(input.reviewDate) : null,
        opcoId: opco?.id ?? null,
      },
    })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId, actorEmail: session.email, actorName: session.name, action: "risk_updated",
      opcoId: opco?.id ?? null, summary: `Updated risk "${input.title}"`,
    })
    return risk
  })
}

export async function setRiskStatus(id: string, status: RiskStatus) {
  const db = getPrisma()
  const existing = await db.riskRegister.findUnique({ where: { id }, include: { opco: { select: { slug: true } } } })
  if (!existing) throw new Error("Risk not found")
  const session = await assertCanManage(existing.opco?.slug ?? null)
  return db.$transaction(async (tx) => {
    const risk = await tx.riskRegister.update({ where: { id }, data: { status } })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId, actorEmail: session.email, actorName: session.name, action: status === "closed" ? "risk_closed" : "risk_updated",
      opcoId: existing.opcoId, summary: `Set risk "${existing.title}" to ${status}`,
    })
    return risk
  })
}
