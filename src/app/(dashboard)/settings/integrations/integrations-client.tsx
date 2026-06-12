"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/toaster"
import { upsertChatWebhook, setChatWebhookActive, deleteChatWebhook } from "@/server/actions/chat-webhooks"

export type WebhookRow = { id: string; opcoSlug: string | null; opcoName: string | null; url: string; isActive: boolean }

export default function IntegrationsClient({
  rows, canManage, scopes,
}: { rows: WebhookRow[]; canManage: boolean; scopes: { slug: string; name: string }[] }) {
  const { language } = useStore()
  const router = useRouter()
  const { toast } = useToast()
  const [, startTransition] = useTransition()
  const [scope, setScope] = useState(scopes[0]?.slug ?? "")
  const [url, setUrl] = useState("")

  const run = (fn: () => Promise<unknown>, okKey: string) =>
    startTransition(async () => {
      try { await fn(); toast({ title: t(language, okKey), variant: "success" }); router.refresh() }
      catch (err) { toast({ title: t(language, "chat.failed"), description: err instanceof Error ? err.message : "", variant: "error" }) }
    })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t(language, "settings.integrations.title")}</h1>
        <p className="text-sm text-muted-foreground">{t(language, "chat.subtitle")}</p>
      </div>

      {canManage && scopes.length > 0 && (
        <Card className="border-border/80 bg-card/95">
          <CardHeader><CardTitle className="text-base">{t(language, "chat.title")}</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <label className="text-xs">{t(language, "chat.scope")}
              <select className="mt-1 block w-44 rounded-md border border-border bg-background px-2 py-1.5 text-sm" value={scope} onChange={(e) => setScope(e.target.value)}>
                {scopes.map((s) => (<option key={s.slug} value={s.slug}>{s.name}</option>))}
              </select>
            </label>
            <div className="flex-1 min-w-64">
              <label className="text-xs">{t(language, "chat.url")}</label>
              <Input placeholder="https://chat.googleapis.com/..." value={url} onChange={(e) => setUrl(e.target.value)} />
            </div>
            <Button onClick={() => run(() => upsertChatWebhook({ opcoSlug: scope || null, url }), "chat.saved")}>{t(language, "chat.save")}</Button>
          </CardContent>
        </Card>
      )}

      <Card className="border-border/80 bg-card/95">
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">{t(language, "chat.empty")}</p>
          ) : (
            <table className="responsive-table w-full text-sm">
              <thead>
                <tr className="border-b border-border/70 text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium">{t(language, "chat.scope")}</th>
                  <th className="px-4 py-2 font-medium">{t(language, "chat.url")}</th>
                  <th className="px-4 py-2 font-medium">{t(language, "chat.active")}</th>
                  {canManage && <th className="px-4 py-2" />}
                </tr>
              </thead>
              <tbody>
                {rows.map((w) => (
                  <tr key={w.id} className="border-b border-border/40">
                    <td className="px-4 py-2" data-label={t(language, "chat.scope")}>{w.opcoName ?? t(language, "chat.group")}</td>
                    <td className="px-4 py-2 truncate max-w-xs" data-label={t(language, "chat.url")}>{w.url}</td>
                    <td className="px-4 py-2" data-label={t(language, "chat.active")}>{w.isActive ? "✓" : "—"}</td>
                    {canManage && (
                      <td className="px-4 py-2 text-right space-x-3" data-label="">
                        <button className="text-xs text-primary hover:underline" onClick={() => run(() => setChatWebhookActive(w.id, !w.isActive), "chat.saved")}>{w.isActive ? t(language, "chat.active") + " ✕" : t(language, "chat.active")}</button>
                        <button className="text-xs text-rose-600 hover:underline" onClick={() => run(() => deleteChatWebhook(w.id), "chat.removed")}>{t(language, "chat.remove")}</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
