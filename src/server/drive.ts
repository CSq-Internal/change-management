import type { AttachmentKind } from "@prisma/client"

export const SUBFOLDER_FOR_KIND: Record<AttachmentKind, string> = {
  impact_scope: "01_Impact-and-Scope",
  implementation_plan: "02_Implementation-Plan",
  testing_plan: "03_Testing-and-Validation",
  backout_plan: "04_Backout-Plan",
  solution_document: "05_Solution-Document",
}

export function sanitizeSegment(input: string): string {
  const cleaned = input
    .replace(/[?*"<>|]/g, "")
    .replace(/[\\/:]/g, "-")
    .trim()
  return cleaned.length > 0 ? cleaned : "untitled"
}

export function changeFolderName(reference: number, title: string): string {
  const padded = String(reference).padStart(4, "0")
  return `CHG-${padded} — ${sanitizeSegment(title)}`
}
