// src/lib/sla-report.ts
// Pure SLA-adherence calc — no DB. Unit-tested in src/test/lib/sla-report.test.ts.

export type SlaReportRow = {
  opcoSlug: string
  opcoName: string
  riskLevel: string
  slaDeadline: number | null // epoch ms
  decidedAt: number | null   // epoch ms of first approve/reject decision, or null if undecided
}

export type SlaReportCell = {
  opcoSlug: string
  opcoName: string
  riskLevel: string
  decided: number
  inSla: number
  adherencePct: number | null
}

/**
 * Per-OpCo × risk SLA adherence.
 *  - Decided row → counts; in-SLA iff decidedAt <= slaDeadline (or no deadline set).
 *  - Pending row past deadline → counts as a breach.
 *  - Pending row within deadline → excluded (not yet decided).
 */
export function computeSlaReport(rows: SlaReportRow[], nowMs: number): SlaReportCell[] {
  const groups = new Map<string, SlaReportCell>()

  for (const r of rows) {
    const isDecided = r.decidedAt != null
    const isPendingOverdue = !isDecided && r.slaDeadline != null && nowMs > r.slaDeadline
    if (!isDecided && !isPendingOverdue) continue

    const key = `${r.opcoSlug}::${r.riskLevel}`
    let cell = groups.get(key)
    if (!cell) {
      cell = { opcoSlug: r.opcoSlug, opcoName: r.opcoName, riskLevel: r.riskLevel, decided: 0, inSla: 0, adherencePct: null }
      groups.set(key, cell)
    }

    cell.decided += 1
    const inSla = isDecided && (r.slaDeadline == null || r.decidedAt! <= r.slaDeadline)
    if (inSla) cell.inSla += 1
  }

  for (const cell of groups.values()) {
    cell.adherencePct = cell.decided === 0 ? null : Math.round((cell.inSla / cell.decided) * 100)
  }

  return [...groups.values()]
}
