"use client"

import { useState, useTransition } from "react"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import { Card, CardContent } from "@/components/ui/card"
import { useToast } from "@/components/ui/toaster"
import { NOTIFY_EVENT_TYPES, type NotifyChannel } from "@/lib/notifications"
import { setMyPreference, type PrefCell } from "@/server/actions/notification-prefs"

const CHANNELS: NotifyChannel[] = ["email", "in_app"]

export default function NotificationsPrefsClient({ prefs }: { prefs: PrefCell[] }) {
  const { language } = useStore()
  const { toast } = useToast()
  const [, startTransition] = useTransition()
  const [cells, setCells] = useState(() => new Map(prefs.map((p) => [`${p.eventType}:${p.channel}`, p.enabled])))

  const toggle = (eventType: string, channel: NotifyChannel) => {
    const key = `${eventType}:${channel}`
    const next = !cells.get(key)
    setCells((m) => new Map(m).set(key, next))
    startTransition(async () => {
      try {
        await setMyPreference(eventType as PrefCell["eventType"], channel, next)
        toast({ title: t(language, "notifPrefs.saved"), variant: "success" })
      } catch (err) {
        setCells((m) => new Map(m).set(key, !next))
        toast({ title: t(language, "notifPrefs.failed"), description: err instanceof Error ? err.message : "", variant: "error" })
      }
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t(language, "settings.notifications.title")}</h1>
        <p className="text-sm text-muted-foreground">{t(language, "notifPrefs.subtitle")}</p>
      </div>
      <Card className="border-border/80 bg-card/95">
        <CardContent className="p-0">
          <table className="responsive-table w-full text-sm">
            <thead>
              <tr className="border-b border-border/70 text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-medium">{t(language, "notifPrefs.event")}</th>
                <th className="px-4 py-2 font-medium text-center">{t(language, "notifPrefs.email")}</th>
                <th className="px-4 py-2 font-medium text-center">{t(language, "notifPrefs.inApp")}</th>
              </tr>
            </thead>
            <tbody>
              {NOTIFY_EVENT_TYPES.map((evt) => (
                <tr key={evt} className="border-b border-border/40">
                  <td className="px-4 py-2" data-label={t(language, "notifPrefs.event")}>{t(language, `notifEvent.${evt}`)}</td>
                  {CHANNELS.map((ch) => (
                    <td key={ch} className="px-4 py-2 text-center" data-label={t(language, ch === "email" ? "notifPrefs.email" : "notifPrefs.inApp")}>
                      <input
                        type="checkbox"
                        checked={cells.get(`${evt}:${ch}`) ?? true}
                        onChange={() => toggle(evt, ch)}
                        aria-label={`${evt} ${ch}`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
