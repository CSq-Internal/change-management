// src/test/actions/reschedule.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/session', () => ({
  getAppSession: vi.fn().mockResolvedValue({
    keycloakId: 'kc-req', email: 'req@csquared.com', name: 'Req',
    organizations: [{ id: 'org-gh', name: 'Ghana', alias: 'ghana', roles: ['requester'] }],
    realmRoles: [],
  }),
}))

const mockDb = {
  user: { findUnique: vi.fn().mockResolvedValue({ id: 'user-req', keycloakId: 'kc-req' }) },
  changeRequest: {
    findUnique: vi.fn(),
    update: vi.fn().mockResolvedValue({ id: 'c1' }),
  },
  blackoutPeriod: { findMany: vi.fn().mockResolvedValue([]) },
  auditLog: { create: vi.fn().mockResolvedValue({}) },
}
vi.mock('@/server/db', () => ({ getPrisma: () => mockDb }))
vi.mock('@/server/email', () => ({
  sendApprovalRequestEmail: vi.fn(), sendEmergencyAlertEmail: vi.fn(),
}))

import { rescheduleChange } from '@/server/actions/changes'

const NEW_START = '2026-07-01T02:00:00.000Z'
const NEW_END = '2026-07-01T04:00:00.000Z'

const pendingChange = {
  id: 'c1', status: 'pending', requesterId: 'user-req', opcoId: 'opco-1',
  isEmergency: false, plannedStart: new Date('2026-06-01T02:00:00Z'),
  plannedEnd: new Date('2026-06-01T04:00:00Z'), opco: { slug: 'ghana' },
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.user.findUnique.mockResolvedValue({ id: 'user-req', keycloakId: 'kc-req' })
  mockDb.changeRequest.update.mockResolvedValue({ id: 'c1' })
  mockDb.blackoutPeriod.findMany.mockResolvedValue([])
})

describe('rescheduleChange', () => {
  it('reschedules a pending change and writes a "rescheduled" audit entry', async () => {
    mockDb.changeRequest.findUnique.mockResolvedValue(pendingChange)
    await rescheduleChange('c1', NEW_START, NEW_END)
    expect(mockDb.changeRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { plannedStart: new Date(NEW_START), plannedEnd: new Date(NEW_END) } })
    )
    expect(mockDb.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'rescheduled' }) })
    )
  })

  it('rejects an implemented change (status guard)', async () => {
    mockDb.changeRequest.findUnique.mockResolvedValue({ ...pendingChange, status: 'implemented' })
    await expect(rescheduleChange('c1', NEW_START, NEW_END)).rejects.toThrow(/unimplemented/i)
  })

  it('rejects an invalid window (end <= start)', async () => {
    mockDb.changeRequest.findUnique.mockResolvedValue(pendingChange)
    await expect(rescheduleChange('c1', NEW_END, NEW_START)).rejects.toThrow(/Invalid/i)
  })

  it('blocks a non-emergency landing in a blackout', async () => {
    mockDb.changeRequest.findUnique.mockResolvedValue(pendingChange)
    mockDb.blackoutPeriod.findMany.mockResolvedValue([{ label: 'Freeze' }])
    await expect(rescheduleChange('c1', NEW_START, NEW_END)).rejects.toThrow(/blackout/i)
    expect(mockDb.changeRequest.update).not.toHaveBeenCalled()
  })

  it('lets an emergency override a blackout', async () => {
    mockDb.changeRequest.findUnique.mockResolvedValue({ ...pendingChange, isEmergency: true })
    mockDb.blackoutPeriod.findMany.mockResolvedValue([{ label: 'Freeze' }])
    await rescheduleChange('c1', NEW_START, NEW_END)
    expect(mockDb.changeRequest.update).toHaveBeenCalled()
  })

  it('forbids a non-requester non-admin', async () => {
    mockDb.changeRequest.findUnique.mockResolvedValue({ ...pendingChange, requesterId: 'someone-else' })
    await expect(rescheduleChange('c1', NEW_START, NEW_END)).rejects.toThrow(/Forbidden/i)
  })
})
