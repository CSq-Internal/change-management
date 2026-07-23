import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/session', () => ({
  getAppSession: vi.fn().mockResolvedValue({ keycloakId: 'kc-me', organizations: [], realmRoles: [] }),
}))
const mockDb = {
  user: { findUnique: vi.fn().mockResolvedValue({ id: 'user-me' }) },
  notificationPreference: {
    findMany: vi.fn().mockResolvedValue([{ eventType: 'change_approved', channel: 'email', enabled: false }]),
    upsert: vi.fn().mockResolvedValue({}),
  },
}
vi.mock('@/server/db', () => ({ getPrisma: () => mockDb }))

import { getMyPreferences, setMyPreference } from '@/server/actions/notification-prefs'
import { NOTIFY_EVENT_TYPES } from '@/lib/notifications'

beforeEach(() => { vi.clearAllMocks(); mockDb.user.findUnique.mockResolvedValue({ id: 'user-me' }) })

describe('getMyPreferences', () => {
  it('returns the full matrix with defaults on and stored overrides applied', async () => {
    const prefs = await getMyPreferences()
    // Derived, not hardcoded — the matrix grows with the event catalogue.
    expect(prefs).toHaveLength(NOTIFY_EVENT_TYPES.length * 2)
    const approvedEmail = prefs.find((p) => p.eventType === 'change_approved' && p.channel === 'email')
    expect(approvedEmail!.enabled).toBe(false)
    const approvedInApp = prefs.find((p) => p.eventType === 'change_approved' && p.channel === 'in_app')
    expect(approvedInApp!.enabled).toBe(true)
  })
})

describe('setMyPreference', () => {
  it('upserts a preference for the current user', async () => {
    await setMyPreference('sla_escalated', 'email', false)
    expect(mockDb.notificationPreference.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_eventType_channel: { userId: 'user-me', eventType: 'sla_escalated', channel: 'email' } },
      })
    )
  })
})
