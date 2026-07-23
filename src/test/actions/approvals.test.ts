// src/test/actions/approvals.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Top-level mocks — hoisted by Vitest before imports
vi.mock('@/lib/session', () => ({
  getAppSession: vi.fn().mockResolvedValue({
    keycloakId: 'kc-requester',
    email: 'requester@csquared.com',
    name: 'Requester',
    // ghana/approver so the authz gate passes and the SoD check is reached
    organizations: [{ id: 'org-gh', name: 'Ghana', alias: 'ghana', roles: ['approver'] }],
    realmRoles: [],
  }),
}))

const mockDb = {
  user: {
    findUnique: vi.fn().mockResolvedValue({ id: 'user-requester', keycloakId: 'kc-requester', email: 'requester@csquared.com', name: 'Requester' }),
  },
  changeRequest: {
    findUnique: vi.fn().mockResolvedValue({
      id: 'cr-1',
      status: 'pending',
      riskLevel: 'low',
      infrastructureType: 'Wifi',
      opcoId: 'opco-1',
      requesterId: 'user-requester', // same as user.id → triggers SoD
      opco: { slug: 'ghana' },
      approvals: [],
    }),
    update: vi.fn().mockResolvedValue({}),
  },
  approval: {
    create: vi.fn().mockResolvedValue({ id: 'appr-1' }),
  },
  auditLog: {
    create: vi.fn().mockResolvedValue({}),
    // Latest `submitted` row — marks the start of the current submission cycle.
    findFirst: vi.fn().mockResolvedValue(null),
  },
}

vi.mock('@/server/db', () => ({
  getPrisma: () => mockDb,
}))

vi.mock('@/server/notify', () => ({
  notifyEvent: vi.fn().mockResolvedValue(undefined),
  notifyChange: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/server/approval-authority', () => ({
  canUserApproveChange: vi.fn().mockResolvedValue(true),
}))

import { checkCabQuorum } from '@/lib/cab-quorum'
import { submitApproval } from '@/server/actions/approvals'
import { canUserApproveChange } from '@/server/approval-authority'

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.auditLog.findFirst.mockResolvedValue(null)
})

// ── checkCabQuorum (pure function, no mocks needed) ──────────────────────────

describe('checkCabQuorum', () => {
  it('returns false with only 1 CAB approval', () => {
    expect(
      checkCabQuorum([{ isCab: true, decision: 'approve', approverId: 'a1' }])
    ).toBe(false)
  })

  it('returns true when 2 different CAB approvers both approve', () => {
    expect(
      checkCabQuorum([
        { isCab: true, decision: 'approve', approverId: 'a1' },
        { isCab: true, decision: 'approve', approverId: 'a2' },
      ])
    ).toBe(true)
  })

  it('returns false when same CAB approver appears twice (dedup by approverId)', () => {
    expect(
      checkCabQuorum([
        { isCab: true, decision: 'approve', approverId: 'a1' },
        { isCab: true, decision: 'approve', approverId: 'a1' },
      ])
    ).toBe(false)
  })

  it('returns false for 2 non-CAB approvals', () => {
    expect(
      checkCabQuorum([
        { isCab: false, decision: 'approve', approverId: 'a1' },
        { isCab: false, decision: 'approve', approverId: 'a2' },
      ])
    ).toBe(false)
  })
})

// ── TC-CONTRACT-SOD-001: Segregation of Duties (security-critical) ───────────

describe('TC-CONTRACT-SOD-001: submitApproval — self-approval rejected (SoD)', () => {
  it('throws a SoD violation error when requester tries to approve their own change', async () => {
    // session.keycloakId = 'kc-requester'
    // db.user.findUnique resolves to { id: 'user-requester' }
    // db.changeRequest.findUnique resolves with requesterId = 'user-requester'
    // → change.requesterId === user.id → SoD check fires
    await expect(
      submitApproval('cr-1', 'approve', undefined, false)
    ).rejects.toThrow(/SoD violation/)
  })
})

// ── Authorization: CAB-membership authority + risk-based quorum ──────────────

