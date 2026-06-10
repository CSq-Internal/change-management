import type { ChangeStatusName, RiskLevelName } from "@/lib/dashboard-metrics"

// Single source of truth for chart fill colors. SVG `fill`/`background` need concrete
// colors (not Tailwind classes), so the hex palette lives here and is shared by the
// chart primitives and the Monitor status tiles.
export const RISK_HEX: Record<RiskLevelName, string> = {
  low: "#10b981", medium: "#f59e0b", high: "#f97316", emergency: "#f43f5e",
}
export const STATUS_HEX: Record<ChangeStatusName, string> = {
  draft: "#a1a1aa", pending: "#f59e0b", approved: "#10b981", rejected: "#f43f5e",
  implemented: "#3b82f6", verified: "#8b5cf6", closed: "#64748b", cancelled: "#d4d4d8",
}
