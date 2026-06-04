// src/server/actions/opcos.ts
"use server"

import { getPrisma } from "@/server/db"
import { getAppSession } from "@/lib/session"
import { isGroupAdmin } from "@/lib/permissions"
import { createKeycloakOrg } from "@/server/keycloak"
import { recordAdminAction } from "@/server/audit"

function assertGroupAdmin(session: { realmRoles: string[] }) {
  if (!isGroupAdmin(session.realmRoles)) {
    throw new Error("Forbidden: only a group_admin can manage OpCos")
  }
}

// Loads an OpCo by id; throws if missing. (Used by rename/archive actions.)
async function loadOpCo(db: ReturnType<typeof getPrisma>, opcoId: string) {
  const opco = await db.opCo.findUnique({ where: { id: opcoId } })
  if (!opco) throw new Error("OpCo not found")
  return opco
}

export async function createOpCo(input: { slug: string; name: string; locale?: string }) {
  const session = await getAppSession()
  assertGroupAdmin(session)

  const db = getPrisma()
  const existing = await db.opCo.findUnique({ where: { slug: input.slug } })
  if (existing) throw new Error(`OpCo slug already exists: ${input.slug}`)

  // Best-effort Keycloak org provisioning; fall back to a placeholder id if unavailable.
  let keycloakOrgId: string
  try {
    keycloakOrgId = await createKeycloakOrg(input.slug, input.name)
  } catch (err) {
    console.warn(`[createOpCo] Keycloak org creation skipped for ${input.slug}:`, err)
    keycloakOrgId = `pending-keycloak-${input.slug}`
  }

  return db.$transaction(async (tx) => {
    const opco = await tx.opCo.create({
      data: { slug: input.slug, name: input.name, locale: input.locale ?? "en", keycloakOrgId },
    })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId,
      action: "opco.create",
      opcoId: opco.id,
      summary: `Created OpCo ${input.slug} (${input.name})`,
    })
    return opco
  })
}

export async function renameOpCo(opcoId: string, name: string) {
  const session = await getAppSession()
  assertGroupAdmin(session)
  const db = getPrisma()
  const opco = await loadOpCo(db, opcoId)

  return db.$transaction(async (tx) => {
    const updated = await tx.opCo.update({ where: { id: opcoId }, data: { name } })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId,
      action: "opco.rename",
      opcoId,
      summary: `Renamed OpCo ${opco.slug} to "${name}"`,
      metadata: { from: opco.name, to: name },
    })
    return updated
  })
}

export async function archiveOpCo(opcoId: string) {
  const session = await getAppSession()
  assertGroupAdmin(session)
  const db = getPrisma()
  const opco = await loadOpCo(db, opcoId)

  await db.$transaction(async (tx) => {
    await tx.opCo.update({ where: { id: opcoId }, data: { archivedAt: new Date() } })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId,
      action: "opco.archive",
      opcoId,
      summary: `Archived OpCo ${opco.slug}`,
    })
  })
}

export async function unarchiveOpCo(opcoId: string) {
  const session = await getAppSession()
  assertGroupAdmin(session)
  const db = getPrisma()
  const opco = await loadOpCo(db, opcoId)

  await db.$transaction(async (tx) => {
    await tx.opCo.update({ where: { id: opcoId }, data: { archivedAt: null } })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId,
      action: "opco.unarchive",
      opcoId,
      summary: `Unarchived OpCo ${opco.slug}`,
    })
  })
}
