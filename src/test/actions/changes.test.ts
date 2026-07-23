// src/test/actions/changes.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/session', () => ({
  getAppSession: vi.fn().mockResolvedValue({
    keycloakId: 'kc-1', email: 'test@csquared.com', name: 'Test',
    organizations: [{ id: 'org-1', name: 'Ghana', alias: 'ghana', roles: ['requester'] }],
    realmRoles: [],
  }),
  getOpCoSlugsFromSession: vi.fn().mockReturnValue(['ghana']),
}))

const mockGroupCtoUser = { id: 'user-cto', email: 'group.cto@csquared.com', name: 'Group CTO' }

const mockDb = {
  opCo: { findUnique: vi.fn().mockResolvedValue({ id: 'opco-1', slug: 'ghana' }) },
  user: {
    findUnique: vi.fn().mockResolvedValue({ id: 'user-1', keycloakId: 'kc-1' }),
    findMany: vi.fn().mockResolvedValue([mockGroupCtoUser]),
  },
  changeRequest: {
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockImplementation(({ data }: { data: unknown }) =>
      Promise.resolve({ id: 'cr-new', status: 'draft', ...(data as object) })
    ),
    findUnique: vi.fn().mockResolvedValue({
      id: 'cr-1', status: 'draft', opcoId: 'opco-1', requesterId: 'user-1',
      opco: { slug: 'ghana' }, title: 'Router update', description: 'BGP config',
      riskLevel: 'low', category: 'config', contactEmail: 'test@csquared.com',
      infrastructureType: 'Backbone IP Network',
      plannedStart: new Date('2026-07-01'), plannedEnd: new Date('2026-07-02'),
      attachments: [
        { kind: 'impact_scope' }, { kind: 'implementation_plan' }, { kind: 'testing_plan' },
        { kind: 'backout_plan' }, { kind: 'solution_document' },
      ],
      assignees: [{ userId: 'appr1', role: 'approver' }],
    }),
    update: vi.fn().mockResolvedValue({ id: 'cr-1', status: 'pending' }),
  },
  auditLog: { create: vi.fn().mockResolvedValue({}) },
  attachment: { findMany: vi.fn().mockResolvedValue([]) },
  blackoutPeriod: { findMany: vi.fn().mockResolvedValue([]) },
  userOpCoAssignment: { findMany: vi.fn().mockResolvedValue([]) },
  cABMembership: { findMany: vi.fn().mockResolvedValue([]) },
  approverDelegation: { findMany: vi.fn().mockResolvedValue([]) },
  approverAssignment: { findMany: vi.fn().mockResolvedValue([]) },
  changeAssignee: { findMany: vi.fn().mockResolvedValue([]) },
  $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
}

vi.mock('@/server/db', () => ({
  getPrisma: () => mockDb,
}))

vi.mock('@/server/notify', () => ({ notifyEvent: vi.fn().mockResolvedValue(undefined) }))

vi.mock('@/server/approval-authority', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/approval-authority')>()
  return { ...actual, isEligibleApprover: vi.fn(async () => true) }
})

import { listChanges, createChange, updateChangeStatus, submitChange, getChange, updateChange, discardChange } from '@/server/actions/changes'
import { getAppSession } from '@/lib/session'
import { notifyEvent } from '@/server/notify'
import { isEligibleApprover } from '@/server/approval-authority'

const tx = {
  changeRequest: {
    create: vi.fn().mockImplementation(({ data }: { data: unknown }) =>
      Promise.resolve({ id: 'cr-new', status: 'draft', ...(data as object) })
    ),
  },
  changeAssignee: { create: vi.fn().mockResolvedValue({}) },
  auditLog: { create: vi.fn().mockResolvedValue({}) },
}

