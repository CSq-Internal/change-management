import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/session', () => ({
  getAppSession: vi.fn().mockResolvedValue({
    keycloakId: 'kc-me', email: 'me@x.com', name: 'Me',
    organizations: [{ id: 'org-gh', name: 'Ghana', alias: 'ghana', roles: ['approver'] }],
    realmRoles: [],
  }),
}))

const mockDb = {
  user: { findUnique: vi.fn().mockResolvedValue({ id: 'user-me' }), update: vi.fn().mockResolvedValue({}) },
  notification: {
    findMany: vi.fn().mockResolvedValue([]),
    updateMany: vi.fn().mockResolvedValue({ count: 3 }),
    count: vi.fn().mockResolvedValue(2),
  },
  changeRequest: { count: vi.fn().mockResolvedValue(5) },
  accessRequest: { count: vi.fn().mockResolvedValue(0) },
}
vi.mock('@/server/db', () => ({ getPrisma: () => mockDb }))
vi.mock('@/server/approval-authority', () => ({
  listApprovableChanges: vi.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]),
}))

import { getNavCounts, markAllNotificationsRead, setMyLocale } from '@/server/actions/notifications'

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.user.findUnique.mockResolvedValue({ id: 'user-me' })
  mockDb.user.update.mockResolvedValue({})
})

describe('getNavCounts', () => {
  it('returns pendingApprovals, myRequests and unreadNotifications', async () => {
    mockDb.changeRequest.count.mockResolvedValue(5)
    mockDb.notification.count.mockResolvedValue(2)
    mockDb.accessRequest.count.mockResolvedValue(4)
    const counts = await getNavCounts()
    expect(counts).toEqual({ pendingApprovals: 2, myRequests: 5, unreadNotifications: 2, pendingAccessRequests: 4 })
  })
  it('counts only requests needing the requester action (draft + rejected)', async () => {
    await getNavCounts()
    expect(mockDb.changeRequest.count).toHaveBeenCalledWith({
      where: { requesterId: 'user-me', status: { in: ['draft', 'rejected'] } },
    })
  })
  it('scopes pendingAccessRequests to manageable OpCos', async () => {
    await getNavCounts()
    expect(mockDb.accessRequest.count).toHaveBeenCalledWith({
      where: { status: 'pending', opco: { slug: { in: [] } } },
    })
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

describe('setMyLocale', () => {
  it('updates the current user locale by keycloakId', async () => {
    await setMyLocale('fr')
    expect(mockDb.user.update).toHaveBeenCalledWith({
      where: { keycloakId: 'kc-me' }, data: { locale: 'fr' },
    })
  })

  it('coerces unknown values to en and never throws', async () => {
    await expect(setMyLocale('xx' as 'en' | 'fr')).resolves.toBeUndefined()
    expect(mockDb.user.update).toHaveBeenCalledWith({
      where: { keycloakId: 'kc-me' }, data: { locale: 'en' },
    })
  })
})
