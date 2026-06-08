"use server"

import { getPrisma } from "@/server/db"
import { getAppSession } from "@/lib/session"
import { isGroupAdmin, hasRoleInOpCo } from "@/lib/permissions"
import { recordAdminAction } from "@/server/audit"

async function assertCanManage(opcoSlug: string | null) {
  const session = await getAppSession()
  const ok = opcoSlug === null
    ? isGroupAdmin(session.realmRoles)
    : isGroupAdmin(session.realmRoles) || hasRoleInOpCo(session.organizations, opcoSlug, "admin")
  if (!ok) throw new Error("Forbidden: not authorized to manage this Chat webhook")
  return session
}

export async function listChatWebhooks() {
  const session = await getAppSession()
  const db = getPrisma()
  const slugs = session.organizations.filter((o) => o.roles.includes("admin")).map((o) => o.alias)
  const where = isGroupAdmin(session.realmRoles)
    ? {}
    : { OR: [{ opco: { slug: { in: slugs } } }] }
  return db.chatWebhook.findMany({ where, include: { opco: { select: { name: true, slug: true } } }, orderBy: { createdAt: "desc" } })
}

export async function upsertChatWebhook(input: { opcoSlug: string | null; url: string }) {
  if (!/^https:\/\/chat\.googleapis\.com\//.test(input.url))
    throw new Error("URL must be a Google Chat webhook (https://chat.googleapis.com/...)")
  const session = await assertCanManage(input.opcoSlug)
  const db = getPrisma()
  const opco = input.opcoSlug ? await db.opCo.findUnique({ where: { slug: input.opcoSlug } }) : null
  if (input.opcoSlug && !opco) throw new Error("OpCo not found")
  const opcoId = opco?.id ?? null

  return db.$transaction(async (tx) => {
    const actor = await tx.user.findUnique({ where: { keycloakId: session.keycloakId }, select: { id: true } })
    if (!actor) throw new Error("User not found")
    const existing = await tx.chatWebhook.findFirst({ where: { opcoId } })
    const hook = existing
      ? await tx.chatWebhook.update({ where: { id: existing.id }, data: { url: input.url, isActive: true } })
      : await tx.chatWebhook.create({ data: { opcoId, url: input.url, createdById: actor.id } })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId, action: "chat_webhook_set",
      opcoId, summary: `Set Google Chat webhook for ${input.opcoSlug ?? "group"}`,
    })
    return hook
  })
}

export async function setChatWebhookActive(id: string, isActive: boolean) {
  const db = getPrisma()
  const hook = await db.chatWebhook.findUnique({ where: { id }, include: { opco: { select: { slug: true } } } })
  if (!hook) throw new Error("Webhook not found")
  await assertCanManage(hook.opco?.slug ?? null)
  await db.chatWebhook.update({ where: { id }, data: { isActive } })
}

export async function deleteChatWebhook(id: string) {
  const db = getPrisma()
  const hook = await db.chatWebhook.findUnique({ where: { id }, include: { opco: { select: { slug: true } } } })
  if (!hook) throw new Error("Webhook not found")
  const session = await assertCanManage(hook.opco?.slug ?? null)
  await db.$transaction(async (tx) => {
    await tx.chatWebhook.delete({ where: { id } })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId, action: "chat_webhook_removed",
      opcoId: hook.opcoId, summary: `Removed Google Chat webhook for ${hook.opco?.slug ?? "group"}`,
    })
  })
}
