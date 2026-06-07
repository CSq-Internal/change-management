// src/test/lib/risk-score.test.ts
import { describe, it, expect } from 'vitest'
import { riskScore, riskBand } from '@/lib/risk-score'

describe('riskScore', () => {
  it('multiplies likelihood by impact', () => {
    expect(riskScore(3, 4)).toBe(12)
  })
  it('clamps inputs to 1..5', () => {
    expect(riskScore(0, 9)).toBe(5)
    expect(riskScore(7, 7)).toBe(25)
  })
})

describe('riskBand', () => {
  it('maps score ranges to bands', () => {
    expect(riskBand(1)).toBe('low')
    expect(riskBand(4)).toBe('low')
    expect(riskBand(5)).toBe('medium')
    expect(riskBand(9)).toBe('medium')
    expect(riskBand(10)).toBe('high')
    expect(riskBand(15)).toBe('high')
    expect(riskBand(16)).toBe('critical')
    expect(riskBand(25)).toBe('critical')
  })
})