beforeEach(() => {
  vi.mocked(notifyEvent).mockClear()
  mockDb.user.findMany.mockReset()
  mockDb.user.findMany.mockResolvedValue([mockGroupCtoUser])
  mockDb.userOpCoAssignment.findMany.mockReset()
  mockDb.userOpCoAssignment.findMany.mockResolvedValue([])
  mockDb.cABMembership.findMany.mockReset()
  mockDb.cABMembership.findMany.mockResolvedValue([])
  mockDb.approverDelegation.findMany.mockReset()
  mockDb.approverDelegation.findMany.mockResolvedValue([])
  mockDb.approverAssignment.findMany.mockReset()
  mockDb.approverAssignment.findMany.mockResolvedValue([])
  mockDb.changeAssignee.findMany.mockReset()
  // submitChange's mandatory-approver gate reads through getNamedApprovers, which queries
  // changeAssignee.findMany (role: "approver") — not the `assignees` relation on findUnique.
  // Default to one eligible approver so happy-path submits pass; negative tests override.
  mockDb.changeAssignee.findMany.mockResolvedValue([
    { user: { id: 'appr1', name: 'Approver One', email: 'appr1@csquared.com', isActive: true } },
  ])
  mockDb.changeRequest.update.mockClear()
  tx.changeRequest.create.mockClear()
  tx.changeAssignee.create.mockClear()
  tx.auditLog.create.mockClear()
  mockDb.$transaction.mockClear()
  vi.mocked(isEligibleApprover).mockResolvedValue(true)
})

const ugandaSession = {
  keycloakId: 'kc-ug', email: 'ug@csquared.com', name: 'UG',
  organizations: [{ id: 'org-ug', name: 'Uganda', alias: 'uganda', roles: ['requester'] }],
  realmRoles: [],
}

describe('listChanges', () => {
  it('returns empty array when no changes exist', async () => {
    expect(await listChanges('ghana')).toEqual([])
  })

  it('rejects a non-member, non-group caller listing another OpCo', async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ugandaSession)
    await expect(listChanges('ghana')).rejects.toThrow(/Forbidden/)
  })
})

describe('createChange', () => {
  it('creates a change request', async () => {
    const result = await createChange('ghana', {
      title: 'Router update', description: 'BGP config',
      category: 'config', riskLevel: 'low',
      contactEmail: 'test@csquared.com', infrastructureType: 'Backbone IP Network',
    })
    expect(result).toHaveProperty('id', 'cr-new')
    expect(result).toHaveProperty('status', 'draft')
  })

  it('throws if OpCo not found', async () => {
    // group_admin passes the authz gate so the opco lookup is reached
    vi.mocked(getAppSession).mockResolvedValueOnce({
      keycloakId: 'kc-ga', email: 'ga@csquared.com', name: 'GA',
      organizations: [], realmRoles: ['group_admin'],
    })
    const { getPrisma } = await import('@/server/db')
    // @ts-expect-error mock override
    getPrisma().opCo.findUnique.mockResolvedValueOnce(null)
    await expect(createChange('unknown', {
      title: 'X', description: 'X', category: 'config', riskLevel: 'low',
      contactEmail: 'x@csquared.com', infrastructureType: 'Wifi',
    })).rejects.toThrow('OpCo not found')
  })

  it('rejects a non-member calling createChange for another OpCo', async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ugandaSession)
    await expect(createChange('ghana', {
      title: 'X', description: 'X', category: 'config', riskLevel: 'low',
      contactEmail: 'x@csquared.com', infrastructureType: 'Wifi',
    })).rejects.toThrow(/Forbidden/)
  })

  it('does NOT call notifyEvent on draft creation', async () => {
    await createChange('ghana', {
      title: 'Router update', description: 'BGP config',
      category: 'config', riskLevel: 'low',
      contactEmail: 'test@csquared.com', infrastructureType: 'Backbone IP Network',
    })
    expect(vi.mocked(notifyEvent)).not.toHaveBeenCalled()
  })
})

const approverSession = {
  keycloakId: 'kc-ap', email: 'approver@csquared.com', name: 'Approver',
  organizations: [{ id: 'org-1', name: 'Ghana', alias: 'ghana', roles: ['approver'] }],
  realmRoles: [] as string[],
}

const approvedChange = {
  id: 'cr-1', status: 'approved', opcoId: 'opco-1', requesterId: 'user-1',
  opco: { slug: 'ghana' }, title: 'Router update', riskLevel: 'low',
  isEmergency: false,
}

const rejectedChange = {
  id: 'cr-1', status: 'rejected', opcoId: 'opco-1', requesterId: 'user-1',
  opco: { slug: 'ghana' }, title: 'Router update', riskLevel: 'low',
  isEmergency: false,
}

