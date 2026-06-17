// src/test/server/notify.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDb = {
  notificationPreference: { findMany: vi.fn().mockResolvedValue([]) },
  notification: { create: vi.fn().mockResolvedValue({}) },
  chatWebhook: { findMany: vi.fn().mockResolvedValue([]) },
  user: { findMany: vi.fn().mockResolvedValue([]) },
  opCo: { findUnique: vi.fn().mockResolvedValue({ locale: 'en' }) },
}
vi.mock('@/server/db', () => ({ getPrisma: () => mockDb }))

vi.mock('@/server/email', () => ({
  sendApprovalRequestEmail: vi.fn().mockResolvedValue(undefined),
  sendStatusChangeEmail: vi.fn().mockResolvedValue(undefined),
  sendSlaEscalationEmail: vi.fn().mockResolvedValue(undefined),
  sendEmergencyAlertEmail: vi.fn().mockResolvedValue(undefined),
}))

import { notifyEvent } from '@/server/notify'
import * as email from '@/server/email'

const change = { id: 'c1', title: 'Core upgrade', opcoId: 'opco-1' }
const ada = { userId: 'u1', email: 'ada@x.com', name: 'Ada' }

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.notificationPreference.findMany.mockResolvedValue([])
  mockDb.chatWebhook.findMany.mockResolvedValue([])
  mockDb.user.findMany.mockResolvedValue([])
  mockDb.opCo.findUnique.mockResolvedValue({ locale: 'en' })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
})

describe('notifyEvent', () => {
  it('creates an in-app notification and sends an email by default (no prefs)', async () => {
    await notifyEvent({ type: 'change_approved', recipients: [ada], change })
    expect(mockDb.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'u1', type: 'change_approved', changeId: 'c1' }) })
    )
    expect(email.sendStatusChangeEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'ada@x.com', newStatus: 'approved' }))
  })

  it('skips the in_app channel when muted', async () => {
    mockDb.notificationPreference.findMany.mockResolvedValue([
      { userId: 'u1', eventType: 'change_approved', channel: 'in_app', enabled: false },
    ])
    await notifyEvent({ type: 'change_approved', recipients: [ada], change })
    expect(mockDb.notification.create).not.toHaveBeenCalled()
    expect(email.sendStatusChangeEmail).toHaveBeenCalled()
  })

  it('posts to chat webhooks for a broadcast event', async () => {
    mockDb.chatWebhook.findMany.mockResolvedValue([{ url: 'https://chat.googleapis.com/x', opcoId: 'opco-1' }])
    await notifyEvent({ type: 'emergency_submitted', recipients: [ada], change, context: { requesterName: 'Ada' } })
    expect(globalThis.fetch).toHaveBeenCalledWith('https://chat.googleapis.com/x', expect.objectContaining({ method: 'POST' }))
  })

  it('does NOT query chat webhooks for a non-broadcast event', async () => {
    await notifyEvent({ type: 'approval_requested', recipients: [ada], change })
    expect(mockDb.chatWebhook.findMany).not.toHaveBeenCalled()
  })

  it('is best-effort: a throwing email does not break others', async () => {
    vi.mocked(email.sendStatusChangeEmail).mockRejectedValueOnce(new Error('smtp down'))
    await expect(notifyEvent({ type: 'change_approved', recipients: [ada], change })).resolves.toBeUndefined()
    expect(mockDb.notification.create).toHaveBeenCalled()
  })

  it('uses the recipient User.locale (fr) even when the OpCo is en', async () => {
    mockDb.user.findMany.mockResolvedValue([{ id: 'u1', locale: 'fr' }])
    mockDb.opCo.findUnique.mockResolvedValue({ locale: 'en' })
    await notifyEvent({ type: 'change_approved', recipients: [ada], change })
    expect(mockDb.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ title: 'Changement approuvé' }) })
    )
  })

  it('falls back to the OpCo locale when the user has none', async () => {
    mockDb.user.findMany.mockResolvedValue([{ id: 'u1', locale: null }])
    mockDb.opCo.findUnique.mockResolvedValue({ locale: 'fr' })
    await notifyEvent({ type: 'change_approved', recipients: [ada], change })
    expect(mockDb.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ title: 'Changement approuvé' }) })
    )
  })

  it('broadcasts chat in the OpCo locale', async () => {
    mockDb.opCo.findUnique.mockResolvedValue({ locale: 'fr' })
    mockDb.chatWebhook.findMany.mockResolvedValue([{ url: 'https://chat.googleapis.com/x', opcoId: 'opco-1' }])
    await notifyEvent({ type: 'change_approved', recipients: [ada], change })
    const body = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string)
    expect(body.text).toMatch(/Changement approuvé/)
  })
})
