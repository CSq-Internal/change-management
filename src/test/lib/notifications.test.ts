// src/test/lib/notifications.test.ts
import { describe, it, expect } from 'vitest'
import {
  notificationContent, isChannelEnabled, chatMessageText,
  NOTIFY_EVENT_TYPES, CHAT_BROADCAST_TYPES,
} from '@/lib/notifications'

describe('notificationContent', () => {
  it('builds copy for each event type', () => {
    expect(notificationContent('change_approved', 'Core upgrade', {}, 'en').title).toMatch(/approved/i)
    expect(notificationContent('change_rejected', 'Core upgrade', {}, 'en').title).toMatch(/rejected/i)
    expect(notificationContent('sla_escalated', 'Core upgrade', { level: 2 }, 'en').body).toMatch(/Core upgrade/)
    expect(notificationContent('emergency_submitted', 'Core upgrade', { requesterName: 'Ada' }, 'en').body).toMatch(/Ada/)
    expect(notificationContent('approval_requested', 'Core upgrade', {}, 'en').body).toMatch(/approval/i)
  })
})

describe('notificationContent localization', () => {
  it('returns English copy when locale="en"', () => {
    expect(notificationContent('change_approved', 'Core upgrade', {}, 'en').title).toBe('Change approved')
    expect(notificationContent('sla_escalated', 'Core upgrade', { level: 2 }, 'en').body).toMatch(/breached its SLA/)
  })
  it('returns French copy when locale="fr"', () => {
    expect(notificationContent('change_approved', 'Core upgrade', {}, 'fr').title).toBe('Changement approuvé')
    expect(notificationContent('sla_escalated', 'Core upgrade', { level: 2 }, 'fr').title).toMatch(/SLA dépassé/)
    expect(notificationContent('emergency_submitted', 'Core upgrade', { requesterName: 'Ada' }, 'fr').body).toMatch(/Ada/)
  })
})

describe('isChannelEnabled', () => {
  it('defaults to on when no preference row exists', () => {
    expect(isChannelEnabled(new Map(), 'u1', 'change_approved', 'email')).toBe(true)
  })
  it('respects an explicit off', () => {
    const prefs = new Map([['u1:change_approved:email', false]])
    expect(isChannelEnabled(prefs, 'u1', 'change_approved', 'email')).toBe(false)
    expect(isChannelEnabled(prefs, 'u1', 'change_approved', 'in_app')).toBe(true)
  })
})

describe('chatMessageText', () => {
  it('produces a one-line message mentioning the change', () => {
    expect(chatMessageText('emergency_submitted', 'Core upgrade', {}, 'en')).toMatch(/Core upgrade/)
  })
})

describe('chatMessageText localization', () => {
  it('returns English chat copy when locale="en"', () => {
    expect(chatMessageText('change_approved', 'Core upgrade', {}, 'en')).toMatch(/Change approved/)
  })
  it('returns French chat copy when locale="fr"', () => {
    expect(chatMessageText('change_approved', 'Core upgrade', {}, 'fr')).toMatch(/Changement approuvé/)
    expect(chatMessageText('sla_escalated', 'Core upgrade', { level: 3 }, 'fr')).toMatch(/niveau 3/)
  })
})

describe('constants', () => {
  it('has 5 event types and 4 chat broadcast types', () => {
    expect(NOTIFY_EVENT_TYPES).toHaveLength(5)
    expect(CHAT_BROADCAST_TYPES).toHaveLength(4)
    expect(CHAT_BROADCAST_TYPES).not.toContain('approval_requested')
  })
})
