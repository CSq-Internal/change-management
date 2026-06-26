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

/** True if the user has any standing access — a group-level role or ≥1 OpCo assignment. */
export function hasAnyAccess(
  organizations: SessionOrganization[],
  realmRoles: string[]
): boolean {
  return isGroupLevel(realmRoles) || organizations.length > 0
}

const ACCESS_GATE_EXEMPT = ["/login", "/request-access", "/api/auth"]

/**
 * Middleware gate decision: should this request be redirected to /request-access?
 * True only for an authenticated session that has no standing access and is on a
 * non-exempt route. Unauthenticated (null token) requests are left to the normal
 * login flow. Pure + edge-safe so it can run in middleware and be unit-tested.
 */
export function shouldRedirectToRequestAccess(
  pathname: string,
  token: { organizations?: SessionOrganization[]; realmRoles?: string[] } | null
): boolean {
  if (!token) return false
  if (ACCESS_GATE_EXEMPT.some((p) => pathname === p || pathname.startsWith(p + "/"))) return false
  return !hasAnyAccess(token.organizations ?? [], token.realmRoles ?? [])
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

export function canManageTeams(
  organizations: SessionOrganization[],
  realmRoles: string[],
  opcoSlug: string
): boolean {
  return isGroupAdmin(realmRoles) || hasRoleInOpCo(organizations, opcoSlug, "admin")
}

export function canManageCab(
  organizations: SessionOrganization[],
  realmRoles: string[],
  opcoSlug: string
): boolean {
  return isGroupAdmin(realmRoles) || hasRoleInOpCo(organizations, opcoSlug, "admin")
}

/** OpCo slugs where the user holds an `admin` or `approver` role (deduped). */
export function requestScopedSlugs(organizations: SessionOrganization[]): string[] {
  const slugs = organizations
    .filter((o) => o.roles.includes("admin") || o.roles.includes("approver"))
    .map((o) => o.alias)
  return [...new Set(slugs)]
}

/**
 * Visibility tier for change-request data:
 * - "group"  → group-level (sees all OpCos)
 * - "opco"   → admin/approver in ≥1 OpCo (sees those OpCos)
 * - "member" → everyone else (sees only their own requests)
 */
export function viewerTier(
  organizations: SessionOrganization[],
  realmRoles: string[]
): "group" | "opco" | "member" {
  if (isGroupLevel(realmRoles)) return "group"
  if (requestScopedSlugs(organizations).length > 0) return "opco"
  return "member"
}