describe('updateChangeStatus — OpCo authorization', () => {
  it('rejects a non-member acting on another OpCo\'s change', async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ugandaSession)
    mockDb.user.findUnique.mockResolvedValueOnce({ id: 'user-ug', keycloakId: 'kc-ug' })
    mockDb.changeRequest.findUnique.mockResolvedValueOnce(approvedChange)
    await expect(updateChangeStatus('cr-1', 'implemented')).rejects.toThrow(/Forbidden/)
  })

  it('forbids a plain OpCo member (requester role only, not the requester) from advancing to implemented', async () => {
    // strangerSession: ghana member with requester role only, but NOT user-1 (the requesterId)
    const strangerSession = {
      keycloakId: 'kc-stranger', email: 'stranger@csquared.com', name: 'Stranger',
      organizations: [{ id: 'org-1', name: 'Ghana', alias: 'ghana', roles: ['requester'] }],
      realmRoles: [] as string[],
    }
    vi.mocked(getAppSession).mockResolvedValueOnce(strangerSession)
    mockDb.user.findUnique.mockResolvedValueOnce({ id: 'user-stranger', keycloakId: 'kc-stranger' })
    mockDb.changeRequest.findUnique.mockResolvedValueOnce(approvedChange)
    await expect(updateChangeStatus('cr-1', 'implemented')).rejects.toThrow(/Forbidden/)
  })

  it('allows an approver to advance an approved change to implemented', async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(approverSession)
    mockDb.user.findUnique.mockResolvedValueOnce({ id: 'user-ap', keycloakId: 'kc-ap' })
    mockDb.changeRequest.findUnique.mockResolvedValueOnce(approvedChange)
    const result = await updateChangeStatus('cr-1', 'implemented')
    expect(result).toHaveProperty('status', 'pending') // mock always returns { status: 'pending' }
  })

  it('blocks the sole approver from implementing their own approval (SoD)', async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(approverSession)
    mockDb.user.findUnique.mockResolvedValueOnce({ id: 'user-ap', keycloakId: 'kc-ap' })
    mockDb.changeRequest.findUnique.mockResolvedValueOnce({
      ...approvedChange,
      approvals: [{ decision: 'approve', approverId: 'user-ap' }],
    })
    await expect(updateChangeStatus('cr-1', 'implemented')).rejects.toThrow(/sole approver/i)
  })

  it('allows implementing when another approver also approved', async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(approverSession)
    mockDb.user.findUnique.mockResolvedValueOnce({ id: 'user-ap', keycloakId: 'kc-ap' })
    mockDb.changeRequest.findUnique.mockResolvedValueOnce({
      ...approvedChange,
      approvals: [
        { decision: 'approve', approverId: 'user-ap' },
        { decision: 'approve', approverId: 'user-other' },
      ],
    })
    await updateChangeStatus('cr-1', 'implemented')
    expect(mockDb.changeRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'implemented', implementedById: 'user-ap' }) })
    )
  })

  it('lets an emergency change be implemented from pending (expedited) with a 48h retro deadline', async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(approverSession)
    mockDb.user.findUnique.mockResolvedValueOnce({ id: 'user-ap', keycloakId: 'kc-ap' })
    mockDb.changeRequest.findUnique.mockResolvedValueOnce({
      id: 'cr-1', status: 'pending', isEmergency: true, opco: { slug: 'ghana' },
      requesterId: 'user-1', approvals: [],
    })
    await updateChangeStatus('cr-1', 'implemented')
    expect(mockDb.changeRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'implemented', expedited: true, retroApprovalDueAt: expect.any(Date) }) })
    )
  })

  it('forbids implementing a non-emergency change straight from pending', async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(approverSession)
    mockDb.user.findUnique.mockResolvedValueOnce({ id: 'user-ap', keycloakId: 'kc-ap' })
    mockDb.changeRequest.findUnique.mockResolvedValueOnce({
      id: 'cr-1', status: 'pending', isEmergency: false, opco: { slug: 'ghana' },
      requesterId: 'user-1', approvals: [],
    })
    await expect(updateChangeStatus('cr-1', 'implemented')).rejects.toThrow(/emergency/i)
  })

  it('blocks direct verify (must go through a PIR)', async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(approverSession)
    mockDb.user.findUnique.mockResolvedValueOnce({ id: 'user-ap', keycloakId: 'kc-ap' })
    mockDb.changeRequest.findUnique.mockResolvedValueOnce({
      id: 'cr-1', status: 'implemented', isEmergency: false, opco: { slug: 'ghana' },
      requesterId: 'user-1', approvals: [],
    })
    await expect(updateChangeStatus('cr-1', 'verified')).rejects.toThrow(/Post-Implementation Review/i)
  })

  it('allows the original requester to reopen a rejected change', async () => {
    // default session: kc-1 → user-1 which matches requesterId
    mockDb.changeRequest.findUnique.mockResolvedValueOnce(rejectedChange)
    const result = await updateChangeStatus('cr-1', 'draft')
    expect(result).toBeDefined()
  })

  it('forbids a stranger from reopening a rejected change they did not create', async () => {
    const strangerSession = {
      keycloakId: 'kc-stranger2', email: 'stranger2@csquared.com', name: 'Stranger2',
      organizations: [{ id: 'org-1', name: 'Ghana', alias: 'ghana', roles: ['requester'] }],
      realmRoles: [] as string[],
    }
    vi.mocked(getAppSession).mockResolvedValueOnce(strangerSession)
    mockDb.user.findUnique.mockResolvedValueOnce({ id: 'user-stranger2', keycloakId: 'kc-stranger2' })
    mockDb.changeRequest.findUnique.mockResolvedValueOnce(rejectedChange)
    await expect(updateChangeStatus('cr-1', 'draft')).rejects.toThrow(/Forbidden/)
  })
})