describe('submitApproval — CAB authority + quorum', () => {
  it('forbids when the authority predicate denies', async () => {
    vi.mocked(canUserApproveChange).mockResolvedValueOnce(false)
    await expect(
      submitApproval('cr-1', 'approve', undefined, false)
    ).rejects.toThrow(/Forbidden/)
  })

  it('single approval advances a low-risk change', async () => {
    mockDb.changeRequest.findUnique.mockResolvedValueOnce({
      id: 'cr-1', status: 'pending', opcoId: 'opco-1', requesterId: 'req',
      opco: { slug: 'ghana' }, infrastructureType: 'Wifi',
      riskLevel: 'low', title: 'x', approvals: [],
    })
    await submitApproval('cr-1', 'approve', undefined, false)
    expect(mockDb.changeRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'approved' } })
    )
  })

  it('Equiano is single-approval even at high risk', async () => {
    mockDb.changeRequest.findUnique.mockResolvedValueOnce({
      id: 'cr-1', status: 'pending', opcoId: 'opco-1', requesterId: 'req',
      opco: { slug: 'ghana' }, infrastructureType: 'Equiano Optics',
      riskLevel: 'high', title: 'x', approvals: [],
    })
    await submitApproval('cr-1', 'approve', undefined, false)
    expect(mockDb.changeRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'approved' } })
    )
  })

  it('non-Equiano high risk needs 2 CAB approvals (quorum)', async () => {
    mockDb.changeRequest.findUnique.mockResolvedValueOnce({
      id: 'cr-1', status: 'pending', opcoId: 'opco-1', requesterId: 'req',
      opco: { slug: 'ghana' }, infrastructureType: 'Backbone IP Network',
      riskLevel: 'high', title: 'x',
      approvals: [], // first vote → no quorum yet
    })
    await submitApproval('cr-1', 'approve', undefined, false)
    // only one CAB approve → not advanced to approved
    expect(mockDb.changeRequest.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'approved' } })
    )
  })

  it('records a retrospective approval on an expedited emergency without changing status', async () => {
    mockDb.changeRequest.findUnique.mockResolvedValueOnce({
      id: 'cr-1', status: 'implemented', opcoId: 'opco-1', requesterId: 'req',
      opco: { slug: 'ghana' }, infrastructureType: 'Wifi', riskLevel: 'emergency',
      isEmergency: true, expedited: true, title: 'x', approvals: [],
    })
    await submitApproval('cr-1', 'approve', undefined, false)
    expect(mockDb.changeRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ retroApprovedAt: expect.any(Date) }) })
    )
    expect(mockDb.changeRequest.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'approved' } })
    )
  })
})

describe('submitApproval — duplicate vote guard', () => {
  const PENDING = {
    id: 'cr-1', status: 'pending', riskLevel: 'low', infrastructureType: 'Wifi',
    opcoId: 'opco-1', requesterId: 'someone-else', opco: { slug: 'ghana' },
  }

  it('rejects a second vote from the same user on a pending change', async () => {
    mockDb.changeRequest.findUnique.mockResolvedValue({
      ...PENDING,
      approvals: [{ approverId: 'user-requester', decision: 'approve', isCab: true }],
    })
    await expect(submitApproval('cr-1', 'approve', undefined, true))
      .rejects.toThrow(/already voted/i)
    expect(mockDb.approval.create).not.toHaveBeenCalled()
  })

  it('allows a first vote when others have already voted', async () => {
    mockDb.changeRequest.findUnique.mockResolvedValue({
      ...PENDING,
      approvals: [{ approverId: 'someone-else-entirely', decision: 'approve', isCab: true }],
    })
    await submitApproval('cr-1', 'approve', undefined, true)
    expect(mockDb.approval.create).toHaveBeenCalled()
  })

  it('allows a retrospective vote from a user who already voted normally', async () => {
    mockDb.changeRequest.findUnique.mockResolvedValue({
      ...PENDING,
      status: 'implemented', isEmergency: true, expedited: true,
      approvals: [{ approverId: 'user-requester', decision: 'approve', isCab: true }],
    })
    await submitApproval('cr-1', 'approve', undefined, true)
    expect(mockDb.approval.create).toHaveBeenCalled()
  })
})

