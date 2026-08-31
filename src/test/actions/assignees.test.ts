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
  user: {
    findUnique: vi.fn(async () => ({ id: 'user-req' })),
    // Resolves display names for the assignee-diff notifications.
    findMany: vi.fn(async () => [] as { id: string; name: string | null; email: string }[]),
  },
  changeRequest: { findUnique: vi.fn(async () => CHANGE) },
  userOpCoAssignment: { findFirst: vi.fn() },
  // Read outside the transaction to diff the previous assignee set for notifications.
  changeAssignee: { findMany: vi.fn(async () => [] as { userId: string; role: string }[]) },
  cABMembership: { findFirst: vi.fn() },
  $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
}
vi.mock('@/server/db', () => ({ getPrisma: () => mockDb }))
vi.mock('@/server/notify', () => ({
  notifyEvent: vi.fn().mockResolvedValue(undefined),
  notifyChange: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/server/approval-authority', () => ({
  isEligibleApprover: vi.fn(async () => false),
}))

import { setChangeAssignees, setChangeApprovers } from '@/server/actions/assignees'
import { isEligibleApprover } from '@/server/approval-authority'
import { notifyChange } from '@/server/notify'

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.user.findUnique.mockResolvedValue({ id: 'user-req' })
  mockDb.changeRequest.findUnique.mockResolvedValue(CHANGE)
  mockDb.userOpCoAssignment.findFirst.mockResolvedValue(null)
  mockDb.cABMembership.findFirst.mockResolvedValue(null)
  mockDb.changeAssignee.findMany.mockResolvedValue([])
  mockDb.user.findMany.mockResolvedValue([])
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

  it('propagates an eligibility rejection from the shared rule', async () => {
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

describe('self-nomination guard', () => {
  // submitApproval rejects self-approval (SoD), so a requester who names only themselves
  // would clear the mandatory-approver gate with nobody able to approve.
  it('setChangeApprovers rejects the requester as their own approver', async () => {
    vi.mocked(isEligibleApprover).mockResolvedValue(true)
    await expect(setChangeApprovers('c1', ['user-req']))
      .rejects.toThrow(/yourself as an approver/i)
    expect(tx.changeAssignee.create).not.toHaveBeenCalled()
  })

  it('setChangeAssignees rejects the requester in an approver-role assignee', async () => {
    vi.mocked(isEligibleApprover).mockResolvedValue(true)
    await expect(setChangeAssignees('c1', [{ userId: 'user-req', role: 'approver' }]))
      .rejects.toThrow(/yourself as an approver/i)
  })

  it('still allows the requester to be named as an implementer', async () => {
    await setChangeAssignees('c1', [{ userId: 'user-req', role: 'implementer' }])
    expect(tx.changeAssignee.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'user-req', role: 'implementer' }) })
    )
  })
})

describe('assignee diff notifications', () => {
  it('notifies a newly named approver', async () => {
    vi.mocked(isEligibleApprover).mockResolvedValue(true)
    mockDb.changeAssignee.findMany.mockResolvedValue([])
    mockDb.user.findMany.mockResolvedValue([{ id: 'appr1', name: 'Ada', email: 'ada@c.com' }])
    await setChangeApprovers('c1', ['appr1'])
    expect(notifyChange).toHaveBeenCalledWith('assignee_added', 'c1', expect.objectContaining({
      recipients: [{ userId: 'appr1', email: 'ada@c.com', name: 'Ada' }],
      role: 'approver',
    }))
  })

  it('notifies a removed approver', async () => {
    vi.mocked(isEligibleApprover).mockResolvedValue(true)
    mockDb.changeAssignee.findMany.mockResolvedValue([{ userId: 'gone1', role: 'approver' }])
    mockDb.user.findMany.mockResolvedValue([
      { id: 'appr1', name: 'Ada', email: 'ada@c.com' },
      { id: 'gone1', name: 'Kofi', email: 'kofi@c.com' },
    ])
    await setChangeApprovers('c1', ['appr1'])
    expect(notifyChange).toHaveBeenCalledWith('assignee_removed', 'c1', expect.objectContaining({
      recipients: [{ userId: 'gone1', email: 'kofi@c.com', name: 'Kofi' }],
    }))
  })

  it('does not re-notify an approver who was already named', async () => {
    vi.mocked(isEligibleApprover).mockResolvedValue(true)
    mockDb.changeAssignee.findMany.mockResolvedValue([{ userId: 'appr1', role: 'approver' }])
    mockDb.user.findMany.mockResolvedValue([{ id: 'appr1', name: 'Ada', email: 'ada@c.com' }])
    await setChangeApprovers('c1', ['appr1'])
    expect(notifyChange).not.toHaveBeenCalled()
  })

  it('does not notify the actor about their own assignment', async () => {
    mockDb.changeAssignee.findMany.mockResolvedValue([])
    mockDb.user.findMany.mockResolvedValue([{ id: 'user-req', name: 'Me', email: 'me@c.com' }])
    await setChangeAssignees('c1', [{ userId: 'user-req', role: 'implementer' }])
    expect(notifyChange).not.toHaveBeenCalled()
  })

  it('notifies an implementer named by someone else', async () => {
    mockDb.changeAssignee.findMany.mockResolvedValue([])
    mockDb.user.findMany.mockResolvedValue([{ id: 'impl1', name: 'Eng', email: 'eng@c.com' }])
    await setChangeAssignees('c1', [{ userId: 'impl1', role: 'implementer' }])
    expect(notifyChange).toHaveBeenCalledWith('assignee_added', 'c1', expect.objectContaining({
      role: 'implementer',
    }))
  })
})
