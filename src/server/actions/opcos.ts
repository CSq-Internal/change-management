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
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