describe('submitApproval — submission-cycle scoping', () => {
  const RESUBMITTED_AT = new Date('2026-07-20T10:00:00Z')
  const BEFORE = new Date('2026-07-19T09:00:00Z')
  const AFTER = new Date('2026-07-20T11:00:00Z')
  const PENDING = {
    id: 'cr-1', status: 'pending', riskLevel: 'low', infrastructureType: 'Wifi',
    opcoId: 'opco-1', requesterId: 'someone-else', opco: { slug: 'ghana' }, title: 'x',
  }

  it('lets an approver who rejected a previous cycle vote again after a resubmission', async () => {
    // reject → reopen → fix → resubmit: the old reject belongs to the previous cycle.
    mockDb.auditLog.findFirst.mockResolvedValue({ at: RESUBMITTED_AT })
    mockDb.changeRequest.findUnique.mockResolvedValue({
      ...PENDING,
      approvals: [{ approverId: 'user-requester', decision: 'reject', isCab: true, decidedAt: BEFORE }],
    })
    await submitApproval('cr-1', 'approve', undefined, true)
    expect(mockDb.approval.create).toHaveBeenCalled()
    expect(mockDb.changeRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'approved' } })
    )
  })

  it('still rejects a duplicate vote cast within the current cycle', async () => {
    mockDb.auditLog.findFirst.mockResolvedValue({ at: RESUBMITTED_AT })
    mockDb.changeRequest.findUnique.mockResolvedValue({
      ...PENDING,
      approvals: [{ approverId: 'user-requester', decision: 'approve', isCab: true, decidedAt: AFTER }],
    })
    await expect(submitApproval('cr-1', 'approve', undefined, true))
      .rejects.toThrow(/already voted/i)
    expect(mockDb.approval.create).not.toHaveBeenCalled()
  })

  it('does not count a stale pre-rejection approve vote toward quorum', async () => {
    mockDb.auditLog.findFirst.mockResolvedValue({ at: RESUBMITTED_AT })
    mockDb.changeRequest.findUnique.mockResolvedValue({
      ...PENDING, riskLevel: 'high',
      approvals: [{ approverId: 'first-approver', decision: 'approve', isCab: true, decidedAt: BEFORE }],
    })
    await submitApproval('cr-1', 'approve', undefined, true)
    // The old vote was cast against a previous version of the plan — quorum is not met.
    expect(mockDb.changeRequest.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'approved' } })
    )
  })

  it('counts an approve vote cast in the current cycle toward quorum', async () => {
    mockDb.auditLog.findFirst.mockResolvedValue({ at: RESUBMITTED_AT })
    mockDb.changeRequest.findUnique.mockResolvedValue({
      ...PENDING, riskLevel: 'high',
      approvals: [{ approverId: 'first-approver', decision: 'approve', isCab: true, decidedAt: AFTER }],
    })
    await submitApproval('cr-1', 'approve', undefined, true)
    expect(mockDb.changeRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'approved' } })
    )
  })

  it('treats every approval as current when no submitted audit row exists (legacy data)', async () => {
    mockDb.auditLog.findFirst.mockResolvedValue(null)
    mockDb.changeRequest.findUnique.mockResolvedValue({
      ...PENDING,
      approvals: [{ approverId: 'user-requester', decision: 'approve', isCab: true, decidedAt: BEFORE }],
    })
    await expect(submitApproval('cr-1', 'approve', undefined, true))
      .rejects.toThrow(/already voted/i)
  })
})

describe('submitApproval — named approvers count toward quorum', () => {
  it('two distinct approvers satisfy quorum on a high-risk change', async () => {
    mockDb.changeRequest.findUnique.mockResolvedValue({
      id: 'cr-1', status: 'pending', riskLevel: 'high', infrastructureType: 'Wifi',
      opcoId: 'opco-1', requesterId: 'someone-else', opco: { slug: 'ghana' },
      approvals: [{ approverId: 'first-approver', decision: 'approve', isCab: true }],
    })
    await submitApproval('cr-1', 'approve', undefined, true)
    expect(mockDb.changeRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'cr-1' }, data: { status: 'approved' } })
    )
  })

  it('a single approver does not satisfy quorum on a high-risk change', async () => {
    mockDb.changeRequest.findUnique.mockResolvedValue({
      id: 'cr-1', status: 'pending', riskLevel: 'high', infrastructureType: 'Wifi',
      opcoId: 'opco-1', requesterId: 'someone-else', opco: { slug: 'ghana' },
      approvals: [],
    })
    await submitApproval('cr-1', 'approve', undefined, true)
    expect(mockDb.changeRequest.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'approved' } })
    )
  })
})
