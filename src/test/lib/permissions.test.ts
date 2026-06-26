import { describe, it, expect } from 'vitest'
import { canApprove, canAudit, canManageUsers, isGroupAdmin, canManageAnyOpCo, manageableOpCoSlugs, canAssignRole, canManageTeams, canManageCab, hasAnyAccess } from '@/lib/permissions'
import { viewerTier, requestScopedSlugs, shouldRedirectToRequestAccess } from '@/lib/permissions'
import type { SessionOrganization } from '@/types/next-auth'

const ghanaApprover: SessionOrganization = { id: 'org-1', name: 'Ghana', alias: 'ghana', roles: ['approver'] }
const ugandaAuditor: SessionOrganization = { id: 'org-2', name: 'Uganda', alias: 'uganda', roles: ['auditor'] }

describe('canApprove', () => {
  it('returns true for approver in matching opco', () => {
    expect(canApprove([ghanaApprover], 'ghana')).toBe(true)
  })
  it('returns false for approver in different opco', () => {
    expect(canApprove([ghanaApprover], 'uganda')).toBe(false)
  })
})

describe('canAudit', () => {
  it('auditor can audit their opco', () => {
    expect(canAudit([ugandaAuditor], [], 'uganda')).toBe(true)
  })
  it('auditor cannot audit a different opco', () => {
    expect(canAudit([ugandaAuditor], [], 'ghana')).toBe(false)
  })
  it('group_auditor can audit any opco', () => {
    expect(canAudit([], ['group_auditor'], 'ghana')).toBe(true)
    expect(canAudit([], ['group_auditor'], 'mauritius')).toBe(true)
  })
})

describe('canManageUsers', () => {
  it('opco admin can manage users in their opco only', () => {
    const admin: SessionOrganization = { id: 'org-1', name: 'Ghana', alias: 'ghana', roles: ['admin'] }
    expect(canManageUsers([admin], [], 'ghana')).toBe(true)
    expect(canManageUsers([admin], [], 'uganda')).toBe(false)
  })
  it('group_admin can manage users in any opco', () => {
    expect(canManageUsers([], ['group_admin'], 'ghana')).toBe(true)
    expect(canManageUsers([], ['group_admin'], 'mauritius')).toBe(true)
  })
})

describe('isGroupAdmin', () => {
  it('returns true when group_admin present', () => {
    expect(isGroupAdmin(['group_admin'])).toBe(true)
  })
  it('returns false without group_admin', () => {
    expect(isGroupAdmin(['approver'])).toBe(false)
  })
})

describe('canManageAnyOpCo', () => {
  it('true when admin in any opco (even a non-first one)', () => {
    const orgs: SessionOrganization[] = [
      { id: 'o1', name: 'Ghana', alias: 'ghana', roles: ['requester'] },
      { id: 'o2', name: 'Uganda', alias: 'uganda', roles: ['admin'] },
    ]
    expect(canManageAnyOpCo(orgs, [])).toBe(true)
  })
  it('false when no admin role anywhere', () => {
    const orgs: SessionOrganization[] = [{ id: 'o1', name: 'Ghana', alias: 'ghana', roles: ['requester'] }]
    expect(canManageAnyOpCo(orgs, [])).toBe(false)
  })
  it('true for group_admin with no orgs', () => {
    expect(canManageAnyOpCo([], ['group_admin'])).toBe(true)
  })
})

describe('manageableOpCoSlugs', () => {
  it('returns "all" for group_admin', () => {
    expect(manageableOpCoSlugs([], ['group_admin'])).toBe('all')
  })
  it('returns only admin opco slugs for an opco admin', () => {
    const orgs: SessionOrganization[] = [
      { id: 'o1', name: 'Ghana', alias: 'ghana', roles: ['admin'] },
      { id: 'o2', name: 'Uganda', alias: 'uganda', roles: ['requester'] },
    ]
    expect(manageableOpCoSlugs(orgs, [])).toEqual(['ghana'])
  })
})

describe("canAssignRole", () => {
  const ghanaAdminOrgs = [{ id: "o", name: "Ghana", alias: "ghana", roles: ["admin"] }]

  it("lets a group_admin assign the admin role in any OpCo", () => {
    expect(canAssignRole([], ["group_admin"], "ghana", "admin")).toBe(true)
  })

  it("lets an OpCo admin assign requester/approver/auditor in their OpCo", () => {
    expect(canAssignRole(ghanaAdminOrgs, [], "ghana", "requester")).toBe(true)
    expect(canAssignRole(ghanaAdminOrgs, [], "ghana", "approver")).toBe(true)
    expect(canAssignRole(ghanaAdminOrgs, [], "ghana", "auditor")).toBe(true)
  })

  it("forbids an OpCo admin from minting the admin role", () => {
    expect(canAssignRole(ghanaAdminOrgs, [], "ghana", "admin")).toBe(false)
  })

  it("forbids an OpCo admin assigning in an OpCo they don't manage", () => {
    expect(canAssignRole(ghanaAdminOrgs, [], "uganda", "requester")).toBe(false)
  })

  it("never allows assigning realm roles in-app, even for group_admin", () => {
    expect(canAssignRole([], ["group_admin"], "ghana", "group_admin")).toBe(false)
    expect(canAssignRole([], ["group_admin"], "ghana", "group_auditor")).toBe(false)
  })
})

