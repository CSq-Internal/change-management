"use server"

import { getPrisma } from "@/server/db"
import { getAppSession } from "@/lib/session"
import { listApprovableChanges } from "@/server/approval-authority"

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

export async function getNavCounts() {
  const session = await getAppSession()
  const db = getPrisma()
  const u = await db.user.findUnique({ where: { keycloakId: session.keycloakId }, select: { id: true } })
  if (!u) return { pendingApprovals: 0, myRequests: 0, unreadNotifications: 0 }
  const [approvable, myRequests, unreadNotifications] = await Promise.all([
    listApprovableChanges({ userId: u.id, realmRoles: session.realmRoles }),
    // Only requests that need the requester's action: drafts to finish/submit and
    // rejected ones to rework. In-flight (pending/approved/implemented) and terminal
    // (verified/closed) states need nothing from them, so they don't belong on the badge.
    db.changeRequest.count({ where: { requesterId: u.id, status: { in: ["draft", "rejected"] } } }),
    db.notification.count({ where: { userId: u.id, readAt: null } }),
  ])
  return { pendingApprovals: approvable.length, myRequests, unreadNotifications }
}