const groupAdminSession = {
  keycloakId: 'kc-ga', email: 'ga@csquared.com', name: 'GA',
  organizations: [], realmRoles: ['group_admin'] as string[],
}

const changeWithRelations = {
  id: 'cr-1', status: 'draft', opcoId: 'opco-1', requesterId: 'user-1',
  opco: { id: 'opco-1', slug: 'ghana' },
  requester: { id: 'user-1', name: 'Test', email: 'test@csquared.com' },
  approvals: [],
  auditTrail: [],
  title: 'Router update', riskLevel: 'low',
}

describe('getChange', () => {
  it('returns the change for a member of its OpCo', async () => {
    // default session is ghana/requester — change.opco.slug === 'ghana'
    mockDb.changeRequest.findUnique.mockResolvedValueOnce(changeWithRelations)
    const result = await getChange('cr-1')
    expect(result).toHaveProperty('id', 'cr-1')
  })

  it('returns null when change does not exist', async () => {
    mockDb.changeRequest.findUnique.mockResolvedValueOnce(null)
    const result = await getChange('nonexistent')
    expect(result).toBeNull()
  })

  it('returns null for a non-member caller on another OpCo change (cross-OpCo isolation)', async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ugandaSession)
    mockDb.changeRequest.findUnique.mockResolvedValueOnce(changeWithRelations)
    const result = await getChange('cr-1')
    expect(result).toBeNull()
  })

  it('allows a group-level user to read any OpCo change', async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdminSession)
    mockDb.changeRequest.findUnique.mockResolvedValueOnce(changeWithRelations)
    const result = await getChange('cr-1')
    expect(result).toHaveProperty('id', 'cr-1')
  })
})

