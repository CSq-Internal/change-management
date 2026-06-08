import { describe, it, expect, vi, beforeEach } from 'vitest'

const session = {
  keycloakId: 'kc-req',
  organizations: [{ id: 'org-gh', name: 'Ghana', alias: 'ghana', roles: ['requester'] }],
  realmRoles: [],
}
vi.mock('@/lib/session', () => ({ getAppSession: vi.fn(async () => session) }))

const tx = {
  changeAssignee: { deleteMany: vi.fn(async () => ({})), create: vi.fn(async () => ({})) },
  auditLog: { create: vi.fn(async () => ({})) },
}
const mockDb = {
  user: { findUnique: vi.fn(async () => ({ id: 'user-req' })) },
  changeRequest: { findUnique: vi.fn(async () => ({ id: 'c1', requesterId: 'user-req', opcoId: 'opco-1', opco: { slug: 'ghana' }, infrastructureType: 'Wifi' })) },
  userOpCoAssignment: { findFirst: vi.fn(async () => null) },
  cABMembership: { findFirst: vi.fn(async () => null) },
  $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
}
vi.mock('@/server/db', () => ({ getPrisma: () => mockDb }))

import { setChangeAssignees } from '@/server/actions/assignees'

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.user.findUnique.mockResolvedValue({ id: 'user-req' })
  mockDb.changeRequest.findUnique.mockResolvedValue({ id: 'c1', requesterId: 'user-req', opcoId: 'opco-1', opco: { slug: 'ghana' }, infrastructureType: 'Wifi' })
  mockDb.userOpCoAssignment.findFirst.mockResolvedValue(null)
  mockDb.cABMembership.findFirst.mockResolvedValue(null)
})

describe('setChangeAssignees', () => {
  it('saves an implementer-role assignee (no eligibility check)', async () => {
    await setChangeAssignees('c1', [{ userId: 'impl1', role: 'implementer' }])
    expect(tx.changeAssignee.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'impl1', role: 'implementer' }) })
    )
  })

  it('rejects an approver-role assignee who is not an eligible approver', async () => {
    await expect(setChangeAssignees('c1', [{ userId: 'rando', role: 'approver' }]))
      .rejects.toThrow(/not an eligible approver/i)
  })

  it('accepts an approver-role assignee who holds approver authority in the OpCo', async () => {
    mockDb.userOpCoAssignment.findFirst.mockResolvedValue({ id: 'a', role: 'approver' })
    await setChangeAssignees('c1', [{ userId: 'appr1', role: 'approver' }])
    expect(tx.changeAssignee.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'appr1', role: 'approver' }) })
    )
  })
})
