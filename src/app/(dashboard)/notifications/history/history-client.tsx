"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { markNotificationRead, markAllNotificationsRead } from "@/server/actions/notifications"

export type NotifRow = {
  id: string; type: string; title: string; body: string
  changeId: string | null; read: boolean; createdAt: string
}

export default function HistoryClient({ rows }: { rows: NotifRow[] }) {
  const { language } = useStore()
  const router = useRouter()
  const [, startTransition] = useTransition()

  const open = (n: NotifRow) => {
    startTransition(async () => {
      if (!n.read) await markNotificationRead(n.id).catch(() => {})
      if (n.changeId) router.push(`/changes/${n.changeId}`)
      else router.refresh()
    })
  }
  const markAll = () => startTransition(async () => { await markAllNotificationsRead().catch(() => {}); router.refresh() })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t(language, "nav.notificationHistory")}</h1>
          <p className="text-sm text-muted-foreground">{t(language, "notif.subtitle")}</p>
        </div>
        {rows.some((r) => !r.read) && <Button variant="outline" onClick={markAll}>{t(language, "notif.markAll")}</Button>}
      </div>

      <Card className="border-border/80 bg-card/95">
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">{t(language, "notif.empty")}</p>
          ) : (
            <ul className="divide-y divide-border/50">
              {rows.map((n) => (
                <li key={n.id}>
                  <button
                    onClick={() => open(n)}
                    className={`flex w-full flex-col items-start gap-0.5 px-4 py-3 text-left hover:bg-muted/50 ${n.read ? "" : "bg-muted/30"}`}
                  >
                    <span className="flex items-center gap-2 text-sm font-medium">
                      {!n.read && <span className="h-2 w-2 rounded-full bg-rose-600" />}
                      {n.title}
                    </span>
                    <span className="text-xs text-muted-foreground">{n.body}</span>
                    <span className="text-[11px] text-muted-foreground">{new Date(n.createdAt).toLocaleString()}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