describe("canManageTeams", () => {
  const ghanaAdminOrgs = [{ id: "o", name: "Ghana", alias: "ghana", roles: ["admin"] }]
  const ghanaRequesterOrgs = [{ id: "o", name: "Ghana", alias: "ghana", roles: ["requester"] }]

  it("allows a group_admin to manage teams in any OpCo", () => {
    expect(canManageTeams([], ["group_admin"], "ghana")).toBe(true)
  })

  it("allows an OpCo admin to manage teams in their OpCo", () => {
    expect(canManageTeams(ghanaAdminOrgs, [], "ghana")).toBe(true)
  })

  it("forbids an OpCo admin in an OpCo they don't administer", () => {
    expect(canManageTeams(ghanaAdminOrgs, [], "uganda")).toBe(false)
  })

  it("forbids a non-admin OpCo member", () => {
    expect(canManageTeams(ghanaRequesterOrgs, [], "ghana")).toBe(false)
  })
})

describe("canManageCab", () => {
  const ghanaAdminOrgs = [{ id: "o", name: "Ghana", alias: "ghana", roles: ["admin"] }]
  const ghanaApproverOrgs = [{ id: "o", name: "Ghana", alias: "ghana", roles: ["approver"] }]

  it("allows a group_admin to manage any OpCo's CAB", () => {
    expect(canManageCab([], ["group_admin"], "ghana")).toBe(true)
  })

  it("allows an OpCo admin to manage their OpCo's CAB", () => {
    expect(canManageCab(ghanaAdminOrgs, [], "ghana")).toBe(true)
  })

  it("forbids an OpCo admin in an OpCo they don't administer", () => {
    expect(canManageCab(ghanaAdminOrgs, [], "uganda")).toBe(false)
  })

  it("forbids a mere approver (eligibility is not management)", () => {
    expect(canManageCab(ghanaApproverOrgs, [], "ghana")).toBe(false)
  })
})

describe('viewerTier', () => {
  const memberOrg = { id: 'o1', name: 'Ghana', alias: 'ghana', roles: ['requester'] }
  const approverOrg = { id: 'o1', name: 'Ghana', alias: 'ghana', roles: ['approver'] }
  const adminOrg = { id: 'o2', name: 'Uganda', alias: 'uganda', roles: ['admin'] }

  it('group_admin → group', () => {
    expect(viewerTier([memberOrg], ['group_admin'])).toBe('group')
  })
  it('group_auditor → group', () => {
    expect(viewerTier([], ['group_auditor'])).toBe('group')
  })
  it('opco admin → opco', () => {
    expect(viewerTier([adminOrg], [])).toBe('opco')
  })
  it('opco approver → opco', () => {
    expect(viewerTier([approverOrg], [])).toBe('opco')
  })
  it('only requester role → member', () => {
    expect(viewerTier([memberOrg], [])).toBe('member')
  })
  it('no orgs, no realm roles → member', () => {
    expect(viewerTier([], [])).toBe('member')
  })
})

describe("hasAnyAccess", () => {
  it("is false for a user with no roles and no assignments", () => {
    expect(hasAnyAccess([], [])).toBe(false)
  })
  it("is true for a group-level user with no OpCo assignments", () => {
    expect(hasAnyAccess([], ["group_auditor"])).toBe(true)
  })
  it("is true for a user with at least one OpCo assignment", () => {
    expect(hasAnyAccess([{ id: "o", name: "Ghana", alias: "ghana", roles: ["requester"] }], [])).toBe(true)
  })
})

describe('shouldRedirectToRequestAccess', () => {
  const noAccess = { organizations: [], realmRoles: [] }
  const groupAccess = { organizations: [], realmRoles: ['group_admin'] }
  const opcoAccess = { organizations: [ghanaApprover], realmRoles: [] }

  it('does not redirect when there is no token (unauthenticated)', () => {
    expect(shouldRedirectToRequestAccess('/approvals', null)).toBe(false)
  })
  it('redirects an authenticated no-access user on a protected route', () => {
    expect(shouldRedirectToRequestAccess('/approvals', noAccess)).toBe(true)
    expect(shouldRedirectToRequestAccess('/calendar', noAccess)).toBe(true)
    expect(shouldRedirectToRequestAccess('/', noAccess)).toBe(true)
  })
  it('does not redirect a user with a group role', () => {
    expect(shouldRedirectToRequestAccess('/approvals', groupAccess)).toBe(false)
  })
  it('does not redirect a user with an OpCo assignment', () => {
    expect(shouldRedirectToRequestAccess('/approvals', opcoAccess)).toBe(false)
  })
  it('never redirects exempt routes even with no access', () => {
    for (const p of ['/login', '/request-access', '/api/auth', '/api/auth/callback/keycloak']) {
      expect(shouldRedirectToRequestAccess(p, noAccess)).toBe(false)
    }
  })
})

describe('requestScopedSlugs', () => {
  it('returns slugs where the user is admin or approver, deduped', () => {
    const orgs = [
      { id: 'o1', name: 'Ghana', alias: 'ghana', roles: ['approver'] },
      { id: 'o2', name: 'Uganda', alias: 'uganda', roles: ['admin'] },
      { id: 'o3', name: 'Togo', alias: 'togo', roles: ['requester'] },
    ]
    expect(requestScopedSlugs(orgs).sort()).toEqual(['ghana', 'uganda'])
  })
  it('returns [] when the user holds neither role anywhere', () => {
    expect(requestScopedSlugs([{ id: 'o1', name: 'Ghana', alias: 'ghana', roles: ['requester'] }])).toEqual([])
  })
})
