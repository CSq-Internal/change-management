// src/test/lib/notifications.test.ts
import { describe, it, expect } from 'vitest'
import {
  notificationContent, isChannelEnabled, chatMessageText,
  NOTIFY_EVENT_TYPES, CHAT_BROADCAST_TYPES,
} from '@/lib/notifications'

describe('notificationContent', () => {
  it('builds copy for each event type', () => {
    expect(notificationContent('change_approved', 'Core upgrade', {}).title).toMatch(/approved/i)
    expect(notificationContent('change_rejected', 'Core upgrade', {}).title).toMatch(/rejected/i)
    expect(notificationContent('sla_escalated', 'Core upgrade', { level: 2 }).body).toMatch(/Core upgrade/)
    expect(notificationContent('emergency_submitted', 'Core upgrade', { requesterName: 'Ada' }).body).toMatch(/Ada/)
    expect(notificationContent('approval_requested', 'Core upgrade', {}).body).toMatch(/approval/i)
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
    expect(chatMessageText('emergency_submitted', 'Core upgrade', {})).toMatch(/Core upgrade/)
  })
})

describe('constants', () => {
  it('has 5 event types and 4 chat broadcast types', () => {
    expect(NOTIFY_EVENT_TYPES).toHaveLength(5)
    expect(CHAT_BROADCAST_TYPES).toHaveLength(4)
    expect(CHAT_BROADCAST_TYPES).not.toContain('approval_requested')
  })
})
