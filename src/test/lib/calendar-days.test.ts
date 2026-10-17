import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { localDayKey, chipDay } from '@/lib/calendar'

// The page renders on a UTC server; the viewer is not in UTC. Nairobi is UTC+3.
const savedTz = process.env.TZ
beforeAll(() => { process.env.TZ = 'Africa/Nairobi' })
afterAll(() => { process.env.TZ = savedTz })

describe('localDayKey', () => {
  it('puts 01:00 on 1 Oct in Nairobi on 1 Oct, not on 30 Sep (its UTC day)', () => {
    expect(localDayKey(Date.parse('2026-09-30T22:00:00Z'))).toBe('2026-10-01')
  })
})

describe('chipDay', () => {
  const oct = { first: '2026-10-01', last: '2026-10-31' }
  it('a change inside the month sits on its own start day', () => {
    expect(chipDay(Date.parse('2026-10-14T07:00:00Z'), oct.first, oct.last)).toBe('2026-10-14')
  })
  it('a change that began last month and runs into this one sits on day 1', () => {
    expect(chipDay(Date.parse('2026-09-29T07:00:00Z'), oct.first, oct.last)).toBe('2026-10-01')
  })
  it('a change that starts after the month (local time) is not placed', () => {
    expect(chipDay(Date.parse('2026-10-31T22:00:00Z'), oct.first, oct.last)).toBeNull()
  })
})
