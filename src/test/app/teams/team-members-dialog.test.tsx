import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

vi.mock("@/server/actions/teams", () => ({
  addTeamMember: vi.fn().mockResolvedValue({}),
  removeTeamMember: vi.fn().mockResolvedValue(undefined),
  setTeamMemberRole: vi.fn().mockResolvedValue({}),
  listOpCoMembers: vi.fn().mockResolvedValue([]),
}))
vi.mock("@/components/ui/toaster", () => ({ useToast: () => ({ toast: vi.fn() }) }))

import TeamMembersDialog from "@/app/(dashboard)/teams/team-members-dialog"

describe("TeamMembersDialog", () => {
  it("lists current members with their role", () => {
    render(
      <TeamMembersDialog
        language="en"
        team={{ id: "t1", name: "Core Network", description: null, opco: { name: "Ghana", slug: "ghana" }, members: [{ userId: "u1", name: "Ada", email: "ada@csquared.com", role: "lead" }] }}
        onClose={vi.fn()} onChanged={vi.fn()}
      />
    )
    expect(screen.getByText("ada@csquared.com")).toBeInTheDocument()
    expect(screen.getByText("Lead")).toBeInTheDocument()
  })

  it("shows an empty state with no members", () => {
    render(
      <TeamMembersDialog
        language="en"
        team={{ id: "t1", name: "Core Network", description: null, opco: { name: "Ghana", slug: "ghana" }, members: [] }}
        onClose={vi.fn()} onChanged={vi.fn()}
      />
    )
    expect(screen.getByText("No members yet.")).toBeInTheDocument()
  })
})
