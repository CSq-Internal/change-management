"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import { approveAccessRequest, denyAccessRequest } from "@/server/actions/access-requests"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toaster"

export type QueueRow = {
  id: string
  role: string
  note: string | null
  createdAt: string
  opcoName: string
  opcoSlug: string
  requesterName: string
  requesterEmail: string
}

export default function AccessRequestsClient({ requests }: { requests: QueueRow[] }) {
  const { language } = useStore()
  const tr = (k: string) => t(language, k)
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const { toast } = useToast()
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  // One decision at a time: a second click (approve, then deny) waits for the first.
  async function decide(action: () => Promise<unknown>) {
    setBusy(true)
    try {
      await action()
    } catch (err) {
      toast({ title: tr("access.queue.failed"), description: err instanceof Error ? err.message : String(err), variant: "error" })
    } finally {
      setBusy(false)
      startTransition(() => router.refresh())
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-xl font-semibold">{tr("access.queue.title")}</h1>
      {requests.length === 0 ? (
        <p className="text-sm text-muted-foreground">{tr("access.queue.empty")}</p>
      ) : (
        <ul className="space-y-4">
          {requests.map((r) => (
            <li key={r.id} className="space-y-3 rounded-md border p-4">
              <div className="space-y-1 text-sm">
                <div>
                  <span className="font-medium">{tr("access.queue.requester")}:</span>{" "}
                  <span>{r.requesterName}</span> <span className="text-muted-foreground">({r.requesterEmail})</span>
                </div>
                <div>
                  <span className="font-medium">{tr("access.queue.opco")}:</span> <span>{r.opcoName}</span>
                </div>
                <div>
                  <span className="font-medium">{tr("access.role.role")}:</span> <span>{tr(`roles.${r.role}`)}</span>
                </div>
                {r.note && (
                  <div>
                    <span className="font-medium">{tr("access.queue.note")}:</span> <span>{r.note}</span>
                  </div>
                )}
              </div>
              <input
                className="block w-full rounded-md border bg-background p-2 text-sm"
                placeholder={tr("access.queue.denyReason")}
                value={reasons[r.id] ?? ""}
                onChange={(e) => setReasons((m) => ({ ...m, [r.id]: e.target.value }))}
              />
              <div className="flex gap-2">
                <Button onClick={() => decide(() => approveAccessRequest(r.id))} disabled={busy || pending}>{tr("access.queue.approve")}</Button>
                <Button variant="outline" onClick={() => decide(() => denyAccessRequest(r.id, reasons[r.id] || undefined))} disabled={busy || pending}>{tr("access.queue.deny")}</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
