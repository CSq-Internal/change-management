// src/test/actions/blackout.test.ts
import { describe, it, expect } from 'vitest'
import { isInBlackout } from '@/server/actions/blackout'

const blackouts = [{
  id: 'b1', opcoId: 'opco-1',
  startsAt: new Date('2026-12-24T00:00:00Z'),
  endsAt: new Date('2026-12-27T23:59:59Z'),
}]

describe('isInBlackout', () => {
  it('returns true when date falls within a blackout', () => {
    expect(isInBlackout(blackouts, new Date('2026-12-25T12:00:00Z'))).toBe(true)
  })
  it('returns false when date is outside all blackouts', () => {
    expect(isInBlackout(blackouts, new Date('2026-12-20T12:00:00Z'))).toBe(false)
  })
  it('returns false for empty blackout list', () => {
    expect(isInBlackout([], new Date())).toBe(false)
  })
})
