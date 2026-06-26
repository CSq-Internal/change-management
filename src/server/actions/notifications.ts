"use server"

import { getPrisma } from "@/server/db"
import { getAppSession } from "@/lib/session"
import { listApprovableChanges } from "@/server/approval-authority"
import { coerceLocale, type Language } from "@/lib/i18n"
import { manageableOpCoSlugs } from "@/lib/permissions"

async function meId(): Promise<string> {
  const session = await getAppSession()
  const db = getPrisma()
  const u = await db.user.findUnique({ where: { keycloakId: session.keycloakId }, select: { id: true } })
  if (!u) throw new Error("User not found")
  return u.id
}

export async function listMyNotifications() {
  const userId = await meId()
  const db = getPrisma()
  return db.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 50 })
}

export async function markNotificationRead(id: string) {
  const userId = await meId()
  const db = getPrisma()
  await db.notification.updateMany({ where: { id, userId, readAt: null }, data: { readAt: new Date() } })
}

export async function markAllNotificationsRead() {
  const userId = await meId()
  const db = getPrisma()
  await db.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } })
}

// Best-effort: records the UI language choice for server-side notification copy.
// Never throws — a failure must not block the instant client-side language switch.
export async function setMyLocale(locale: Language): Promise<void> {
  try {
    const session = await getAppSession()
    const db = getPrisma()
    await db.user.update({ where: { keycloakId: session.keycloakId }, data: { locale: coerceLocale(locale) } })
  } catch (err) {
    console.warn("[setMyLocale] failed to persist locale:", err)
  }
}

export async function getNavCounts() {
  const session = await getAppSession()
  const db = getPrisma()
  const u = await db.user.findUnique({ where: { keycloakId: session.keycloakId }, select: { id: true } })
  if (!u) return { pendingApprovals: 0, myRequests: 0, unreadNotifications: 0, pendingAccessRequests: 0 }
  const scope = manageableOpCoSlugs(session.organizations, session.realmRoles)
  const [approvable, myRequests, unreadNotifications, pendingAccessRequests] = await Promise.all([
    listApprovableChanges({ userId: u.id, realmRoles: session.realmRoles }),
    // Only requests that need the requester's action: drafts to finish/submit and
    // rejected ones to rework.
    db.changeRequest.count({ where: { requesterId: u.id, status: { in: ["draft", "rejected"] } } }),
    db.notification.count({ where: { userId: u.id, readAt: null } }),
    // Pending access requests the caller can act on — scoped exactly like listAccessRequests.
    db.accessRequest.count({
      where: { status: "pending", ...(scope === "all" ? {} : { opco: { slug: { in: scope } } }) },
    }),
  ])
  return { pendingApprovals: approvable.length, myRequests, unreadNotifications, pendingAccessRequests }
}
