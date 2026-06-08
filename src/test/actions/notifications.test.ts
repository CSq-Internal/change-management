import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/session', () => ({
  getAppSession: vi.fn().mockResolvedValue({
    keycloakId: 'kc-me', email: 'me@x.com', name: 'Me',
    organizations: [{ id: 'org-gh', name: 'Ghana', alias: 'ghana', roles: ['approver'] }],
    realmRoles: [],
  }),
}))

const mockDb = {
  user: { findUnique: vi.fn().mockResolvedValue({ id: 'user-me' }) },
  notification: {
    findMany: vi.fn().mockResolvedValue([]),
    updateMany: vi.fn().mockResolvedValue({ count: 3 }),
    count: vi.fn().mockResolvedValue(2),
  },
  changeRequest: { count: vi.fn().mockResolvedValue(5) },
}
vi.mock('@/server/db', () => ({ getPrisma: () => mockDb }))
vi.mock('@/server/approval-authority', () => ({
  listApprovableChanges: vi.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]),
}))

import { getNavCounts, markAllNotificationsRead } from '@/server/actions/notifications'

beforeEach(() => { vi.clearAllMocks(); mockDb.user.findUnique.mockResolvedValue({ id: 'user-me' }) })

describe('getNavCounts', () => {
  it('returns pendingApprovals, myRequests and unreadNotifications', async () => {
    mockDb.changeRequest.count.mockResolvedValue(5)
    mockDb.notification.count.mockResolvedValue(2)
    const counts = await getNavCounts()
    expect(counts).toEqual({ pendingApprovals: 2, myRequests: 5, unreadNotifications: 2 })
  })
})

describe('markAllNotificationsRead', () => {
  it('marks all unread for the current user', async () => {
    await markAllNotificationsRead()
    expect(mockDb.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-me', readAt: null } })
    )
  })
})
