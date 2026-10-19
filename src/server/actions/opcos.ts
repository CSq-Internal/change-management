// src/server/actions/opcos.ts
"use server"

import { getPrisma } from "@/server/db"
import { getAppSession } from "@/lib/session"
import { isGroupAdmin } from "@/lib/permissions"
import { recordAdminAction } from "@/server/audit"
import { activeOpCos } from "@/server/opco-scope"

function assertGroupAdmin(session: { realmRoles: string[] }) {
  if (!isGroupAdmin(session.realmRoles)) {
    throw new Error("Forbidden: only a group_admin can manage OpCos")
  }
}

// Loads an OpCo by id; throws if missing.
async function loadOpCo(db: ReturnType<typeof getPrisma>, opcoId: string) {
  const opco = await db.opCo.findUnique({ where: { id: opcoId } })
  if (!opco) throw new Error("OpCo not found")
  return opco
}

// Shared preamble for actions on an existing OpCo: resolves the session and client,
// asserts group_admin, and loads the OpCo.
async function authorizeOpCoAction(opcoId: string) {
  const session = await getAppSession()
  assertGroupAdmin(session)
  const db = getPrisma()
  const opco = await loadOpCo(db, opcoId)
  return { session, db, opco }
}

/** Every OpCo that is not archived, for the group admin's header switcher. */
export async function listActiveOpCos() {
  assertGroupAdmin(await getAppSession())
  return activeOpCos("all")
}

export async function createOpCo(input: { slug: string; name: string; locale?: string }) {
  const session = await getAppSession()
  assertGroupAdmin(session)

  const db = getPrisma()
  const existing = await db.opCo.findUnique({ where: { slug: input.slug } })
  if (existing) throw new Error(`OpCo slug already exists: ${input.slug}`)

  return db.$transaction(async (tx) => {
    const opco = await tx.opCo.create({
      data: { slug: input.slug, name: input.name, locale: input.locale ?? "en" },
    })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId,
      actorEmail: session.email,
      actorName: session.name,
      action: "opco.create",
      opcoId: opco.id,
      summary: `Created OpCo ${input.slug} (${input.name})`,
    })
    return opco
  })
}

export async function renameOpCo(opcoId: string, name: string) {
  const { session, db, opco } = await authorizeOpCoAction(opcoId)

  return db.$transaction(async (tx) => {
    const updated = await tx.opCo.update({ where: { id: opcoId }, data: { name } })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId,
      actorEmail: session.email,
      actorName: session.name,
      action: "opco.rename",
      opcoId,
      summary: `Renamed OpCo ${opco.slug} to "${name}"`,
      metadata: { from: opco.name, to: name },
    })
    return updated
  })
}

// Archive and unarchive are the same write with opposite values.
async function setOpCoArchived(opcoId: string, archived: boolean) {
  const { session, db, opco } = await authorizeOpCoAction(opcoId)

  await db.$transaction(async (tx) => {
    await tx.opCo.update({ where: { id: opcoId }, data: { archivedAt: archived ? new Date() : null } })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId,
      actorEmail: session.email,
      actorName: session.name,
      action: archived ? "opco.archive" : "opco.unarchive",
      opcoId,
      summary: `${archived ? "Archived" : "Unarchived"} OpCo ${opco.slug}`,
    })
  })
}

export async function archiveOpCo(opcoId: string) {
  return setOpCoArchived(opcoId, true)
}

export async function unarchiveOpCo(opcoId: string) {
  return setOpCoArchived(opcoId, false)
}