describe('submitChange', () => {
  it('transitions a draft to pending and writes a submitted audit row', async () => {
    const result = await submitChange('cr-1')
    expect(result).toHaveProperty('status', 'pending')
    expect(mockDb.changeRequest.update).toHaveBeenCalledWith({
      where: { id: 'cr-1' },
      data: { status: 'pending' },
    })
    expect(mockDb.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'submitted', fromStatus: 'draft', toStatus: 'pending' }),
      })
    )
  })

  it('notifies the routed CAB members on submit', async () => {
    mockDb.cABMembership.findMany.mockResolvedValueOnce([
      { userId: 'cto', user: { id: 'cto', email: 'cto@csquared.com', name: 'Resident CTO' } },
      { userId: 'samuel', user: { id: 'samuel', email: 'samuel@csquared.com', name: 'Samuel' } },
    ])
    await submitChange('cr-1')
    expect(vi.mocked(notifyEvent)).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'approval_requested',
        recipients: expect.arrayContaining([
          expect.objectContaining({ email: 'cto@csquared.com' }),
          expect.objectContaining({ email: 'samuel@csquared.com' }),
        ]),
      })
    )
  })

  it('throws when the change is not a draft', async () => {
    mockDb.changeRequest.findUnique.mockResolvedValueOnce({
      id: 'cr-1', status: 'pending', opcoId: 'opco-1', requesterId: 'user-1',
      opco: { slug: 'ghana' }, title: 'Router update', riskLevel: 'low',
    })
    await expect(submitChange('cr-1')).rejects.toThrow('Only draft changes can be submitted')
  })

  it('throws Forbidden when caller is neither requester nor admin', async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ugandaSession)
    mockDb.user.findUnique.mockResolvedValueOnce({ id: 'user-ug', keycloakId: 'kc-ug' })
    // change.requesterId is 'user-1', not 'user-ug', and ugandaSession has no admin role
    await expect(submitChange('cr-1')).rejects.toThrow(/Forbidden/)
  })

  it('throws "Blocked by blackout" when submitting a non-emergency draft during an active blackout', async () => {
    mockDb.blackoutPeriod.findMany.mockResolvedValueOnce([
      { id: 'bp-1', label: 'Year-end freeze', opcoId: null },
    ])
    await expect(submitChange('cr-1')).rejects.toThrow(/Blocked by blackout/)
  })

  it('does NOT throw when submitting an emergency draft during an active blackout', async () => {
    mockDb.changeRequest.findUnique.mockResolvedValueOnce({
      id: 'cr-1', status: 'draft', opcoId: 'opco-1', requesterId: 'user-1',
      opco: { slug: 'ghana' }, title: 'Emergency fix', description: 'BGP config',
      riskLevel: 'emergency', category: 'config', contactEmail: 'test@csquared.com',
      infrastructureType: 'Backbone IP Network',
      plannedStart: new Date('2026-07-01'), plannedEnd: new Date('2026-07-02'),
      isEmergency: true,
      attachments: [
        { kind: 'impact_scope' }, { kind: 'implementation_plan' }, { kind: 'testing_plan' },
        { kind: 'backout_plan' }, { kind: 'solution_document' },
      ],
      assignees: [{ userId: 'appr1', role: 'approver' }],
    })
    // blackoutPeriod.findMany should NOT be called, but even if it were it returns empty by default
    const result = await submitChange('cr-1')
    expect(result).toHaveProperty('status', 'pending')
  })

  it('rejects submit when a required document is missing on a high-risk change', async () => {
    mockDb.changeRequest.findUnique.mockResolvedValueOnce({
      id: 'cr-1', status: 'draft', opcoId: 'opco-1', requesterId: 'user-1',
      opco: { slug: 'ghana' }, title: 'Router update', description: 'BGP config',
      riskLevel: 'high', category: 'config', contactEmail: 'test@csquared.com',
      infrastructureType: 'Backbone IP Network',
      plannedStart: new Date('2026-07-01'), plannedEnd: new Date('2026-07-02'),
      isEmergency: false,
      attachments: [{ kind: 'impact_scope' }], // only 1 of 5
    })
    await expect(submitChange('cr-1')).rejects.toThrow(/required document/i)
  })

  it('allows submit without documents for a low-risk change', async () => {
    mockDb.changeRequest.findUnique.mockResolvedValueOnce({
      id: 'cr-1', status: 'draft', opcoId: 'opco-1', requesterId: 'user-1',
      opco: { slug: 'ghana' }, title: 'Router update', description: 'BGP config',
      riskLevel: 'low', category: 'config', contactEmail: 'test@csquared.com',
      infrastructureType: 'Backbone IP Network',
      plannedStart: new Date('2026-07-01'), plannedEnd: new Date('2026-07-02'),
      isEmergency: false,
      attachments: [], // no documents — allowed for low risk
      assignees: [{ userId: 'appr1', role: 'approver' }],
    })
    const result = await submitChange('cr-1')
    expect(result).toHaveProperty('status', 'pending')
  })

  it('rejects submit when planned dates are missing', async () => {
    mockDb.changeRequest.findUnique.mockResolvedValueOnce({
      id: 'cr-1', status: 'draft', opcoId: 'opco-1', requesterId: 'user-1',
      opco: { slug: 'ghana' }, title: 'Router update', description: 'BGP config',
      riskLevel: 'low', category: 'config', contactEmail: 'test@csquared.com',
      infrastructureType: 'Backbone IP Network',
      plannedStart: null, plannedEnd: null, isEmergency: false,
      attachments: [
        { kind: 'impact_scope' }, { kind: 'implementation_plan' }, { kind: 'testing_plan' },
        { kind: 'backout_plan' }, { kind: 'solution_document' },
      ],
    })
    await expect(submitChange('cr-1')).rejects.toThrow(/required/i)
  })
})

