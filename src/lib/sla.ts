// src/lib/sla.ts
// Pure SLA math — no DB, no I/O. Unit-tested in src/test/lib/sla.test.ts.
import type { RiskLevel } from "@prisma/client"

/** SLA window (hours) per risk level. Single source of truth, shared with submitChange. */
export const SLA_HOURS: Record<RiskLevel, number> = { low: 48, medium: 24, high: 4, emergency: 1 }

/**
 * Escalation level a pending change is *due* for, given its SLA deadline.
 *  - 0: not breached            (now < deadline)
 *  - 1: breached                (deadline <= now < deadline + 50% of the window)
 *  - 2: well past deadline      (now >= deadline + 50% of the window)
 */
export function dueEscalationLevel(
  slaDeadlineMs: number,
  slaWindowHours: number,
  nowMs: number
): 0 | 1 | 2 {
  if (nowMs < slaDeadlineMs) return 0
  const halfWindowMs = (slaWindowHours / 2) * 3_600_000
  if (nowMs < slaDeadlineMs + halfWindowMs) return 1
  return 2
}
