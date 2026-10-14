import { describe, it, expect, vi, beforeEach } from "vitest"

const auth = vi.fn()
vi.mock("@/auth", () => ({ auth: () => auth() }))
// Like the real redirect(), throw — so nothing after the gate can run.
const redirect = vi.fn((to: string) => { throw new Error(`NEXT_REDIRECT:${to}`) })
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }))
const mockDb = { feedback: { findMany: vi.fn() } }
vi.mock("@/server/db", () => ({ getPrisma: () => mockDb }))
vi.mock("@/app/(dashboard)/feedback/feedback-client", () => ({ default: () => null }))

import FeedbackPage from "@/app/(dashboard)/feedback/page"

const session = (realmRoles: string[], roles: string[] = []) => ({
  user: { keycloakId: "kc", organizations: roles.length ? [{ id: "o", name: "Ghana", alias: "ghana", roles }] : [], realmRoles },
})

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.feedback.findMany.mockResolvedValue([])
})

describe("FeedbackPage", () => {
  it("redirects a signed-out visitor to login without querying", async () => {
    auth.mockResolvedValue(null)
    await expect(FeedbackPage()).rejects.toThrow("NEXT_REDIRECT:/login")
    expect(mockDb.feedback.findMany).not.toHaveBeenCalled()
  })

  it("redirects a non-group-admin (even an OpCo admin or group auditor) without querying", async () => {
    for (const s of [session([], ["admin"]), session(["group_auditor"])]) {
      auth.mockResolvedValue(s)
      await expect(FeedbackPage()).rejects.toThrow("NEXT_REDIRECT:/")
    }
    expect(mockDb.feedback.findMany).not.toHaveBeenCalled()
  })

  it("lists feedback newest first for a group admin, serialised for the client", async () => {
    auth.mockResolvedValue(session(["group_admin"]))
    mockDb.feedback.findMany.mockResolvedValue([
      {
        id: "fb-1", category: "bug", severity: "major", body: "b", route: "/", changeId: null,
        roles: "group_admin", opcoSlugs: "", createdAt: new Date("2026-10-14T09:00:00Z"),
        triagedAt: null, outcome: null, triageNote: null,
        user: { name: null, email: "ga@csquared.com" },
      },
    ])
    const el = (await FeedbackPage()) as { props: { rows: unknown[] } }
    expect(mockDb.feedback.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { createdAt: "desc" } }))
    expect(el.props.rows).toEqual([
      expect.objectContaining({ id: "fb-1", authorName: "ga@csquared.com", createdAt: "2026-10-14T09:00:00.000Z", triagedAt: null }),
    ])
  })
})
