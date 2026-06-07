// src/test/lib/sla-report.test.ts
import { describe, it, expect } from 'vitest'
import { computeSlaReport, type SlaReportRow } from '@/lib/sla-report'

const now = 2_000_000_000_000
const gh = { opcoSlug: 'ghana', opcoName: 'Ghana' }

describe('computeSlaReport', () => {
  it('counts a change decided before its deadline as in-SLA', () => {
    const rows: SlaReportRow[] = [
      { ...gh, riskLevel: 'high', slaDeadline: now, decidedAt: now - 10 },
    ]
    const cells = computeSlaReport(rows, now)
    expect(cells).toHaveLength(1)
    expect(cells[0]).toMatchObject({ riskLevel: 'high', decided: 1, inSla: 1, adherencePct: 100 })
  })

  it('counts a change decided after its deadline as a breach', () => {
    const rows: SlaReportRow[] = [
      { ...gh, riskLevel: 'high', slaDeadline: now - 100, decidedAt: now },
    ]
    const cells = computeSlaReport(rows, now)
    expect(cells[0]).toMatchObject({ decided: 1, inSla: 0, adherencePct: 0 })
  })

  it('counts a still-pending change past its deadline as a breach', () => {
    const rows: SlaReportRow[] = [
      { ...gh, riskLevel: 'high', slaDeadline: now - 100, decidedAt: null },
    ]
    const cells = computeSlaReport(rows, now)
    expect(cells[0]).toMatchObject({ decided: 1, inSla: 0, adherencePct: 0 })
  })

  it('excludes a still-pending change within its deadline', () => {
    const rows: SlaReportRow[] = [
      { ...gh, riskLevel: 'high', slaDeadline: now + 100, decidedAt: null },
    ]
    const cells = computeSlaReport(rows, now)
    expect(cells).toHaveLength(0)
  })

  it('groups by opco × risk and computes adherence percentage', () => {
    const rows: SlaReportRow[] = [
      { ...gh, riskLevel: 'low', slaDeadline: now, decidedAt: now - 1 },
      { ...gh, riskLevel: 'low', slaDeadline: now - 1, decidedAt: now },
      { opcoSlug: 'kenya', opcoName: 'Kenya', riskLevel: 'low', slaDeadline: now, decidedAt: now - 1 },
    ]
    const cells = computeSlaReport(rows, now)
    const ghLow = cells.find((c) => c.opcoSlug === 'ghana' && c.riskLevel === 'low')
    expect(ghLow).toMatchObject({ decided: 2, inSla: 1, adherencePct: 50 })
    expect(cells.find((c) => c.opcoSlug === 'kenya')).toMatchObject({ decided: 1, inSla: 1 })
  })
})
