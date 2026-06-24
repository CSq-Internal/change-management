"use client"

import { useState } from "react"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import { requestAccess } from "@/server/actions/access-requests"
import { Button } from "@/components/ui/button"

export type OpCoOption = { name: string; slug: string }
export type MyRequest = {
  id: string
  opcoName: string
  status: "pending" | "approved" | "denied"
  decisionReason: string | null
  createdAt: string
}

export default function RequestAccessClient({
  opcos,
  requests,
}: {
  opcos: OpCoOption[]
  requests: MyRequest[]
}) {
  const { language } = useStore()
  const tr = (k: string) => t(language, k)
  const [opcoSlug, setOpcoSlug] = useState(opcos[0]?.slug ?? "")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await requestAccess({ opcoSlug, note: note || undefined })
      setDone(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const statusLabel = (s: MyRequest["status"]) => tr(`access.request.status.${s}`)

  return (
    <div className="mx-auto max-w-xl space-y-8 p-6">
      <div>
        <h1 className="text-xl font-semibold">{tr("access.request.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{tr("access.request.intro")}</p>
      </div>

      {opcos.length === 0 ? (
        <p className="text-sm text-muted-foreground">{tr("access.request.empty")}</p>
      ) : (
        <div className="space-y-4">
          <label className="block text-sm font-medium">
            {tr("access.request.opco")}
            <select
              className="mt-1 block w-full rounded-md border bg-background p-2"
              value={opcoSlug}
              onChange={(e) => setOpcoSlug(e.target.value)}
            >
              {opcos.map((o) => (
                <option key={o.slug} value={o.slug}>{o.name}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium">
            {tr("access.request.note")}
            <textarea
              className="mt-1 block w-full rounded-md border bg-background p-2"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          {done && <p className="text-sm text-emerald-600">{tr("access.request.success")}</p>}
          <Button onClick={submit} disabled={busy || !opcoSlug}>
            {busy ? tr("access.request.submitting") : tr("access.request.submit")}
          </Button>
        </div>
      )}

      <div className="space-y-2">
        <h2 className="text-sm font-semibold">{tr("access.request.myRequests")}</h2>
        {requests.length === 0 ? (
          <p className="text-sm text-muted-foreground">{tr("access.request.none")}</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {requests.map((r) => (
              <li key={r.id} className="flex items-center justify-between p-3 text-sm">
                <span>{r.opcoName}</span>
                <span className="text-muted-foreground">
                  {statusLabel(r.status)}
                  {r.decisionReason ? ` — ${r.decisionReason}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
