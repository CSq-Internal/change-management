import type { AttachmentKind } from "@prisma/client"

// Single source of truth for the five required change-request documents, in display order.
// Client-safe: only a type is imported from @prisma/client (erased at runtime), so this
// can be imported from both server modules and the client form without pulling in server code.
export const REQUIRED_DOC_KINDS: AttachmentKind[] = [
  "impact_scope",
  "implementation_plan",
  "testing_plan",
  "backout_plan",
  "solution_document",
]

// The required documents are only mandatory for high-risk changes and above
// (high, emergency). Low/medium-risk changes may be submitted without them.
export function documentsRequiredForRisk(riskLevel: string): boolean {
  return riskLevel === "high" || riskLevel === "emergency"
}
