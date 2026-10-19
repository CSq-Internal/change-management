import { describe, it, expect, vi, beforeEach } from 'vitest'

const session = {
  keycloakId: 'kc-admin', organizations: [{ id: 'org-gh', name: 'Ghana', alias: 'ghana', roles: ['admin'] }], realmRoles: [] as string[],
}
vi.mock('@/lib/session', () => ({ getAppSession: vi.fn(async () => session) }))

const tx = {
  user: { findUnique: vi.fn(async () => ({ id: 'user-admin' })) },
  adminAuditLog: { create: vi.fn(async () => ({})) },
  chatWebhook: { create: vi.fn(async () => ({ id: 'w1' })), update: vi.fn(async () => ({ id: 'w1' })), findFirst: vi.fn(async () => null) },
}
const mockDb = {
  opCo: { findUnique: vi.fn(async () => ({ id: 'opco-gh', slug: 'ghana' })) },
  chatWebhook: { findFirst: vi.fn(async () => null), findUnique: vi.fn(), update: vi.fn() },
  $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
}
vi.mock('@/server/db', () => ({ getPrisma: () => mockDb }))

import { upsertChatWebhook, setChatWebhookActive } from '@/server/actions/chat-webhooks'

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

describe('setChatWebhookActive', () => {
  it('audits turning a webhook off, in the same transaction as the change', async () => {
    mockDb.chatWebhook.findUnique.mockResolvedValue({ id: 'w1', opcoId: 'opco-gh', opco: { slug: 'ghana' } })
    await setChatWebhookActive('w1', false)
    expect(tx.chatWebhook.update).toHaveBeenCalledWith({ where: { id: 'w1' }, data: { isActive: false } })
    expect(mockDb.chatWebhook.update).not.toHaveBeenCalled()
    expect(tx.adminAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'chat_webhook_disabled', opcoId: 'opco-gh' }) })
    )
  })

  it('audits turning one back on', async () => {
    mockDb.chatWebhook.findUnique.mockResolvedValue({ id: 'w1', opcoId: null, opco: null })
    session.realmRoles = ['group_admin']
    await setChatWebhookActive('w1', true)
    session.realmRoles = []
    expect(tx.adminAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'chat_webhook_enabled' }) })
    )
  })
})
