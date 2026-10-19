import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { toDateTimeLocal, dayStart, dayEnd, utcStamp } from '@/lib/dates'

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

describe('dayStart / dayEnd', () => {
  // A date input gives "YYYY-MM-DD"; new Date() of that is UTC midnight, which drops the
  // last day of an "until" range and three local hours from the start of a "from".
  it('a delegation "until" today lasts to the end of today, local time', () => {
    expect(dayEnd('2026-10-17').toISOString()).toBe('2026-10-17T20:59:59.999Z')
  })

  it('a From = To = today search covers the whole local day', () => {
    expect(dayStart('2026-10-17').toISOString()).toBe('2026-10-16T21:00:00.000Z')
    expect(dayEnd('2026-10-17').getTime() - dayStart('2026-10-17').getTime()).toBe(86_400_000 - 1)
  })
})

describe('utcStamp', () => {
  // Emails, Chat and the evidence PDF are rendered on the server for readers in several
  // zones, so a bare time is ambiguous. Nairobi is set above: the stamp must not follow it.
  it('labels the time as UTC, whatever the server zone', () => {
    expect(utcStamp(new Date('2026-10-20T07:05:00Z'))).toBe('2026-10-20 07:05 UTC')
  })
})
