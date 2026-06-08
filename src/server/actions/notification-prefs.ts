"use server"

import { getPrisma } from "@/server/db"
import { getAppSession } from "@/lib/session"
import { NOTIFY_EVENT_TYPES, type NotifyEventType, type NotifyChannel } from "@/lib/notifications"

const CHANNELS: NotifyChannel[] = ["email", "in_app"]

async function meId(): Promise<string> {
  const session = await getAppSession()
  const db = getPrisma()
  const u = await db.user.findUnique({ where: { keycloakId: session.keycloakId }, select: { id: true } })
  if (!u) throw new Error("User not found")
  return u.id
}

export type PrefCell = { eventType: NotifyEventType; channel: NotifyChannel; enabled: boolean }

export async function getMyPreferences(): Promise<PrefCell[]> {
  const userId = await meId()
  const db = getPrisma()
  const rows = await db.notificationPreference.findMany({ where: { userId } })
  const stored = new Map(rows.map((r) => [`${r.eventType}:${r.channel}`, r.enabled]))
  const cells: PrefCell[] = []
  for (const eventType of NOTIFY_EVENT_TYPES) {
    for (const channel of CHANNELS) {
      const key = `${eventType}:${channel}`
      cells.push({ eventType, channel, enabled: stored.has(key) ? stored.get(key)! : true })
    }
  }
  return cells
}

export async function setMyPreference(eventType: NotifyEventType, channel: NotifyChannel, enabled: boolean) {
  const userId = await meId()
  const db = getPrisma()
  await db.notificationPreference.upsert({
    where: { userId_eventType_channel: { userId, eventType, channel } },
    create: { userId, eventType, channel, enabled },
    update: { enabled },
  })
}
