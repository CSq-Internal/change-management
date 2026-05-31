import { describe, it, expect } from 'vitest'
import { canApprove, canAudit, canManageUsers, isGroupAdmin } from '@/lib/permissions'
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
