import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { listMyNotifications } from "@/server/actions/notifications"
import HistoryClient, { type NotifRow } from "./history-client"

export default async function NotificationHistoryPage() {
  const session = await auth()
  if (!session) redirect("/login")
  const notifications = await listMyNotifications()
  const rows: NotifRow[] = notifications.map((n) => ({
    id: n.id, type: n.type, title: n.title, body: n.body,
    changeId: n.changeId ?? null, read: n.readAt != null, createdAt: n.createdAt.toISOString(),
  }))
  return <HistoryClient rows={rows} />
}
