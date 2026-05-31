import type { SessionOrganization } from "@/types/next-auth"

export function hasRoleInOpCo(
  organizations: SessionOrganization[],
  opcoAlias: string,
  role: string
): boolean {
  return organizations.some((o) => o.alias === opcoAlias && o.roles.includes(role))
}

export function canApprove(organizations: SessionOrganization[], opcoAlias: string): boolean {
  return (
    hasRoleInOpCo(organizations, opcoAlias, "approver") ||
    hasRoleInOpCo(organizations, opcoAlias, "admin")
  )
}

export function canAudit(
  organizations: SessionOrganization[],
  realmRoles: string[],
  opcoAlias: string
): boolean {
  return (
    realmRoles.includes("group_auditor") ||
    realmRoles.includes("group_admin") ||
    hasRoleInOpCo(organizations, opcoAlias, "auditor") ||
    hasRoleInOpCo(organizations, opcoAlias, "admin")
  )
}

export function canManageUsers(
  organizations: SessionOrganization[],
  realmRoles: string[],
  opcoAlias: string
): boolean {
  return (
    realmRoles.includes("group_admin") ||
    hasRoleInOpCo(organizations, opcoAlias, "admin")
  )
}

export function isGroupAdmin(realmRoles: string[]): boolean {
  return realmRoles.includes("group_admin")
}

export function isGroupLevel(realmRoles: string[]): boolean {
  return realmRoles.includes("group_admin") || realmRoles.includes("group_auditor")
}

export function isMemberOfOpCo(organizations: SessionOrganization[], slug: string): boolean {
  return organizations.some((o) => o.alias === slug)
}

export function getUserOpCos(organizations: SessionOrganization[]): string[] {
  return organizations.map((o) => o.alias)
}
