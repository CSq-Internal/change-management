import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import TeamList from "@/app/(dashboard)/teams/team-list"
import type { DbTeam } from "@/app/(dashboard)/teams/types"

const teams: DbTeam[] = [
  {
    id: "t1", name: "Core Network", description: null,
    opco: { name: "Ghana", slug: "ghana" },
    members: [{ userId: "u1", name: "Ada", email: "ada@csquared.com", role: "lead" }],
  },
]

describe("TeamList", () => {
  it("renders team rows with OpCo and member count", () => {
    render(
      <TeamList teams={teams} language="en" onEdit={vi.fn()} onMembers={vi.fn()} onDelete={vi.fn()} />
    )
    expect(screen.getByText("Core Network")).toBeInTheDocument()
    expect(screen.getByText("ghana")).toBeInTheDocument()
    expect(screen.getByText("1")).toBeInTheDocument()
  })

  it("shows an empty state when there are no teams", () => {
    render(
      <TeamList teams={[]} language="en" onEdit={vi.fn()} onMembers={vi.fn()} onDelete={vi.fn()} />
    )
    expect(screen.getByText("No teams yet.")).toBeInTheDocument()
  })
})
