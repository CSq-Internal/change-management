// What was decided about a piece of feedback.
//
// Stored as a VARCHAR, not a Postgres enum, so a new outcome needs no ALTER TYPE. The set is
// pinned here and validated on the way in; the database only enforces that a triaged row
// HAS an outcome (CHECK feedback_triage_needs_outcome).

export const FEEDBACK_OUTCOMES = [
  /** Shipped. The note should name the release or PR. */
  "fixed",
  /** Deliberately not doing it. The note must say why. */
  "wont_fix",
  /** Will do, not now. The note must say what it is waiting on. */
  "deferred",
  /** Already reported. The note should name what it duplicates. */
  "duplicate",
  /** Works as intended. The note must explain the intent. */
  "by_design",
] as const

export type FeedbackOutcome = (typeof FEEDBACK_OUTCOMES)[number]

// fixed and duplicate point at something findable (a PR, another report); the other three
// are judgement calls, and a judgement with no reason recorded is what this field ends.
const NOTE_REQUIRED: ReadonlySet<FeedbackOutcome> = new Set(["wont_fix", "deferred", "by_design"])

export function isFeedbackOutcome(value: unknown): value is FeedbackOutcome {
  return typeof value === "string" && (FEEDBACK_OUTCOMES as readonly string[]).includes(value)
}

export function requiresNote(outcome: FeedbackOutcome): boolean {
  return NOTE_REQUIRED.has(outcome)
}

/**
 * Validate a triage decision or throw. Returns the trimmed note (empty → null) so a caller
 * cannot satisfy the note requirement with whitespace.
 */
export function assertTriageDecision(
  outcome: unknown,
  note: unknown
): { outcome: FeedbackOutcome; note: string | null } {
  if (!isFeedbackOutcome(outcome)) {
    throw new Error(`outcome must be one of ${FEEDBACK_OUTCOMES.join(", ")}`)
  }
  const trimmed = typeof note === "string" ? note.trim() : ""
  if (requiresNote(outcome) && trimmed === "") {
    throw new Error(`${outcome} needs a note saying why`)
  }
  return { outcome, note: trimmed === "" ? null : trimmed }
}
