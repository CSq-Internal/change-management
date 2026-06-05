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
