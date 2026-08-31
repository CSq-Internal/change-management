import { describe, it, expect } from 'vitest'
import { votesSince, hasVotedSince } from '@/lib/approval-cycle'

const SUBMITTED = new Date('2026-07-20T10:00:00Z')
const BEFORE = new Date('2026-07-19T09:00:00Z')
const AFTER = new Date('2026-07-20T11:00:00Z')

const vote = (approverId: string, decidedAt: Date) => ({ approverId, decidedAt })

describe('votesSince', () => {
  it('keeps votes cast at or after the boundary', () => {
    const votes = [vote('a', AFTER), vote('b', SUBMITTED)]
    expect(votesSince(votes, SUBMITTED)).toHaveLength(2)
  })

  it('drops votes cast before the boundary', () => {
    const votes = [vote('a', BEFORE), vote('b', AFTER)]
    expect(votesSince(votes, SUBMITTED).map((v) => v.approverId)).toEqual(['b'])
  })

  it('keeps every vote when there is no boundary', () => {
    // A legacy row with no `submitted` audit entry: erring toward "this vote is current"
    // blocks a duplicate rather than admitting one.
    const votes = [vote('a', BEFORE), vote('b', AFTER)]
    expect(votesSince(votes, null)).toHaveLength(2)
  })

  it('returns nothing for an empty vote list', () => {
    expect(votesSince([], SUBMITTED)).toEqual([])
  })
})

describe('hasVotedSince', () => {
  it('is true when the user voted inside the stage', () => {
    expect(hasVotedSince([vote('user-1', AFTER)], SUBMITTED, 'user-1')).toBe(true)
  })

  it('is false when the user only voted before the stage opened', () => {
    // The reject → reopen → resubmit case, and the normal vote that precedes a
    // retrospective one: neither should block the new vote.
    expect(hasVotedSince([vote('user-1', BEFORE)], SUBMITTED, 'user-1')).toBe(false)
  })

  it('is false when a different user voted in the stage', () => {
    expect(hasVotedSince([vote('user-2', AFTER)], SUBMITTED, 'user-1')).toBe(false)
  })

  it('distinguishes users when several have voted in the stage', () => {
    const votes = [vote('user-1', BEFORE), vote('user-2', AFTER)]
    expect(hasVotedSince(votes, SUBMITTED, 'user-1')).toBe(false)
    expect(hasVotedSince(votes, SUBMITTED, 'user-2')).toBe(true)
  })
})
