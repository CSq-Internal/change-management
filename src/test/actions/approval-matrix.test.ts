// src/test/actions/approval-matrix.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const session = {
  keycloakId: 'kc-admin',
  organizations: [{ id: 'org-gh', name: 'Ghana', alias: 'ghana', roles: ['admin'] }],
  realmRoles: [],
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
  $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
}
vi.mock('@/server/db', () => ({ getPrisma: () => mockDb }))

import { addApproverAssignment } from '@/server/actions/approval-matrix'

beforeEach(() => { vi.clearAllMocks(); mockDb.opCo.findUnique.mockResolvedValue({ id: 'opco-gh', slug: 'ghana' }); mockDb.user.findUnique.mockResolvedValue({ id: 'target', isActive: true }) })

describe('addApproverAssignment', () => {
  it('adds an OpCo override for an OpCo admin + audits it', async () => {
    await addApproverAssignment({ infrastructureType: 'Wifi', opcoSlug: 'ghana', userId: 'target' })
    expect(tx.approverAssignment.create).toHaveBeenCalled()
    expect(tx.adminAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'approver_assignment_added' }) })
    )
  })

  it('forbids an OpCo admin adding a group-level override', async () => {
    await expect(addApproverAssignment({ infrastructureType: 'Equiano Optics', opcoSlug: null, userId: 'target' }))
      .rejects.toThrow(/Forbidden/i)
  })
})
