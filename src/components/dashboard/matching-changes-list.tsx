"use client"

import Link from "next/link"
import { useState } from "react"
import { t, type Language } from "@/lib/i18n"
import type { DashboardChange } from "@/lib/dashboard-metrics"

type SortKey = "title" | "opcoName" | "infrastructureType" | "riskLevel" | "status" | "plannedStart" | "createdAt"

function csvEscape(s: string) {
  return `"${s.replace(/"/g, '""')}"`
}
function toCsv(rows: DashboardChange[]): string {
  const header = ["ID", "Title", "OpCo", "Infrastructure", "Risk", "Status", "Planned", "Created"]
  const lines = rows.map((r) =>
    [r.id, r.title, r.opcoName, r.infrastructureType, r.riskLevel, r.status, r.plannedStart ?? "", r.createdAt]
      .map((v) => csvEscape(String(v))).join(","),
  )
  return [header.join(","), ...lines].join("\n")
}
function downloadCsv(rows: DashboardChange[]) {
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `changes-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

const fmtDate = (iso: string | null) => (iso ? iso.slice(0, 10) : "—")

export function MatchingChangesList({
  rows, language,
}: {
  rows: DashboardChange[]
  language: Language
}) {
  const [sortKey, setSortKey] = useState<SortKey>("createdAt")
  const [asc, setAsc] = useState(false)

  const sorted = [...rows].sort((a, b) => {
    const av = String(a[sortKey] ?? "")
    const bv = String(b[sortKey] ?? "")
    return asc ? av.localeCompare(bv) : bv.localeCompare(av)
  })
  const onSort = (k: SortKey) => {
    if (k === sortKey) setAsc(!asc)
    else { setSortKey(k); setAsc(true) }
  }

  const cols: { key: SortKey; label: string }[] = [
    { key: "title", label: t(language, "dashboard.list.col.title") },
    { key: "opcoName", label: t(language, "dashboard.list.col.opco") },
    { key: "infrastructureType", label: t(language, "dashboard.list.col.infra") },
    { key: "riskLevel", label: t(language, "dashboard.list.col.risk") },
    { key: "status", label: t(language, "dashboard.list.col.status") },
    { key: "plannedStart", label: t(language, "dashboard.list.col.planned") },
    { key: "createdAt", label: t(language, "dashboard.list.col.created") },
  ]

  return (
    <details className="mt-3.5 rounded-xl border border-border bg-card">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold">
        <span>{t(language, "dashboard.list.title")} · {rows.length}</span>
        <button
          onClick={(e) => { e.preventDefault(); downloadCsv(sorted) }}
          disabled={rows.length === 0}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
        >
          {t(language, "dashboard.list.export")}
        </button>
      </summary>
      {rows.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted-foreground">{t(language, "dashboard.list.empty")}</p>
      ) : (
        <div className="overflow-x-auto px-2 pb-2">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                {cols.map((c) => (
                  <th key={c.key} className="px-2 py-2">
                    <button onClick={() => onSort(c.key)} className="font-medium hover:text-foreground">
                      {c.label}{sortKey === c.key ? (asc ? " ▲" : " ▼") : ""}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.id} className="border-b border-border/50 hover:bg-muted/50">
                  <td className="px-2 py-2">
                    <Link href={`/changes/${r.id}`} className="text-primary hover:underline">{r.title}</Link>
                  </td>
                  <td className="px-2 py-2">{r.opcoName}</td>
                  <td className="px-2 py-2">{r.infrastructureType}</td>
                  <td className="px-2 py-2">{r.riskLevel}</td>
                  <td className="px-2 py-2">{r.status}</td>
                  <td className="px-2 py-2 tabular-nums">{fmtDate(r.plannedStart)}</td>
                  <td className="px-2 py-2 tabular-nums">{fmtDate(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  )
}
