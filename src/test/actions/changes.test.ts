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

const mockDb = {
  opCo: { findUnique: vi.fn().mockResolvedValue({ id: 'opco-1', slug: 'ghana' }) },
  user: { findUnique: vi.fn().mockResolvedValue({ id: 'user-1', keycloakId: 'kc-1' }) },
  changeRequest: {
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockImplementation(({ data }: { data: unknown }) =>
      Promise.resolve({ id: 'cr-new', status: 'draft', ...(data as object) })
    ),
    findUnique: vi.fn().mockResolvedValue({
      id: 'cr-1', status: 'draft', opcoId: 'opco-1', requesterId: 'user-1',
      opco: { slug: 'ghana' }, title: 'Router update', riskLevel: 'low',
    }),
    update: vi.fn().mockResolvedValue({ id: 'cr-1', status: 'pending' }),
  },
  auditLog: { create: vi.fn().mockResolvedValue({}) },
  blackoutPeriod: { findMany: vi.fn().mockResolvedValue([]) },
  userOpCoAssignment: { findMany: vi.fn().mockResolvedValue([]) },
}

vi.mock('@/server/db', () => ({
  getPrisma: () => mockDb,
}))

vi.mock('@/server/email', () => ({
  sendApprovalRequestEmail: vi.fn().mockResolvedValue(undefined),
}))

import { listChanges, createChange, updateChangeStatus, submitChange, getChange, updateChange } from '@/server/actions/changes'
import { getAppSession } from '@/lib/session'
import { sendApprovalRequestEmail } from '@/server/email'

beforeEach(() => {
  vi.mocked(sendApprovalRequestEmail).mockClear()
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

  it('does NOT call sendApprovalRequestEmail on draft creation', async () => {
    await createChange('ghana', {
      title: 'Router update', description: 'BGP config',
      category: 'config', riskLevel: 'low',
      contactEmail: 'test@csquared.com', infrastructureType: 'Backbone IP Network',
    })
    expect(vi.mocked(sendApprovalRequestEmail)).not.toHaveBeenCalled()
  })
})

describe('updateChangeStatus — OpCo authorization', () => {
  it('rejects a non-member acting on another OpCo\'s change', async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ugandaSession)
    mockDb.user.findUnique.mockResolvedValueOnce({ id: 'user-ug', keycloakId: 'kc-ug' })
    await expect(updateChangeStatus('cr-1', 'pending')).rejects.toThrow(/Forbidden/)
  })

  it('allows a ghana member through the authz gate to the transition logic', async () => {
    // module-level session is ghana/requester; change.opco.slug = ghana
    const result = await updateChangeStatus('cr-1', 'pending')
    expect(result).toHaveProperty('status', 'pending')
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

  it('calls sendApprovalRequestEmail for each approver', async () => {
    mockDb.userOpCoAssignment.findMany.mockResolvedValueOnce([
      { user: { email: 'approver1@csquared.com', name: 'Approver One' } },
      { user: { email: 'approver2@csquared.com', name: 'Approver Two' } },
    ])
    await submitChange('cr-1')
    expect(vi.mocked(sendApprovalRequestEmail)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(sendApprovalRequestEmail)).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'approver1@csquared.com' })
    )
    expect(vi.mocked(sendApprovalRequestEmail)).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'approver2@csquared.com' })
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
