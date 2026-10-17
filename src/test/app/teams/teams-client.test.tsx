import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import type { DbTeam } from "@/app/(dashboard)/teams/types"

vi.mock("@/server/actions/teams", () => ({
  deleteTeam: vi.fn(), addTeamMember: vi.fn(), removeTeamMember: vi.fn(), setTeamMemberRole: vi.fn(),
  listOpCoMembers: vi.fn().mockResolvedValue([]),
}))
vi.mock("@/components/ui/toaster", () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock("@/lib/store", () => ({ useStore: () => ({ language: "en" }) }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { organizations: [], realmRoles: ["group_admin"] } } }) }))

import TeamsClient from "@/app/(dashboard)/teams/teams-client"

const team = (members: DbTeam["members"]): DbTeam => ({
  id: "t1", name: "Core Network", description: null, opco: { name: "Ghana", slug: "ghana" }, members,
})

describe("TeamsClient", () => {
  it("the open members dialog shows a member added since it opened (after the refresh)", () => {
    const { rerender } = render(<TeamsClient teams={[team([])]} manageableSlugs={["ghana"]} />)
    fireEvent.click(screen.getByRole("button", { name: /members/i }))
    expect(screen.getByText("No members yet.")).toBeInTheDocument()
    // router.refresh() delivers new props; the dialog must read them, not a snapshot.
    rerender(<TeamsClient teams={[team([{ userId: "u1", name: "Alice", email: "alice@csquared.com", role: "member" }])]} manageableSlugs={["ghana"]} />)
    expect(screen.getByText("alice@csquared.com")).toBeInTheDocument()
  })
})
