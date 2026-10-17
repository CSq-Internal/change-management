// src/test/server/sla.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDb = {
  changeRequest: { findMany: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  userOpCoAssignment: { findMany: vi.fn().mockResolvedValue([]) },
  cABMembership: { findMany: vi.fn().mockResolvedValue([]) },
  user: { upsert: vi.fn().mockResolvedValue({ id: 'system-user' }) },
  auditLog: { create: vi.fn().mockResolvedValue({}) },
}

vi.mock('@/server/db', () => ({ getPrisma: () => mockDb }))
vi.mock('@/server/notify', () => ({ notifyEvent: vi.fn().mockResolvedValue(undefined) }))

import { runDueEscalations } from '@/server/sla'
import { notifyEvent } from '@/server/notify'

const HOUR = 3_600_000

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.changeRequest.updateMany.mockResolvedValue({ count: 1 })
  mockDb.user.upsert.mockResolvedValue({ id: 'system-user' })
  mockDb.userOpCoAssignment.findMany.mockResolvedValue([])
  mockDb.cABMembership.findMany.mockResolvedValue([])
})

describe('runDueEscalations', () => {
  it('escalates a freshly-breached change to level 1 and notifies OpCo admins', async () => {
    const deadline = Date.now() - 1
    mockDb.changeRequest.findMany.mockResolvedValue([
      { id: 'c1', title: 'X', riskLevel: 'high', opcoId: 'opco-1', slaDeadline: new Date(deadline), escalationLevel: 0 },
    ])
    mockDb.userOpCoAssignment.findMany.mockResolvedValue([
      { user: { id: 'admin-1', email: 'admin@ghana.com', name: 'Admin', isActive: true } },
    ])

    const res = await runDueEscalations()

    expect(res.escalated).toBe(1)
    expect(vi.mocked(notifyEvent)).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'sla_escalated',
        recipients: expect.arrayContaining([expect.objectContaining({ email: 'admin@ghana.com' })]),
        context: expect.objectContaining({ level: 1 }),
      })
    )
    // The level is claimed (conditionally on the level read) before anything is sent.
    expect(mockDb.changeRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', escalationLevel: 0 },
      data: { escalationLevel: 1, lastEscalatedAt: expect.any(Date) },
    })
    expect(mockDb.changeRequest.updateMany.mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(notifyEvent).mock.invocationCallOrder[0])
    expect(mockDb.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'sla_escalated', actorId: 'system-user' }) })
    )
  })

  it('does NOT re-escalate a change already at its due level (idempotent)', async () => {
    mockDb.changeRequest.findMany.mockResolvedValue([
      { id: 'c1', title: 'X', riskLevel: 'high', opcoId: 'opco-1', slaDeadline: new Date(Date.now() - 1), escalationLevel: 1 },
    ])
    const res = await runDueEscalations()
    expect(res.escalated).toBe(0)
    expect(vi.mocked(notifyEvent)).not.toHaveBeenCalled()
    expect(mockDb.changeRequest.updateMany).not.toHaveBeenCalled()
  })

  it('sends nothing when an overlapping run already claimed the level', async () => {
    mockDb.changeRequest.findMany.mockResolvedValue([
      { id: 'c1', title: 'X', riskLevel: 'high', opcoId: 'opco-1', slaDeadline: new Date(Date.now() - 1), escalationLevel: 0 },
    ])
    mockDb.changeRequest.updateMany.mockResolvedValueOnce({ count: 0 })
    const res = await runDueEscalations()
    expect(res.escalated).toBe(0)
    expect(vi.mocked(notifyEvent)).not.toHaveBeenCalled()
    expect(mockDb.auditLog.create).not.toHaveBeenCalled()
  })

  it('notifies group CAB members for a level-2 breach and fires both crossed levels', async () => {
    const deadline = Date.now() - 3 * HOUR
    mockDb.changeRequest.findMany.mockResolvedValue([
      { id: 'c1', title: 'X', riskLevel: 'high', opcoId: 'opco-1', slaDeadline: new Date(deadline), escalationLevel: 0 },
    ])
    mockDb.userOpCoAssignment.findMany.mockResolvedValue([{ user: { id: 'admin-1', email: 'admin@ghana.com', name: 'Admin', isActive: true } }])
    mockDb.cABMembership.findMany.mockResolvedValue([{ user: { id: 'cab-1', email: 'cab@group.com', name: 'CAB', isActive: true } }])

    const res = await runDueEscalations()

    expect(res.escalated).toBe(1)
    expect(vi.mocked(notifyEvent)).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'sla_escalated',
        recipients: expect.arrayContaining([expect.objectContaining({ email: 'admin@ghana.com' })]),
        context: expect.objectContaining({ level: 1 }),
      })
    )
    expect(vi.mocked(notifyEvent)).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'sla_escalated',
        recipients: expect.arrayContaining([expect.objectContaining({ email: 'cab@group.com' })]),
        context: expect.objectContaining({ level: 2 }),
      })
    )
    expect(mockDb.changeRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ escalationLevel: 2 }) })
    )
  })
})
