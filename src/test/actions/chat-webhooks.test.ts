import { describe, it, expect, vi, beforeEach } from 'vitest'

const session = {
  keycloakId: 'kc-admin', organizations: [{ id: 'org-gh', name: 'Ghana', alias: 'ghana', roles: ['admin'] }], realmRoles: [],
}
vi.mock('@/lib/session', () => ({ getAppSession: vi.fn(async () => session) }))

const tx = {
  user: { findUnique: vi.fn(async () => ({ id: 'user-admin' })) },
  adminAuditLog: { create: vi.fn(async () => ({})) },
  chatWebhook: { create: vi.fn(async () => ({ id: 'w1' })), update: vi.fn(async () => ({ id: 'w1' })), findFirst: vi.fn(async () => null) },
}
const mockDb = {
  opCo: { findUnique: vi.fn(async () => ({ id: 'opco-gh', slug: 'ghana' })) },
  chatWebhook: { findFirst: vi.fn(async () => null) },
  $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
}
vi.mock('@/server/db', () => ({ getPrisma: () => mockDb }))

import { upsertChatWebhook } from '@/server/actions/chat-webhooks'

beforeEach(() => { vi.clearAllMocks(); mockDb.opCo.findUnique.mockResolvedValue({ id: 'opco-gh', slug: 'ghana' }); mockDb.chatWebhook.findFirst.mockResolvedValue(null) })

describe('upsertChatWebhook', () => {
  it('creates an OpCo webhook for an OpCo admin + audits it', async () => {
    await upsertChatWebhook({ opcoSlug: 'ghana', url: 'https://chat.googleapis.com/v1/spaces/x' })
    expect(tx.chatWebhook.create).toHaveBeenCalled()
    expect(tx.adminAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'chat_webhook_set' }) })
    )
  })

  it('rejects a non-Google-Chat URL', async () => {
    await expect(upsertChatWebhook({ opcoSlug: 'ghana', url: 'https://evil.example/x' })).rejects.toThrow(/chat\.googleapis\.com/)
  })

  it('forbids an OpCo admin configuring the group webhook', async () => {
    await expect(upsertChatWebhook({ opcoSlug: null, url: 'https://chat.googleapis.com/x' })).rejects.toThrow(/Forbidden/i)
  })
})
