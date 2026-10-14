import type { PirOutcome } from "@prisma/client"

/**
 * Whether a PIR must come from someone who neither requested nor implemented the change.
 * Routine, successful changes may be self-reviewed. High-risk, emergency, failed or
 * backed-out changes are the ones the review exists for, so they need a second pair of
 * eyes (ISO 27001 A.5.3). Without `review` it answers from the change alone, which is what
 * the page knows before the form is filled in.
 */
export function needsIndependentPir(
  change: { riskLevel: string; isEmergency: boolean },
  review?: { outcome: PirOutcome; backoutUsed: boolean },
): boolean {
  if (change.riskLevel === "high" || change.riskLevel === "emergency" || change.isEmergency) return true
  return !!review && (review.outcome !== "success" || review.backoutUsed)
}
