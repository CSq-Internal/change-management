"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import { requestRole, type RequestableRole } from "@/server/actions/access-requests"
import { errorMessage } from "@/lib/user-error"

export type MyRoleRequest = {
  id: string
  opcoName: string
  role: string
  status: "pending" | "approved" | "denied"
  decisionReason: string | null
  createdAt: string
}

const ROLES: RequestableRole[] = ["approver", "auditor", "admin"]
const fieldClass = "mt-1 block w-full rounded-md border border-border bg-background p-2 text-sm"

export default function RoleRequestCard({
  opcos,
  requests,
  defaultOpco,
}: {
  opcos: { name: string; slug: string }[]
  requests: MyRoleRequest[]
  /** The user's own OpCo, where a role request is most likely meant. */
  defaultOpco?: string
}) {
  const { language } = useStore()
  const tr = (k: string) => t(language, k)
  const router = useRouter()
  const [opcoSlug, setOpcoSlug] = useState(defaultOpco ?? opcos[0]?.slug ?? "")
  const [role, setRole] = useState<RequestableRole>("approver")
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function submit() {
    setBusy(true)
    setError(null)
    setDone(false)
    try {
      await requestRole({ opcoSlug, role, reason })
      setReason("")
      setDone(true)
      router.refresh()
    } catch (e) {
      setError(errorMessage(e, tr("common.unknownError")))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{tr("access.role.title")}</CardTitle>
        <CardDescription>{tr("access.role.desc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          {/* Labels point at their fields by id: a wrapping label's text would include the options. */}
          <div>
            <label htmlFor="rr-opco" className="block text-sm font-medium">{tr("access.request.opco")}</label>
            <select id="rr-opco" className={fieldClass} value={opcoSlug} onChange={(e) => setOpcoSlug(e.target.value)}>
              {opcos.map((o) => (<option key={o.slug} value={o.slug}>{o.name}</option>))}
            </select>
          </div>
          <div>
            <label htmlFor="rr-role" className="block text-sm font-medium">{tr("access.role.role")}</label>
            <select id="rr-role" className={fieldClass} value={role} onChange={(e) => setRole(e.target.value as RequestableRole)}>
              {ROLES.map((r) => (<option key={r} value={r}>{tr(`roles.${r}`)}</option>))}
            </select>
          </div>
        </div>
        <div>
          <label htmlFor="rr-reason" className="block text-sm font-medium">{tr("access.role.reason")}</label>
          <textarea id="rr-reason" className={fieldClass} rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        {done && <p className="text-sm text-emerald-600">{tr("access.role.sent")}</p>}
        <Button onClick={submit} disabled={busy || !opcoSlug || !reason.trim()}>
          {tr("access.role.submit")}
        </Button>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold">{tr("access.request.myRequests")}</h3>
          {requests.length === 0 ? (
            <p className="text-sm text-muted-foreground">{tr("access.request.none")}</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {requests.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                  <span>{tr(`roles.${r.role}`)} · {r.opcoName}</span>
                  <span className="text-muted-foreground">
                    {tr(`access.request.status.${r.status}`)}
                    {r.decisionReason ? ` — ${r.decisionReason}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
