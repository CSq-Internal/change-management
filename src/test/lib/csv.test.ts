import { describe, it, expect } from 'vitest'
import { csvRow } from '@/lib/csv'

describe('csvRow', () => {
  it('quotes every cell and doubles inner quotes', () => {
    expect(csvRow(['Router "core" update', 'a,b'])).toBe('"Router ""core"" update","a,b"')
  })

  it('writes empty cells for null and undefined', () => {
    expect(csvRow([null, undefined, 3])).toBe('"","","3"')
  })

  it.each(['=HYPERLINK("http://x","y")', '+1+cmd', '-2+cmd', '@SUM(A1)', '\tx', '\rx'])(
    'stops spreadsheets running %j as a formula',
    (cell) => {
      expect(csvRow([cell]).startsWith(`"'`)).toBe(true)
    },
  )
})
