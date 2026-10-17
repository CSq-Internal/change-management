// Approval routing by infrastructure type (client-safe — no server imports).
//
// Equiano infra (Optics, IP) is group-level → approved by the Group CTO alone.
// All other infra types are per-OpCo → approved by the resident OpCo approver(s),
// with the Group CTO as a secondee (also notified, can also approve).

export const EQUIANO_INFRA_TYPES = ["Equiano Optics", "Equiano IP"] as const

/** Every infrastructure type a change can target, Equiano (group-level) first. */
export const INFRA_TYPES = [
  ...EQUIANO_INFRA_TYPES,
  "Backbone Transport Network",
  "Metro Transport Network",
  "Wifi",
  "Internal IT Infrastructure",
  "Backbone IP Network",
  "Power",
] as const

/** Filter options: every infra type, then any older stored value no longer on the list. */
export function infraTypeOptions(present: string[]): string[] {
  return [...new Set<string>([...INFRA_TYPES, ...present])]
}

export function isGroupLevelInfra(infraType: string): boolean {
  return (EQUIANO_INFRA_TYPES as readonly string[]).includes(infraType)
}

/**
 * The CAB a change routes to: the group CAB (null) for Equiano (group-level) infra,
 * otherwise the change's own OpCo CAB.
 */
export function routedCabOpcoId(infraType: string, changeOpcoId: string): string | null {
  return isGroupLevelInfra(infraType) ? null : changeOpcoId
}
