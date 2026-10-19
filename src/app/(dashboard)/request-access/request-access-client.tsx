"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import { joinOpCo } from "@/server/actions/access-requests"
import { Button } from "@/components/ui/button"

export type OpCoOption = { name: string; slug: string }

export default function RequestAccessClient({ opcos, hasAccess = false }: { opcos: OpCoOption[]; hasAccess?: boolean }) {
  const { language } = useStore()
  const tr = (k: string) => t(language, k)
  const { update, status } = useSession()
  const router = useRouter()
  const [opcoSlug, setOpcoSlug] = useState(opcos[0]?.slug ?? "")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Access arrived on the server's 60s refresh, but the cookie the proxy reads is stale:
  // rewrite it before leaving, or the proxy sends the user straight back here. update()
  // is a no-op while the first session load runs, so wait for it, and refresh only once.
  const refreshed = useRef(false)
  useEffect(() => {
    if (!hasAccess || status === "loading" || refreshed.current) return
    refreshed.current = true
    void update({}).then(() => router.replace("/"))
  }, [hasAccess, status]) // eslint-disable-line react-hooks/exhaustive-deps

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await joinOpCo(opcoSlug)
      // Reload the session's OpCo roles now; otherwise the gate holds the user
      // until the 60s refresh. update() rewrites the session cookie the proxy reads;
      // it needs an argument, or next-auth sends a GET that skips trigger "update".
      await update({})
      router.replace("/")
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  if (hasAccess) return null

  return (
    <div className="mx-auto max-w-xl space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">{tr("access.join.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{tr("access.join.intro")}</p>
      </div>

      {opcos.length === 0 ? (
        <p className="text-sm text-muted-foreground">{tr("access.join.empty")}</p>
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
          <p className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
            {tr("access.join.notice")}
          </p>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <Button onClick={submit} disabled={busy || !opcoSlug}>
            {busy ? tr("access.join.continuing") : tr("access.join.continue")}
          </Button>
        </div>
      )}
    </div>
  )
}
