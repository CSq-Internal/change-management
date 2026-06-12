import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDb = {
  changeRequest: { findMany: vi.fn().mockResolvedValue([]) },
}
vi.mock('@/server/db', () => ({ getPrisma: () => mockDb }))

vi.mock('@/server/approval-authority', () => ({
  getRoutedApprovers: vi.fn().mockResolvedValue([]),
  getNamedApprovers: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/server/notify', () => ({ notifyEvent: vi.fn().mockResolvedValue(undefined) }))

import { notifyRemainingAndDetectOrphans } from '@/server/approver-reassign'
import { getRoutedApprovers, getNamedApprovers } from '@/server/approval-authority'
import { notifyEvent } from '@/server/notify'

const footprint = [{ id: 'c1', reference: 12, title: 'X', infrastructureType: 'Wifi', opcoId: 'opco-1' }]

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getRoutedApprovers).mockResolvedValue([])
  vi.mocked(getNamedApprovers).mockResolvedValue([])
})

describe('notifyRemainingAndDetectOrphans', () => {
  it('flags a change with no remaining approvers as orphaned', async () => {
    const { orphaned } = await notifyRemainingAndDetectOrphans(footprint)
    expect(orphaned.map((o) => o.reference)).toEqual([12])
    expect(notifyEvent).not.toHaveBeenCalled()
  })

  it('notifies remaining approvers and does not orphan', async () => {
    vi.mocked(getRoutedApprovers).mockResolvedValue([{ id: 'u2', name: 'U2', email: 'u2@x.com' }])
    const { orphaned } = await notifyRemainingAndDetectOrphans(footprint)
    expect(orphaned).toEqual([])
    expect(notifyEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'approval_requested', recipients: [{ userId: 'u2', email: 'u2@x.com', name: 'U2' }] })
    )
  })
})
