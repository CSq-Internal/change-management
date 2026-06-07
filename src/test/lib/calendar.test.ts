// src/test/lib/calendar.test.ts
import { describe, it, expect } from 'vitest'
import { windowsIntersect, computeConflicts, type CalChange, type CalBlackout } from '@/lib/calendar'

const H = 3_600_000
const base = 1_000_000_000_000
const chg = (over: Partial<CalChange>): CalChange => ({
  id: 'c', opcoId: 'o1', infrastructureType: 'Wifi', riskLevel: 'low',
  isEmergency: false, start: base, end: base + 2 * H, ...over,
})

describe('windowsIntersect', () => {
  it('true when windows overlap', () => {
    expect(windowsIntersect(0, 10, 5, 15)).toBe(true)
  })
  it('false when they only touch at the edge (half-open)', () => {
    expect(windowsIntersect(0, 10, 10, 20)).toBe(false)
  })
  it('false when disjoint', () => {
    expect(windowsIntersect(0, 5, 10, 20)).toBe(false)
  })
})

describe('computeConflicts — overlap', () => {
  it('flags two changes, same opco + same infra, overlapping window', () => {
    const a = chg({ id: 'a' })
    const b = chg({ id: 'b', start: base + H })
    const m = computeConflicts([a, b], [])
    expect(m.get('a')!.overlap).toBe(true)
    expect(m.get('a')!.overlapWith).toEqual(['b'])
    expect(m.get('b')!.overlap).toBe(true)
  })

  it('does NOT flag overlap when infrastructureType differs', () => {
    const a = chg({ id: 'a', infrastructureType: 'Wifi' })
    const b = chg({ id: 'b', infrastructureType: 'Backbone IP Network', start: base + H })
    const m = computeConflicts([a, b], [])
    expect(m.get('a')!.overlap).toBe(false)
    expect(m.get('b')!.overlap).toBe(false)
  })

  it('does NOT flag overlap across different opcos', () => {
    const a = chg({ id: 'a', opcoId: 'o1' })
    const b = chg({ id: 'b', opcoId: 'o2', start: base + H })
    const m = computeConflicts([a, b], [])
    expect(m.get('a')!.overlap).toBe(false)
  })

  it('severity is the highest risk among the colliding pair', () => {
    const a = chg({ id: 'a', riskLevel: 'low' })
    const b = chg({ id: 'b', riskLevel: 'high', start: base + H })
    const m = computeConflicts([a, b], [])
    expect(m.get('a')!.severity).toBe('high')
    expect(m.get('b')!.severity).toBe('high')
  })

  it('severity is null when there is no overlap', () => {
    const m = computeConflicts([chg({ id: 'a' })], [])
    expect(m.get('a')!.severity).toBe(null)
  })
})

describe('computeConflicts — blackout', () => {
  it('flags a change whose window intersects its OpCo blackout', () => {
    const a = chg({ id: 'a' })
    const bo: CalBlackout = { id: 'bo', opcoId: 'o1', label: 'Q-end freeze', start: base + H, end: base + 3 * H }
    const m = computeConflicts([a], [bo])
    expect(m.get('a')!.blackout).toBe(true)
    expect(m.get('a')!.blackoutLabels).toEqual(['Q-end freeze'])
  })

  it('applies a group-wide (opcoId null) blackout to any opco', () => {
    const a = chg({ id: 'a', opcoId: 'o9' })
    const bo: CalBlackout = { id: 'bo', opcoId: null, label: 'Group freeze', start: base, end: base + H }
    const m = computeConflicts([a], [bo])
    expect(m.get('a')!.blackout).toBe(true)
  })

  it('does NOT apply another OpCo blackout', () => {
    const a = chg({ id: 'a', opcoId: 'o1' })
    const bo: CalBlackout = { id: 'bo', opcoId: 'o2', label: 'Other', start: base, end: base + H }
    const m = computeConflicts([a], [bo])
    expect(m.get('a')!.blackout).toBe(false)
  })
})
