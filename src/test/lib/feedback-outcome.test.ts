import { describe, it, expect } from "vitest"
import {
  FEEDBACK_OUTCOMES,
  isFeedbackOutcome,
  requiresNote,
  assertTriageDecision,
} from "@/lib/feedback-outcome"

describe("the outcome vocabulary", () => {
  it("is exactly the five outcomes a triager may choose", () => {
    expect(FEEDBACK_OUTCOMES).toEqual(["fixed", "wont_fix", "deferred", "duplicate", "by_design"])
  })

  it("rejects anything outside the set", () => {
    for (const v of ["FIXED", "done", "unknown", "", null, undefined, 1, {}]) {
      expect(isFeedbackOutcome(v), String(v)).toBe(false)
    }
  })
})

describe("assertTriageDecision", () => {
  it("accepts fixed with no note", () => {
    expect(assertTriageDecision("fixed", "")).toEqual({ outcome: "fixed", note: null })
  })

  it("accepts duplicate with no note", () => {
    expect(assertTriageDecision("duplicate", undefined)).toEqual({ outcome: "duplicate", note: null })
  })

  it("demands a note for the judgement calls", () => {
    for (const outcome of ["wont_fix", "deferred", "by_design"] as const) {
      expect(requiresNote(outcome)).toBe(true)
      expect(() => assertTriageDecision(outcome, "")).toThrow(/note/i)
    }
    expect(requiresNote("fixed")).toBe(false)
    expect(requiresNote("duplicate")).toBe(false)
  })

  it("does not accept whitespace as a reason", () => {
    expect(() => assertTriageDecision("wont_fix", "   ")).toThrow(/note/i)
  })

  it("trims the note it stores, and keeps an optional note when given", () => {
    expect(assertTriageDecision("wont_fix", "  reporter said it was the network  ")).toEqual({
      outcome: "wont_fix",
      note: "reporter said it was the network",
    })
    expect(assertTriageDecision("fixed", " PR #155 ")).toEqual({ outcome: "fixed", note: "PR #155" })
  })

  it("refuses an unknown verdict", () => {
    expect(() => assertTriageDecision("sorted", "x")).toThrow(/outcome must be one of/i)
  })
})
