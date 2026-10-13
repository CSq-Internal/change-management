import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/session", () => ({ getAppSession: vi.fn() }))
vi.mock("@/server/email", () => ({ sendFeedbackEmail: vi.fn().mockResolvedValue(undefined) }))
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "user-agent": "Mozilla/5.0 (Test)" }),
}))

const mockDb = {
  user: { findUnique: vi.fn() },
  feedback: { create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
  auditLog: { create: vi.fn() },
  adminAuditLog: { create: vi.fn() },
}
vi.mock("@/server/db", () => ({ getPrisma: () => mockDb }))

import { submitFeedback, triageFeedback } from "@/server/actions/feedback"
import { getAppSession } from "@/lib/session"
import { sendFeedbackEmail } from "@/server/email"

const member = {
  keycloakId: "kc-ama",
  email: "ama@csquared.com",
  name: "Ama Mensah",
  organizations: [
    { id: "o1", name: "Ghana", alias: "ghana", roles: ["approver"] },
    { id: "o2", name: "Uganda", alias: "uganda", roles: ["requester", "auditor"] },
  ],
  realmRoles: [],
}
const groupAdmin = { keycloakId: "kc-ga", email: "ga@csquared.com", name: "GA", organizations: [], realmRoles: ["group_admin"] }

const SUBMISSION = {
  category: "bug" as const,
  severity: "major" as const,
  body: "  The approve button did nothing  ",
  route: "/changes/abc",
  changeId: null,
  viewport: "1440x900",
  locale: "en" as const,
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.FEEDBACK_INBOX
  vi.mocked(getAppSession).mockResolvedValue(member)
  mockDb.user.findUnique.mockResolvedValue({ id: "ama-db" })
  mockDb.feedback.create.mockResolvedValue({ id: "fb-1" })
  mockDb.feedback.updateMany.mockResolvedValue({ count: 1 })
})

describe("submitFeedback", () => {
  it("takes the author, roles and OpCos from the session, never the payload", async () => {
    await submitFeedback({
      ...SUBMISSION,
      // A forged payload: none of these may reach the row.
      ...({ userId: "someone-else", roles: "group_admin", opcoSlugs: "drc" } as object),
    })
    const { data } = mockDb.feedback.create.mock.calls[0][0]
    expect(data).toMatchObject({
      userId: "ama-db",
      roles: "ghana:approver, uganda:requester, uganda:auditor",
      opcoSlugs: "ghana, uganda",
      category: "bug",
      severity: "major",
      body: "The approve button did nothing",
      route: "/changes/abc",
      locale: "en",
      viewport: "1440x900",
      userAgent: "Mozilla/5.0 (Test)",
      appVersion: "local",
    })
  })

  it("records group-level roles from the session", async () => {
    vi.mocked(getAppSession).mockResolvedValue(groupAdmin)
    await submitFeedback(SUBMISSION)
    const { data } = mockDb.feedback.create.mock.calls[0][0]
    expect(data.roles).toBe("group_admin")
    expect(data.opcoSlugs).toBe("")
  })

  it("forces severity to null for anything but a bug", async () => {
    await submitFeedback({ ...SUBMISSION, category: "confusing", severity: "blocker" })
    expect(mockDb.feedback.create.mock.calls[0][0].data.severity).toBeNull()
  })

  it("returns the stored id", async () => {
    await expect(submitFeedback(SUBMISSION)).resolves.toEqual({ id: "fb-1" })
  })

  it("rejects an empty or whitespace-only body", async () => {
    await expect(submitFeedback({ ...SUBMISSION, body: "   " })).rejects.toThrow(/invalid feedback/i)
    expect(mockDb.feedback.create).not.toHaveBeenCalled()
  })

  it("rejects an unknown category, an over-long body and an unsupported locale", async () => {
    await expect(submitFeedback({ ...SUBMISSION, category: "rant" as never })).rejects.toThrow(/invalid feedback/i)
    await expect(submitFeedback({ ...SUBMISSION, body: "x".repeat(4001) })).rejects.toThrow(/invalid feedback/i)
    await expect(submitFeedback({ ...SUBMISSION, locale: "de" as never })).rejects.toThrow(/invalid feedback/i)
    expect(mockDb.feedback.create).not.toHaveBeenCalled()
  })

  it("drops a changeId that is not a change id", async () => {
    await expect(submitFeedback({ ...SUBMISSION, changeId: "../../etc" })).rejects.toThrow(/invalid feedback/i)
  })

  it("keeps a well-formed changeId", async () => {
    await submitFeedback({ ...SUBMISSION, changeId: "clxyz0123456789abcdefghij" })
    expect(mockDb.feedback.create.mock.calls[0][0].data.changeId).toBe("clxyz0123456789abcdefghij")
  })

  it("writes no audit row — feedback is not a change-control act", async () => {
    await submitFeedback(SUBMISSION)
    expect(mockDb.auditLog.create).not.toHaveBeenCalled()
    expect(mockDb.adminAuditLog.create).not.toHaveBeenCalled()
  })

  it("emails the inbox after storing when FEEDBACK_INBOX is set", async () => {
    process.env.FEEDBACK_INBOX = "cms-feedback@csquared.com"
    await submitFeedback(SUBMISSION)
    expect(sendFeedbackEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "cms-feedback@csquared.com",
        category: "bug",
        route: "/changes/abc",
        authorName: "Ama Mensah",
        roles: "ghana:approver, uganda:requester, uganda:auditor",
        opcoSlugs: "ghana, uganda",
        body: "The approve button did nothing",
      })
    )
  })

  it("still returns the stored id when the email fails", async () => {
    process.env.FEEDBACK_INBOX = "cms-feedback@csquared.com"
    vi.mocked(sendFeedbackEmail).mockRejectedValueOnce(new Error("resend down"))
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    await expect(submitFeedback(SUBMISSION)).resolves.toEqual({ id: "fb-1" })
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })

  it("sends no email when FEEDBACK_INBOX is unset", async () => {
    await submitFeedback(SUBMISSION)
    expect(mockDb.feedback.create).toHaveBeenCalledTimes(1)
    expect(sendFeedbackEmail).not.toHaveBeenCalled()
  })
})

