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
  it('has 18 event types and 6 chat broadcast types', () => {
    expect(NOTIFY_EVENT_TYPES).toHaveLength(18)
    expect(CHAT_BROADCAST_TYPES).toHaveLength(6)
    // approval_requested is a personal call to action, not channel news.
    expect(CHAT_BROADCAST_TYPES).not.toContain('approval_requested')
  })
})

// ── Notification expansion (Spec B) ─────────────────────────────────────────
import { NOTIFY_EVENT_GROUPS, DEFAULT_CHANNELS, type NotifyEventType } from '@/lib/notifications'

describe('event catalog', () => {
  it('has 18 event types', () => {
    expect(NOTIFY_EVENT_TYPES).toHaveLength(18)
  })

  it('groups cover every type exactly once', () => {
    const grouped = NOTIFY_EVENT_GROUPS.flatMap((g) => g.types)
    expect(grouped).toHaveLength(NOTIFY_EVENT_TYPES.length)
    expect(new Set(grouped).size).toBe(NOTIFY_EVENT_TYPES.length)
    for (const t of NOTIFY_EVENT_TYPES) expect(grouped).toContain(t)
  })

  it('DEFAULT_CHANNELS has an entry for every type', () => {
    for (const t of NOTIFY_EVENT_TYPES) expect(DEFAULT_CHANNELS[t]).toBeDefined()
  })

  it('preserves the five pre-existing types as email+in-app on', () => {
    const existing: NotifyEventType[] = [
      'approval_requested', 'change_approved', 'change_rejected', 'sla_escalated', 'emergency_submitted',
    ]
    for (const t of existing) expect(DEFAULT_CHANNELS[t]).toEqual({ email: true, in_app: true })
  })

  it('ambient lifecycle events default to in-app only', () => {
    const ambient: NotifyEventType[] = [
      'change_closed', 'change_reopened', 'change_cancelled', 'change_rescheduled', 'assignee_removed',
    ]
    for (const t of ambient) expect(DEFAULT_CHANNELS[t]).toEqual({ email: false, in_app: true })
  })

  it('subject-of-the-event types default to email on', () => {
    const loud: NotifyEventType[] = [
      'change_submitted', 'change_implemented', 'change_verified',
      'assignee_added', 'retro_approved', 'retro_rejected', 'retro_overdue', 'approver_nudge',
    ]
    for (const t of loud) expect(DEFAULT_CHANNELS[t].email).toBe(true)
  })

  it('broadcasts exactly six types to chat', () => {
    expect([...CHAT_BROADCAST_TYPES].sort()).toEqual([
      'change_approved', 'change_implemented', 'change_rejected',
      'change_verified', 'emergency_submitted', 'sla_escalated',
    ])
  })
})

describe('isChannelEnabled — DEFAULT_CHANNELS fallback', () => {
  it('falls back to the per-event default when no row exists', () => {
    const prefs = new Map<string, boolean>()
    expect(isChannelEnabled(prefs, 'u1', 'change_closed', 'email')).toBe(false)
    expect(isChannelEnabled(prefs, 'u1', 'change_closed', 'in_app')).toBe(true)
    expect(isChannelEnabled(prefs, 'u1', 'change_implemented', 'email')).toBe(true)
  })

  it('a stored row always wins over the default', () => {
    const prefs = new Map([['u1:change_closed:email', true], ['u1:change_implemented:email', false]])
    expect(isChannelEnabled(prefs, 'u1', 'change_closed', 'email')).toBe(true)
    expect(isChannelEnabled(prefs, 'u1', 'change_implemented', 'email')).toBe(false)
  })
})

describe('notificationContent — new types', () => {
  const newTypes: NotifyEventType[] = [
    'change_submitted', 'change_implemented', 'change_verified', 'change_closed',
    'change_reopened', 'change_cancelled', 'change_rescheduled', 'assignee_added',
    'assignee_removed', 'retro_approved', 'retro_rejected', 'retro_overdue', 'approver_nudge',
  ]

  it('returns non-empty EN copy for every new type', () => {
    for (const t of newTypes) {
      const { title, body } = notificationContent(t, 'Router upgrade', {}, 'en')
      expect(title.length).toBeGreaterThan(0)
      expect(body).toContain('Router upgrade')
    }
  })

  it('returns non-empty FR copy distinct from EN for every new type', () => {
    for (const t of newTypes) {
      const en = notificationContent(t, 'Router upgrade', {}, 'en')
      const fr = notificationContent(t, 'Router upgrade', {}, 'fr')
      expect(fr.title.length).toBeGreaterThan(0)
      expect(fr.title).not.toBe(en.title)
    }
  })

  it('interpolates the reschedule window', () => {
    const { body } = notificationContent(
      'change_rescheduled', 'Router upgrade',
      { windowFrom: '12 Aug 22:00', windowTo: '19 Aug 22:00' }, 'en',
    )
    expect(body).toContain('19 Aug 22:00')
  })

  it('interpolates the assignee role', () => {
    const { body } = notificationContent('assignee_added', 'Router upgrade', { role: 'approver' }, 'en')
    expect(body).toContain('approver')
  })
})
