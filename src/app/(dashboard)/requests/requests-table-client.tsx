"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { Plus } from "lucide-react"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import { csvRow } from "@/lib/csv"
import { Button } from "@/components/ui/button"
import { StatusPill, RiskPill } from "@/components/change-badges"
import { infraTypeOptions } from "@/lib/approver-routing"

export type RequestRow = {
  id: string
  title: string
  status: string
  riskLevel: string
  infrastructureType: string
  opcoName: string
  approvalsGiven: number
  requesterName: string
}

const STATUSES = ["draft", "pending", "approved", "implemented", "verified", "rejected", "closed"]
const RISKS = ["low", "medium", "high", "emergency"]
// Rows drawn at first; the rest wait for "Show all", so a long list stays quick to render.
const PAGE = 100

export default function RequestsTableClient({
  rows, showRequester, initialStatus = "", olderHidden = false,
}: {
  rows: RequestRow[]
  showRequester: boolean
  initialStatus?: string
  /** Finished requests older than 90 days were left out; offer to load them. */
  olderHidden?: boolean
}) {
  const { language } = useStore()
  const [status, setStatus] = useState(initialStatus)
  const [risk, setRisk] = useState("")
  const [infra, setInfra] = useState("")
  const [opco, setOpco] = useState("")
  const [showAll, setShowAll] = useState(false)

  const infraOptions = useMemo(() => infraTypeOptions(rows.map((r) => r.infrastructureType)), [rows])
  const opcoOptions = useMemo(() => [...new Set(rows.map((r) => r.opcoName))].sort(), [rows])

  const filtered = useMemo(
    () => rows.filter((r) =>
      (!status || r.status === status) &&
      (!risk || r.riskLevel === risk) &&
      (!infra || r.infrastructureType === infra) &&
      (!opco || r.opcoName === opco)
    ),
    [rows, status, risk, infra, opco]
  )

  const exportCsv = () => {
    const header = ["Title", "Status", "Risk", "Infrastructure", "OpCo", "Approvals", "Requester"]
    const lines = [header.join(",")].concat(
      filtered.map((r) =>
        csvRow([r.title, r.status, r.riskLevel, r.infrastructureType, r.opcoName, r.approvalsGiven, r.requesterName])
      )
    )
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `requests-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
  }

  const selectClass = "h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
  const newBtnClass = "inline-flex items-center justify-center rounded-md text-sm font-medium h-11 sm:h-10 px-5 sm:px-4 transition-colors touch-manipulation bg-primary text-primary-foreground hover:opacity-90"

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-semibold">{t(language, "requests.pageTitle")}</h1>
        <Link href="/requests/new" className={newBtnClass}>
          <Plus className="mr-1.5 h-4 w-4" />{t(language, "requests.new")}
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Status" className={selectClass} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t(language, "requests.filter.allStatuses")}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select aria-label="Risk" className={selectClass} value={risk} onChange={(e) => setRisk(e.target.value)}>
          <option value="">{t(language, "requests.filter.allRisks")}</option>
          {RISKS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select aria-label="Infrastructure" className={selectClass} value={infra} onChange={(e) => setInfra(e.target.value)}>
          <option value="">{t(language, "requests.filter.allInfra")}</option>
          {infraOptions.map((i) => <option key={i} value={i}>{i}</option>)}
        </select>
        <select aria-label="OpCo" className={selectClass} value={opco} onChange={(e) => setOpco(e.target.value)}>
          <option value="">{t(language, "requests.filter.allOpcos")}</option>
          {opcoOptions.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <span className="ml-auto text-xs text-muted-foreground">{filtered.length} / {rows.length}</span>
        <Button variant="outline" onClick={exportCsv}>{t(language, "requests.exportCsv")}</Button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border/70">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2">{t(language, "requests.col.title")}</th>
              <th className="px-3 py-2">{t(language, "requests.col.status")}</th>
              <th className="px-3 py-2">{t(language, "requests.col.risk")}</th>
              <th className="px-3 py-2">{t(language, "requests.col.infra")}</th>
              <th className="px-3 py-2">{t(language, "requests.col.opco")}</th>
              <th className="px-3 py-2">{t(language, "requests.col.approvals")}</th>
              {showRequester && <th className="px-3 py-2">{t(language, "requests.col.requester")}</th>}
            </tr>
          </thead>
          <tbody>
            {(showAll ? filtered : filtered.slice(0, PAGE)).map((r) => (
              <tr key={r.id} className="border-t border-border/50 hover:bg-muted/40">
                <td className="px-3 py-2">
                  <Link href={`/changes/${r.id}`} className="text-primary hover:underline">{r.title}</Link>
                </td>
                <td className="px-3 py-2"><StatusPill status={r.status} /></td>
                <td className="px-3 py-2"><RiskPill risk={r.riskLevel} /></td>
                <td className="px-3 py-2">{r.infrastructureType}</td>
                <td className="px-3 py-2">{r.opcoName}</td>
                <td className="px-3 py-2 tabular-nums">{r.approvalsGiven > 0 ? `${r.approvalsGiven} ✓` : "—"}</td>
                {showRequester && <td className="px-3 py-2">{r.requesterName}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t(language, "requests.none")}</p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {!showAll && filtered.length > PAGE && (
          <Button variant="outline" onClick={() => setShowAll(true)}>
            {t(language, "requests.showAll")} ({filtered.length})
          </Button>
        )}
        {olderHidden && (
          <Link href="/requests?all=1" className="text-primary hover:underline">{t(language, "requests.showOlder")}</Link>
        )}
      </div>
    </div>
  )
}
