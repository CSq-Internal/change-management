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

export function canManageAnyOpCo(
  organizations: SessionOrganization[],
  realmRoles: string[]
): boolean {
  return isGroupAdmin(realmRoles) || organizations.some((o) => o.roles.includes("admin"))
}

export function manageableOpCoSlugs(
  organizations: SessionOrganization[],
  realmRoles: string[]
): string[] | "all" {
  if (isGroupAdmin(realmRoles)) return "all"
  return organizations.filter((o) => o.roles.includes("admin")).map((o) => o.alias)
}

const REALM_ROLES = ["group_admin", "group_auditor"]

export function canAssignRole(
  organizations: SessionOrganization[],
  realmRoles: string[],
  opcoSlug: string,
  role: string
): boolean {
  if (REALM_ROLES.includes(role)) return false // realm roles are Keycloak-only
  if (isGroupAdmin(realmRoles)) return true // group_admin assigns any OpCo role
  if (role === "admin") return false // OpCo admins cannot mint admins
  return hasRoleInOpCo(organizations, opcoSlug, "admin")
}
