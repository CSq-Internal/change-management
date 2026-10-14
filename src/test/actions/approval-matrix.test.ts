// src/test/actions/approval-matrix.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const session = {
  keycloakId: 'kc-admin',
  organizations: [{ id: 'org-gh', name: 'Ghana', alias: 'ghana', roles: ['admin'] }],
  realmRoles: [] as string[],
}
vi.mock('@/lib/session', () => ({ getAppSession: vi.fn(async () => session) }))

const tx = {
  user: { findUnique: vi.fn(async () => ({ id: 'user-admin' })) },
  adminAuditLog: { create: vi.fn(async () => ({})) },
  approverAssignment: { findFirst: vi.fn(async () => null), create: vi.fn(async () => ({ id: 'a1' })), update: vi.fn(async () => ({ id: 'a1' })) },
}
const mockDb = {
  opCo: { findUnique: vi.fn(async () => ({ id: 'opco-gh', slug: 'ghana' })) },
  user: { findUnique: vi.fn(async () => ({ id: 'target', isActive: true })) },
  userOpCoAssignment: { findFirst: vi.fn(async (): Promise<{ id: string } | null> => ({ id: 'assign-1' })) },
  $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
}
vi.mock('@/server/db', () => ({ getPrisma: () => mockDb }))

import { addApproverAssignment } from '@/server/actions/approval-matrix'

beforeEach(() => { vi.clearAllMocks(); mockDb.opCo.findUnique.mockResolvedValue({ id: 'opco-gh', slug: 'ghana' }); mockDb.user.findUnique.mockResolvedValue({ id: 'target', isActive: true }); mockDb.userOpCoAssignment.findFirst.mockResolvedValue({ id: 'assign-1' }); session.realmRoles = [] })

describe('addApproverAssignment', () => {
  it('adds an OpCo override for an OpCo admin + audits it', async () => {
    await addApproverAssignment({ infrastructureType: 'Wifi', opcoSlug: 'ghana', userId: 'target' })
    expect(tx.approverAssignment.create).toHaveBeenCalled()
    expect(tx.adminAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'approver_assignment_added' }) })
    )
  })

  it('refuses a user who is not an approver or admin in that OpCo (e.g. an auditor)', async () => {
    mockDb.userOpCoAssignment.findFirst.mockResolvedValue(null)
    await expect(addApproverAssignment({ infrastructureType: 'Wifi', opcoSlug: 'ghana', userId: 'target' }))
      .rejects.toThrow(/approver or admin in ghana/i)
    expect(mockDb.userOpCoAssignment.findFirst).toHaveBeenCalledWith({
      where: { userId: 'target', isActive: true, role: { in: ['approver', 'admin'] }, opcoId: 'opco-gh' },
    })
    expect(tx.approverAssignment.create).not.toHaveBeenCalled()
  })

  it('accepts a group-level override for an approver in any OpCo', async () => {
    session.realmRoles = ['group_admin']
    await addApproverAssignment({ infrastructureType: 'Equiano Optics', opcoSlug: null, userId: 'target' })
    expect(mockDb.userOpCoAssignment.findFirst).toHaveBeenCalledWith({
      where: { userId: 'target', isActive: true, role: { in: ['approver', 'admin'] } },
    })
    expect(tx.approverAssignment.create).toHaveBeenCalled()
  })

  it('forbids an OpCo admin adding a group-level override', async () => {
    await expect(addApproverAssignment({ infrastructureType: 'Equiano Optics', opcoSlug: null, userId: 'target' }))
      .rejects.toThrow(/Forbidden/i)
  })
})
