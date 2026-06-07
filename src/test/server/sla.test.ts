// src/test/server/sla.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDb = {
  changeRequest: { findMany: vi.fn(), update: vi.fn().mockResolvedValue({}) },
  userOpCoAssignment: { findMany: vi.fn().mockResolvedValue([]) },
  cABMembership: { findMany: vi.fn().mockResolvedValue([]) },
  user: { upsert: vi.fn().mockResolvedValue({ id: 'system-user' }) },
  auditLog: { create: vi.fn().mockResolvedValue({}) },
}

vi.mock('@/server/db', () => ({ getPrisma: () => mockDb }))
vi.mock('@/server/email', () => ({
  sendSlaEscalationEmail: vi.fn().mockResolvedValue(undefined),
}))

import { runDueEscalations } from '@/server/sla'
import { sendSlaEscalationEmail } from '@/server/email'

const HOUR = 3_600_000

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.changeRequest.update.mockResolvedValue({})
  mockDb.user.upsert.mockResolvedValue({ id: 'system-user' })
  mockDb.userOpCoAssignment.findMany.mockResolvedValue([])
  mockDb.cABMembership.findMany.mockResolvedValue([])
})

describe('runDueEscalations', () => {
  it('escalates a freshly-breached change to level 1 and emails OpCo admins', async () => {
    const deadline = Date.now() - 1
    mockDb.changeRequest.findMany.mockResolvedValue([
      { id: 'c1', title: 'X', riskLevel: 'high', opcoId: 'opco-1', slaDeadline: new Date(deadline), escalationLevel: 0 },
    ])
    mockDb.userOpCoAssignment.findMany.mockResolvedValue([
      { user: { email: 'admin@ghana.com', isActive: true } },
    ])

    const res = await runDueEscalations({})

    expect(res.escalated).toBe(1)
    expect(sendSlaEscalationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'admin@ghana.com', level: 1 })
    )
    expect(mockDb.changeRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ escalationLevel: 1 }) })
    )
    expect(mockDb.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'sla_escalated', actorId: 'system-user' }) })
    )
  })

  it('does NOT re-escalate a change already at its due level (idempotent)', async () => {
    mockDb.changeRequest.findMany.mockResolvedValue([
      { id: 'c1', title: 'X', riskLevel: 'high', opcoId: 'opco-1', slaDeadline: new Date(Date.now() - 1), escalationLevel: 1 },
    ])
    const res = await runDueEscalations({})
    expect(res.escalated).toBe(0)
    expect(sendSlaEscalationEmail).not.toHaveBeenCalled()
    expect(mockDb.changeRequest.update).not.toHaveBeenCalled()
  })

  it('notifies group CAB members for a level-2 breach and fires both crossed levels', async () => {
    const deadline = Date.now() - 3 * HOUR
    mockDb.changeRequest.findMany.mockResolvedValue([
      { id: 'c1', title: 'X', riskLevel: 'high', opcoId: 'opco-1', slaDeadline: new Date(deadline), escalationLevel: 0 },
    ])
    mockDb.userOpCoAssignment.findMany.mockResolvedValue([{ user: { email: 'admin@ghana.com', isActive: true } }])
    mockDb.cABMembership.findMany.mockResolvedValue([{ user: { email: 'cab@group.com', isActive: true } }])

    const res = await runDueEscalations({})

    expect(res.escalated).toBe(1)
    expect(sendSlaEscalationEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'admin@ghana.com', level: 1 }))
    expect(sendSlaEscalationEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'cab@group.com', level: 2 }))
    expect(mockDb.changeRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ escalationLevel: 2 }) })
    )
  })

  it('scopes the query to the given opcoSlugs', async () => {
    mockDb.changeRequest.findMany.mockResolvedValue([])
    await runDueEscalations({ opcoSlugs: ['ghana'] })
    expect(mockDb.changeRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ opco: { slug: { in: ['ghana'] } } }),
      })
    )
  })
})
