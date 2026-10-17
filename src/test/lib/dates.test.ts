import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { toDateTimeLocal } from '@/lib/dates'

// datetime-local inputs hold local wall-clock time, and the form reads them back with
// new Date(value), which is local too. Run in a non-UTC zone so a UTC slice would show.
const savedTz = process.env.TZ
beforeAll(() => { process.env.TZ = 'Africa/Nairobi' }) // UTC+3, no DST
afterAll(() => { process.env.TZ = savedTz })

describe('toDateTimeLocal', () => {
  it('shows the stored instant in local time', () => {
    expect(toDateTimeLocal('2026-10-20T07:00:00.000Z')).toBe('2026-10-20T10:00')
  })

  it('round-trips through the form unchanged', () => {
    const stored = '2026-10-20T07:00:00.000Z'
    expect(new Date(toDateTimeLocal(stored)).toISOString()).toBe(stored)
  })

  it('crosses midnight into the local day', () => {
    expect(toDateTimeLocal('2026-10-31T22:30:00.000Z')).toBe('2026-11-01T01:30')
  })

  it('is empty for no value', () => {
    expect(toDateTimeLocal(null)).toBe('')
  })
})