describe("triageFeedback", () => {
  beforeEach(() => {
    vi.mocked(getAppSession).mockResolvedValue(groupAdmin)
    mockDb.user.findUnique.mockResolvedValue({ id: "ga-db" })
    mockDb.feedback.findUnique.mockResolvedValue({ id: "fb-1", triagedAt: null })
  })

  it("is refused for anyone but a group admin", async () => {
    vi.mocked(getAppSession).mockResolvedValue({
      ...member,
      organizations: [{ id: "o1", name: "Ghana", alias: "ghana", roles: ["admin"] }],
    })
    await expect(triageFeedback("fb-1", "fixed", "")).rejects.toThrow(/forbidden/i)
    expect(mockDb.feedback.updateMany).not.toHaveBeenCalled()
  })

  it("records the outcome, trimmed note and triager", async () => {
    const res = await triageFeedback("fb-1", "wont_fix", "  network issue  ")
    const arg = mockDb.feedback.updateMany.mock.calls[0][0]
    expect(arg.where).toEqual({ id: "fb-1", triagedAt: null })
    expect(arg.data).toMatchObject({ outcome: "wont_fix", triageNote: "network issue", triagedById: "ga-db" })
    expect(arg.data.triagedAt).toBeInstanceOf(Date)
    expect(res).toMatchObject({ outcome: "wont_fix", triageNote: "network issue" })
  })

  it("accepts fixed without a note", async () => {
    await triageFeedback("fb-1", "fixed", "")
    expect(mockDb.feedback.updateMany.mock.calls[0][0].data).toMatchObject({ outcome: "fixed", triageNote: null })
  })

  it("requires a note for the judgement-call outcomes", async () => {
    for (const outcome of ["wont_fix", "deferred", "by_design"]) {
      await expect(triageFeedback("fb-1", outcome, "  ")).rejects.toThrow(/note/i)
    }
    expect(mockDb.feedback.updateMany).not.toHaveBeenCalled()
  })

  it("rejects an unknown outcome", async () => {
    await expect(triageFeedback("fb-1", "sorted", "x")).rejects.toThrow(/outcome must be one of/i)
  })

  it("refuses an unknown id", async () => {
    mockDb.feedback.findUnique.mockResolvedValue(null)
    await expect(triageFeedback("nope", "fixed", "")).rejects.toThrow(/not found/i)
    expect(mockDb.feedback.updateMany).not.toHaveBeenCalled()
  })

  it("refuses to re-triage an already-triaged row", async () => {
    mockDb.feedback.findUnique.mockResolvedValue({ id: "fb-1", triagedAt: new Date() })
    await expect(triageFeedback("fb-1", "fixed", "")).rejects.toThrow(/already triaged/i)
    expect(mockDb.feedback.updateMany).not.toHaveBeenCalled()
  })

  it("refuses when another triager won the race", async () => {
    mockDb.feedback.updateMany.mockResolvedValue({ count: 0 })
    await expect(triageFeedback("fb-1", "fixed", "")).rejects.toThrow(/already triaged/i)
  })
})
