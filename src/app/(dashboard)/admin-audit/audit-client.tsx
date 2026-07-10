"use client"

import { useState } from "react"
import { useStore } from "@/lib/store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/toaster"
import { t } from "@/lib/i18n"
import { listAdminAudit } from "@/server/actions/audit-log"
import AuditList from "./audit-list"
import type { AuditRow } from "./types"

const ACTIONS = [
  "user.onboard", "user.link", "user.deactivate", "user.reactivate", "role.update",
  "team.create", "team.delete", "team.member.add", "team.member.remove", "team.member.role",
  "cab.add", "cab.remove", "opco.create", "opco.rename", "opco.archive", "opco.unarchive",
  "delegation.create", "delegation.revoke",
  "risk_created", "risk_updated", "risk_closed", "blackout_created", "blackout_removed",
]

interface AuditClientProps {
  initialRows: AuditRow[]
}

export default function AuditClient({ initialRows }: AuditClientProps) {
  const { language } = useStore()
  const { toast } = useToast()
  const [rows, setRows] = useState<AuditRow[]>(initialRows)
  const [action, setAction] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [pending, setPending] = useState(false)

  const apply = async () => {
    setPending(true)
    try {
      const next = await listAdminAudit({
        action: action || undefined,
        from: from ? new Date(from) : undefined,
        to: to ? new Date(to) : undefined,
      })
      setRows(next)
    } catch (err) {
      toast({ title: "Failed", description: err instanceof Error ? err.message : "Unknown error", variant: "error" })
    } finally {
      setPending(false)
    }
  }

  const clear = async () => {
    setAction(""); setFrom(""); setTo("")
    setPending(true)
    try {
      setRows(await listAdminAudit({}))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t(language, "auditAdmin.title")}</h1>
        <p className="text-sm text-muted-foreground">{t(language, "auditAdmin.desc")}</p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-muted-foreground">
          {t(language, "auditAdmin.filterAction")}
          <select
            className="mt-1 block rounded border bg-background px-2 py-2 text-sm"
            value={action}
            onChange={(e) => setAction(e.target.value)}
          >
            <option value="">{t(language, "auditAdmin.filterActionAll")}</option>
            {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label className="text-xs text-muted-foreground">
          {t(language, "auditAdmin.filterFrom")}
          <Input type="date" className="mt-1" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="text-xs text-muted-foreground">
          {t(language, "auditAdmin.filterTo")}
          <Input type="date" className="mt-1" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <Button onClick={apply} disabled={pending}>{t(language, "auditAdmin.apply")}</Button>
        <Button variant="outline" onClick={clear} disabled={pending}>{t(language, "auditAdmin.clear")}</Button>
      </div>

      <AuditList rows={rows} language={language} />
    </div>
  )
}
