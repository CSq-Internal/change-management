// src/test/lib/sla.test.ts
import { describe, it, expect } from 'vitest'
import { dueEscalationLevel, SLA_HOURS } from '@/lib/sla'

const H = 3_600_000
const deadline = 1_000_000_000_000 // arbitrary epoch ms

describe('dueEscalationLevel', () => {
  it('returns 0 before the deadline', () => {
    expect(dueEscalationLevel(deadline, 4, deadline - 1)).toBe(0)
  })

  it('returns 1 exactly at the deadline', () => {
    expect(dueEscalationLevel(deadline, 4, deadline)).toBe(1)
  })

  it('returns 1 within the first 50% of the window past deadline', () => {
    expect(dueEscalationLevel(deadline, 4, deadline + 2 * H - 1)).toBe(1)
  })

  it('returns 2 once 50% of the window has elapsed past deadline', () => {
    expect(dueEscalationLevel(deadline, 4, deadline + 2 * H)).toBe(2)
  })

  it('scales the half-window with the risk window (48h low risk)', () => {
    expect(dueEscalationLevel(deadline, 48, deadline + 23 * H)).toBe(1)
    expect(dueEscalationLevel(deadline, 48, deadline + 24 * H)).toBe(2)
  })
})

describe('SLA_HOURS', () => {
  it('matches the documented risk windows', () => {
    expect(SLA_HOURS).toEqual({ low: 48, medium: 24, high: 4, emergency: 1 })
  })
})