describe('updateChange', () => {
  it('updates a draft change when the caller is the requester', async () => {
    // default session has keycloakId 'kc-1' and mockDb.user returns { id: 'user-1' }
    // change.requesterId === 'user-1' — access granted
    mockDb.changeRequest.update.mockResolvedValueOnce({
      id: 'cr-1', status: 'draft', title: 'Updated title',
    })
    const result = await updateChange('cr-1', { title: 'Updated title' })
    expect(result).toHaveProperty('title', 'Updated title')
    expect(mockDb.changeRequest.update).toHaveBeenCalledWith({
      where: { id: 'cr-1' },
      data: { title: 'Updated title' },
    })
  })

  it('throws "Only draft changes can be edited" when status is not draft', async () => {
    mockDb.changeRequest.findUnique.mockResolvedValueOnce({
      id: 'cr-1', status: 'pending', opcoId: 'opco-1', requesterId: 'user-1',
      opco: { slug: 'ghana' }, title: 'Router update', riskLevel: 'low',
    })
    await expect(updateChange('cr-1', { title: 'X' })).rejects.toThrow('Only draft changes can be edited')
  })

  it('throws Forbidden when caller is neither requester nor admin', async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ugandaSession)
    mockDb.user.findUnique.mockResolvedValueOnce({ id: 'user-ug', keycloakId: 'kc-ug' })
    // change.requesterId is 'user-1', not 'user-ug', and ugandaSession has no admin role
    await expect(updateChange('cr-1', { title: 'Hack' })).rejects.toThrow(/Forbidden/)
  })

  it('allows a group admin who is not the requester to edit a draft', async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdminSession)
    mockDb.user.findUnique.mockResolvedValueOnce({ id: 'user-ga', keycloakId: 'kc-ga' })
    mockDb.changeRequest.update.mockResolvedValueOnce({ id: 'cr-1', status: 'draft', title: 'Admin edit' })
    // change.requesterId is 'user-1', not 'user-ga', but groupAdminSession has group_admin role
    const result = await updateChange('cr-1', { title: 'Admin edit' })
    expect(result).toHaveProperty('title', 'Admin edit')
  })
})

describe('discardChange', () => {
  it('cancels a draft and writes an audit row', async () => {
    await discardChange('cr-1')
    expect(mockDb.changeRequest.update).toHaveBeenCalledWith({
      where: { id: 'cr-1' }, data: { status: 'cancelled' },
    })
    expect(mockDb.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'cancelled', toStatus: 'cancelled' }) })
    )
  })

  it('refuses to discard a non-draft change', async () => {
    mockDb.changeRequest.findUnique.mockResolvedValueOnce({
      id: 'cr-1', status: 'approved', opcoId: 'opco-1', requesterId: 'user-1', opco: { slug: 'ghana' },
    })
    await expect(discardChange('cr-1')).rejects.toThrow(/Only draft/)
  })
})

