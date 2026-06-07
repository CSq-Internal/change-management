// src/lib/risk-score.ts
// Pure risk scoring — no DB. Unit-tested in src/test/lib/risk-score.test.ts.

export type RiskBand = "low" | "medium" | "high" | "critical"

const clamp = (n: number) => Math.max(1, Math.min(5, Math.round(n)))

export function riskScore(likelihood: number, impact: number): number {
  return clamp(likelihood) * clamp(impact)
}

export function riskBand(score: number): RiskBand {
  if (score <= 4) return "low"
  if (score <= 9) return "medium"
  if (score <= 15) return "high"
  return "critical"
}
