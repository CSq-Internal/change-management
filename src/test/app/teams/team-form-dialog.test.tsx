import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

vi.mock("@/server/actions/teams", () => ({
  createTeam: vi.fn().mockResolvedValue({ id: "t-new" }),
  updateTeam: vi.fn().mockResolvedValue({ id: "t1" }),
}))
vi.mock("@/components/ui/toaster", () => ({ useToast: () => ({ toast: vi.fn() }) }))

import TeamFormDialog from "@/app/(dashboard)/teams/team-form-dialog"

describe("TeamFormDialog", () => {
  it("renders create mode with an OpCo picker", () => {
    render(
      <TeamFormDialog language="en" manageableSlugs={["ghana", "uganda"]} team={null} onClose={vi.fn()} onSaved={vi.fn()} />
    )
    expect(screen.getByText("Create team")).toBeInTheDocument()
    expect(screen.getByText("ghana")).toBeInTheDocument()
  })

  it("renders edit mode pre-filled with the team name", () => {
    render(
      <TeamFormDialog
        language="en" manageableSlugs={["ghana"]}
        team={{ id: "t1", name: "Core Network", description: null, opco: { name: "Ghana", slug: "ghana" }, members: [] }}
        onClose={vi.fn()} onSaved={vi.fn()}
      />
    )
    expect(screen.getByText("Edit team")).toBeInTheDocument()
    expect(screen.getByDisplayValue("Core Network")).toBeInTheDocument()
  })
})
