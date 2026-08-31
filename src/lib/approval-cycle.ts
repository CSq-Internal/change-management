// src/lib/approval-cycle.ts
// Pure decision-cycle scoping — no DB, no I/O. Unit-tested.
//
// A change collects votes in stages, and a vote only counts within its own stage:
//
//   normal          everything cast since the last `submitted` audit entry. A change can
//                   go rejected → draft → pending again, and earlier votes were cast
//                   against a previous version of the plan.
//   retrospective   everything cast since the change was implemented. An expedited
//                   emergency legitimately collects a normal approval *and* a later
//                   retrospective one from the same person, so the two must not collide.
//
// Both the server action and the detail page derive "has this person already voted?"
// from here, so the button the page offers and the vote the server accepts cannot drift.

export type CycleVote = { approverId: string; decidedAt: Date }

/**
 * Votes cast at or after `since`.
 *
 * A null boundary means the change predates the marker that opens the stage — a legacy
 * row with no `submitted` audit entry, say — so every vote counts. That errs toward
 * treating an old vote as current, which blocks a duplicate rather than admitting one.
 */
export function votesSince<T extends CycleVote>(votes: T[], since: Date | null): T[] {
  if (!since) return votes
  return votes.filter((v) => v.decidedAt >= since)
}

/** True if `userId` has already voted in the stage opened by `since`. */
export function hasVotedSince(
  votes: CycleVote[],
  since: Date | null,
  userId: string
): boolean {
  return votesSince(votes, since).some((v) => v.approverId === userId)
}
