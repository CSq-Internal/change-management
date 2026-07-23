import { describe, it, expect, vi, beforeEach } from 'vitest'

const session = {
  keycloakId: 'kc-req',
  organizations: [{ id: 'org-gh', name: 'Ghana', alias: 'ghana', roles: ['requester'] }],
  realmRoles: [],
}
vi.mock('@/lib/session', () => ({ getAppSession: vi.fn(async () => session) }))

const tx = {
  changeAssignee: {
    deleteMany: vi.fn(async () => ({})),
    create: vi.fn(async () => ({})),
  },
  auditLog: { create: vi.fn(async () => ({})) },
}
const CHANGE = {
  id: 'c1', status: 'draft', requesterId: 'user-req', opcoId: 'opco-1',
  opco: { slug: 'ghana' }, infrastructureType: 'Wifi',
}
const mockDb = {
  user: { findUnique: vi.fn(async () => ({ id: 'user-req' })) },
  changeRequest: { findUnique: vi.fn(async () => CHANGE) },
  userOpCoAssignment: { findFirst: vi.fn() },
  cABMembership: { findFirst: vi.fn() },
  $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
}
vi.mock('@/server/db', () => ({ getPrisma: () => mockDb }))

vi.mock('@/server/approval-authority', () => ({
  isEligibleApprover: vi.fn(async () => false),
}))

import { setChangeAssignees, setChangeApprovers } from '@/server/actions/assignees'
import { isEligibleApprover } from '@/server/approval-authority'

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.user.findUnique.mockResolvedValue({ id: 'user-req' })
  mockDb.changeRequest.findUnique.mockResolvedValue(CHANGE)
  mockDb.userOpCoAssignment.findFirst.mockResolvedValue(null)
  mockDb.cABMembership.findFirst.mockResolvedValue(null)
  vi.mocked(isEligibleApprover).mockResolvedValue(false)
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
    vi.mocked(isEligibleApprover).mockResolvedValue(true)
    await setChangeAssignees('c1', [{ userId: 'appr1', role: 'approver' }])
    expect(tx.changeAssignee.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'appr1', role: 'approver' }) })
    )
  })
})

describe('setChangeAssignees — eligibility delegation', () => {
  it('calls the shared rule with the change opcoId and infrastructureType', async () => {
    vi.mocked(isEligibleApprover).mockResolvedValue(true)
    await setChangeAssignees('c1', [{ userId: 'appr1', role: 'approver' }])
    expect(isEligibleApprover).toHaveBeenCalledWith('appr1', 'opco-1', 'Wifi')
  })

  it('rejects an OpCo approver on an Equiano change (regression: routing leak)', async () => {
    mockDb.changeRequest.findUnique.mockResolvedValue({ ...CHANGE, infrastructureType: 'Equiano IP' })
    vi.mocked(isEligibleApprover).mockResolvedValue(false)
    await expect(setChangeAssignees('c1', [{ userId: 'appr1', role: 'approver' }]))
      .rejects.toThrow(/not an eligible approver/i)
  })
})

describe('setChangeAssignees — last-approver guard', () => {
  it('rejects removing the last approver when the change is pending', async () => {
    mockDb.changeRequest.findUnique.mockResolvedValue({ ...CHANGE, status: 'pending' })
    await expect(setChangeAssignees('c1', [{ userId: 'impl1', role: 'implementer' }]))
      .rejects.toThrow(/at least one named approver/i)
  })

  it('allows removing the last approver while the change is still a draft', async () => {
    mockDb.changeRequest.findUnique.mockResolvedValue({ ...CHANGE, status: 'draft' })
    await setChangeAssignees('c1', [{ userId: 'impl1', role: 'implementer' }])
    expect(tx.changeAssignee.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'impl1' }) })
    )
  })

  it('allows a pending change to keep an approver while changing implementers', async () => {
    mockDb.changeRequest.findUnique.mockResolvedValue({ ...CHANGE, status: 'pending' })
    vi.mocked(isEligibleApprover).mockResolvedValue(true)
    await setChangeAssignees('c1', [
      { userId: 'appr1', role: 'approver' },
      { userId: 'impl2', role: 'implementer' },
    ])
    expect(tx.changeAssignee.create).toHaveBeenCalledTimes(2)
  })
})

describe('setChangeApprovers', () => {
  it('deletes only approver rows, leaving implementers intact', async () => {
    vi.mocked(isEligibleApprover).mockResolvedValue(true)
    await setChangeApprovers('c1', ['appr1'])
    expect(tx.changeAssignee.deleteMany).toHaveBeenCalledWith({
      where: { changeId: 'c1', role: 'approver' },
    })
  })

  it('creates an approver row per id', async () => {
    vi.mocked(isEligibleApprover).mockResolvedValue(true)
    await setChangeApprovers('c1', ['appr1', 'appr2'])
    expect(tx.changeAssignee.create).toHaveBeenCalledTimes(2)
    expect(tx.changeAssignee.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { changeId: 'c1', userId: 'appr1', role: 'approver' } })
    )
  })

  it('rejects an ineligible approver id', async () => {
    vi.mocked(isEligibleApprover).mockResolvedValue(false)
    await expect(setChangeApprovers('c1', ['rando']))
      .rejects.toThrow(/not an eligible approver/i)
  })

  it('rejects clearing every approver on a pending change', async () => {
    mockDb.changeRequest.findUnique.mockResolvedValue({ ...CHANGE, status: 'pending' })
    await expect(setChangeApprovers('c1', []))
      .rejects.toThrow(/at least one named approver/i)
  })
})