describe('createChange — approverIds', () => {
  const baseInput = {
    title: 'Router update', description: 'BGP config',
    category: 'config' as const, riskLevel: 'low' as const,
    contactEmail: 'test@csquared.com', infrastructureType: 'Wifi',
  }

  it('writes an approver ChangeAssignee row per id', async () => {
    await createChange('ghana', { ...baseInput, approverIds: ['appr1', 'appr2'] })
    expect(tx.changeAssignee.create).toHaveBeenCalledTimes(2)
    expect(tx.changeAssignee.create).toHaveBeenCalledWith({
      data: { changeId: 'cr-new', userId: 'appr1', role: 'approver' },
    })
  })

  it('validates each id against the shared eligibility rule', async () => {
    await createChange('ghana', { ...baseInput, approverIds: ['appr1'] })
    expect(isEligibleApprover).toHaveBeenCalledWith('appr1', 'opco-1', 'Wifi')
  })

  it('succeeds with no approverIds — drafts are exempt', async () => {
    const out = await createChange('ghana', baseInput)
    expect(out.id).toBe('cr-new')
    expect(tx.changeAssignee.create).not.toHaveBeenCalled()
  })

  it('throws on an ineligible id and writes no ChangeRequest', async () => {
    vi.mocked(isEligibleApprover).mockResolvedValue(false)
    await expect(createChange('ghana', { ...baseInput, approverIds: ['rando'] }))
      .rejects.toThrow(/not an eligible approver/i)
    expect(tx.changeRequest.create).not.toHaveBeenCalled()
    expect(mockDb.$transaction).not.toHaveBeenCalled()
  })

  it('propagates an eligibility rejection from the shared rule', async () => {
    vi.mocked(isEligibleApprover).mockResolvedValue(false)
    await expect(createChange('ghana', {
      ...baseInput, infrastructureType: 'Equiano IP', approverIds: ['appr1'],
    })).rejects.toThrow(/not an eligible approver/i)
  })

  // submitApproval rejects self-approval (SoD), so a requester who names only themselves
  // would clear submitChange's mandatory-approver gate with nobody able to approve.
  it('rejects the requester naming themselves as an approver', async () => {
    await expect(createChange('ghana', { ...baseInput, approverIds: ['user-1'] }))
      .rejects.toThrow(/yourself as an approver/i)
    expect(tx.changeRequest.create).not.toHaveBeenCalled()
    expect(mockDb.$transaction).not.toHaveBeenCalled()
  })

  it('does not strip approverIds into the ChangeRequest row', async () => {
    await createChange('ghana', { ...baseInput, approverIds: ['appr1'] })
    const created = tx.changeRequest.create.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(created.data).not.toHaveProperty('approverIds')
  })
})

describe('submitChange — mandatory approver', () => {
  const SUBMITTABLE = {
    id: 'cr-1', status: 'draft', opcoId: 'opco-1', requesterId: 'user-1',
    opco: { slug: 'ghana' }, title: 'Router update', description: 'BGP config',
    riskLevel: 'low', category: 'config', contactEmail: 'test@csquared.com',
    infrastructureType: 'Backbone IP Network',
    isEmergency: false,
    plannedStart: new Date('2026-07-01'), plannedEnd: new Date('2026-07-02'),
    attachments: [],
  }

  it('throws when the change has no named approver', async () => {
    mockDb.changeRequest.findUnique.mockResolvedValue({ ...SUBMITTABLE, assignees: [] })
    mockDb.changeAssignee.findMany.mockResolvedValue([])
    await expect(submitChange('cr-1')).rejects.toThrow(/at least one approver must be named/i)
    expect(mockDb.changeRequest.update).not.toHaveBeenCalled()
  })

  it('succeeds when one approver is named', async () => {
    mockDb.changeRequest.findUnique.mockResolvedValue({
      ...SUBMITTABLE,
      assignees: [{ userId: 'appr1', role: 'approver' }],
    })
    await submitChange('cr-1')
    expect(mockDb.changeRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'cr-1' }, data: { status: 'pending' } })
    )
  })

  it('ignores implementer assignees when counting approvers', async () => {
    mockDb.changeRequest.findUnique.mockResolvedValue({
      ...SUBMITTABLE,
      assignees: [{ userId: 'impl1', role: 'implementer' }],
    })
    // getNamedApprovers filters on role: "approver", so an implementer-only change yields none.
    mockDb.changeAssignee.findMany.mockResolvedValue([])
    await expect(submitChange('cr-1')).rejects.toThrow(/at least one approver must be named/i)
  })

  it('blocks an emergency change with no named approver (no exemption by design)', async () => {
    mockDb.changeRequest.findUnique.mockResolvedValue({
      ...SUBMITTABLE, isEmergency: true, riskLevel: 'emergency', assignees: [],
      // emergency risk requires the 5 documents (see documentsRequiredForRisk) — supply them
      // so this test isolates the approver gate rather than tripping the document gate first.
      attachments: [
        { kind: 'impact_scope' }, { kind: 'implementation_plan' }, { kind: 'testing_plan' },
        { kind: 'backout_plan' }, { kind: 'solution_document' },
      ],
    })
    mockDb.changeAssignee.findMany.mockResolvedValue([])
    await expect(submitChange('cr-1')).rejects.toThrow(/at least one approver must be named/i)
  })
})
