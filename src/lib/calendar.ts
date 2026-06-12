// src/lib/calendar.ts
// Pure calendar conflict detection — no DB. Unit-tested in src/test/lib/calendar.test.ts.

export type RiskLevel = "low" | "medium" | "high" | "emergency"

export type CalChange = {
  id: string
  opcoId: string
  infrastructureType: string
  riskLevel: RiskLevel
  isEmergency: boolean
  start: number
  end: number
}

export type CalBlackout = {
  id: string
  opcoId: string | null
  label: string
  start: number
  end: number
}

export type ChangeConflicts = {
  overlap: boolean
  blackout: boolean
  blackoutLabels: string[]
  overlapWith: string[]
  severity: RiskLevel | null
}

const RISK_ORDER: RiskLevel[] = ["low", "medium", "high", "emergency"]

/** Half-open intersection: touching edges do NOT count as a conflict. */
export function windowsIntersect(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd
}

function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RISK_ORDER.indexOf(a) >= RISK_ORDER.indexOf(b) ? a : b
}

export function computeConflicts(changes: CalChange[], blackouts: CalBlackout[]): Map<string, ChangeConflicts> {
  const result = new Map<string, ChangeConflicts>()

  for (const c of changes) {
    const peers = changes.filter(
      (o) =>
        o.id !== c.id &&
        o.opcoId === c.opcoId &&
        o.infrastructureType === c.infrastructureType &&
        windowsIntersect(c.start, c.end, o.start, o.end)
    )
    const overlap = peers.length > 0
    const severity = overlap
      ? peers.reduce<RiskLevel>((acc, p) => maxRisk(acc, p.riskLevel), c.riskLevel)
      : null

    const hitBlackouts = blackouts.filter(
      (b) =>
        (b.opcoId === c.opcoId || b.opcoId === null) &&
        windowsIntersect(c.start, c.end, b.start, b.end)
    )

    result.set(c.id, {
      overlap,
      blackout: hitBlackouts.length > 0,
      blackoutLabels: hitBlackouts.map((b) => b.label),
      overlapWith: peers.map((p) => p.id),
      severity,
    })
  }

  return result
}
