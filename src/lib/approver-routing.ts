// Approval routing by infrastructure type (client-safe — no server imports).
//
// Equiano infra (Optics, IP) is group-level → approved by the Group CTO alone.
// All other infra types are per-OpCo → approved by the resident OpCo approver(s),
// with the Group CTO as a secondee (also notified, can also approve).

export const EQUIANO_INFRA_TYPES = ["Equiano Optics", "Equiano IP"] as const

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
