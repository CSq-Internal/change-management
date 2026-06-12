// src/test/actions/teams.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/session", () => ({
  getAppSession: vi.fn().mockResolvedValue({
    keycloakId: "kc-ghr",
    organizations: [{ id: "o", name: "Ghana", alias: "ghana", roles: ["requester"] }],
    realmRoles: [],
  }),
}))

const mockDb = {
  $transaction: vi.fn(async (fn: (tx: typeof mockDb) => unknown) => fn(mockDb)),
  opCo: { findUnique: vi.fn().mockResolvedValue({ id: "opco-gh", slug: "ghana" }) },
  team: {
    create: vi.fn().mockResolvedValue({ id: "team-1", name: "Core Network" }),
    update: vi.fn().mockResolvedValue({ id: "team-1", name: "Renamed" }),
    delete: vi.fn().mockResolvedValue({}),
    findUnique: vi.fn().mockResolvedValue({ id: "team-1", opcoId: "opco-gh", opco: { slug: "ghana" } }),
  },
  teamMember: {
    upsert: vi.fn().mockResolvedValue({ id: "tm-1", role: "member" }),
    delete: vi.fn().mockResolvedValue({}),
    deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
    update: vi.fn().mockResolvedValue({ id: "tm-1", role: "lead" }),
  },
  userOpCoAssignment: {
    findFirst: vi.fn().mockResolvedValue({ id: "a1" }),
    findMany: vi.fn().mockResolvedValue([
      { user: { id: "u1", name: "Ada", email: "ada@csquared.com" } },
      { user: { id: "u2", name: "Bo", email: "bo@csquared.com" } },
    ]),
  },
  user: { findUnique: vi.fn().mockResolvedValue({ id: "actor-db" }) },
  adminAuditLog: { create: vi.fn().mockResolvedValue({}) },
}

vi.mock("@/server/db", () => ({ getPrisma: () => mockDb }))

import {
  createTeam,
  updateTeam,
  deleteTeam,
  addTeamMember,
  removeTeamMember,
  setTeamMemberRole,
  listOpCoMembers,
} from "@/server/actions/teams"
import { getAppSession } from "@/lib/session"

const groupAdmin = { keycloakId: "kc-ga", email: "ga@test.com", name: "Group Admin", organizations: [], realmRoles: ["group_admin"] }
const ghanaAdmin = {
  keycloakId: "kc-gha",
  email: "gha@test.com",
  name: "Ghana Admin",
  organizations: [{ id: "o", name: "Ghana", alias: "ghana", roles: ["admin"] }],
  realmRoles: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.$transaction.mockImplementation(async (fn: (tx: typeof mockDb) => unknown) => fn(mockDb))
})

describe("createTeam", () => {
  it("rejects a non-admin OpCo member", async () => {
    await expect(createTeam({ opcoSlug: "ghana", name: "Core" })).rejects.toThrow(/Forbidden/)
  })

  it("rejects an OpCo admin creating in an OpCo they don't administer", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAdmin)
    await expect(createTeam({ opcoSlug: "uganda", name: "Core" })).rejects.toThrow(/Forbidden/)
  })

  it("lets a group_admin create a team and writes an audit row", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    const team = await createTeam({ opcoSlug: "ghana", name: "Core Network", description: "Backbone" })
    expect(team).toHaveProperty("id", "team-1")
    expect(mockDb.team.create).toHaveBeenCalledTimes(1)
    expect(mockDb.adminAuditLog.create).toHaveBeenCalledTimes(1)
  })

  it("lets an OpCo admin create a team in their OpCo", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAdmin)
    await createTeam({ opcoSlug: "ghana", name: "Field Ops" })
    expect(mockDb.team.create).toHaveBeenCalledTimes(1)
  })
})

describe("updateTeam", () => {
  it("rejects a non-admin", async () => {
    await expect(updateTeam("team-1", { name: "Renamed" })).rejects.toThrow(/Forbidden/)
  })

  it("lets an admin rename a team and writes an audit row", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAdmin)
    await updateTeam("team-1", { name: "Renamed" })
    expect(mockDb.team.update).toHaveBeenCalledTimes(1)
    expect(mockDb.adminAuditLog.create).toHaveBeenCalledTimes(1)
  })
})

describe("deleteTeam", () => {
  it("rejects a non-admin", async () => {
    await expect(deleteTeam("team-1")).rejects.toThrow(/Forbidden/)
  })

  it("deletes members then the team and writes an audit row", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    await deleteTeam("team-1")
    expect(mockDb.teamMember.deleteMany).toHaveBeenCalledWith({ where: { teamId: "team-1" } })
    expect(mockDb.team.delete).toHaveBeenCalledTimes(1)
    expect(mockDb.adminAuditLog.create).toHaveBeenCalledTimes(1)
  })
})

describe("addTeamMember", () => {
  it("rejects a non-admin", async () => {
    await expect(addTeamMember("team-1", "user-2", "member")).rejects.toThrow(/Forbidden/)
  })

  it("rejects a user who is not assigned to the team's OpCo", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAdmin)
    mockDb.userOpCoAssignment.findFirst.mockResolvedValueOnce(null)
    await expect(addTeamMember("team-1", "outsider", "member")).rejects.toThrow(/not assigned/i)
  })

  it("adds an eligible member and writes an audit row", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAdmin)
    await addTeamMember("team-1", "user-2", "lead")
    expect(mockDb.teamMember.upsert).toHaveBeenCalledTimes(1)
    expect(mockDb.adminAuditLog.create).toHaveBeenCalledTimes(1)
  })
})

describe("removeTeamMember", () => {
  it("rejects a non-admin", async () => {
    await expect(removeTeamMember("team-1", "user-2")).rejects.toThrow(/Forbidden/)
  })

  it("removes a member and writes an audit row", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(groupAdmin)
    await removeTeamMember("team-1", "user-2")
    expect(mockDb.teamMember.delete).toHaveBeenCalledWith({
      where: { teamId_userId: { teamId: "team-1", userId: "user-2" } },
    })
    expect(mockDb.adminAuditLog.create).toHaveBeenCalledTimes(1)
  })
})

describe("setTeamMemberRole", () => {
  it("rejects a non-admin", async () => {
    await expect(setTeamMemberRole("team-1", "user-2", "lead")).rejects.toThrow(/Forbidden/)
  })

  it("updates a member's role and writes an audit row", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAdmin)
    await setTeamMemberRole("team-1", "user-2", "lead")
    expect(mockDb.teamMember.update).toHaveBeenCalledWith({
      where: { teamId_userId: { teamId: "team-1", userId: "user-2" } },
      data: { role: "lead" },
    })
    expect(mockDb.adminAuditLog.create).toHaveBeenCalledTimes(1)
  })
})

describe("listOpCoMembers", () => {
  it("rejects a non-admin", async () => {
    await expect(listOpCoMembers("ghana")).rejects.toThrow(/Forbidden/)
  })

  it("returns the OpCo's active-assignment users for an admin", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ghanaAdmin)
    const members = await listOpCoMembers("ghana")
    expect(mockDb.userOpCoAssignment.findMany).toHaveBeenCalledWith({
      where: { opco: { slug: "ghana" }, isActive: true },
      select: { user: { select: { id: true, name: true, email: true } } },
      distinct: ["userId"],
    })
    expect(members).toEqual([
      { id: "u1", name: "Ada", email: "ada@csquared.com" },
      { id: "u2", name: "Bo", email: "bo@csquared.com" },
    ])
  })
})
