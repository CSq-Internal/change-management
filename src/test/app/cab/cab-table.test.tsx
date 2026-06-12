import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import CabTable from "@/app/(dashboard)/cab/cab-table"
import type { CabMember } from "@/app/(dashboard)/cab/types"

const members: CabMember[] = [
  { id: "c1", userId: "u1", name: "Ada", email: "ada@csquared.com", opco: { name: "Ghana", slug: "ghana" } },
]

describe("CabTable", () => {
  it("renders members with the OpCo column", () => {
    render(<CabTable members={members} language="en" showOpco onRemove={vi.fn()} />)
    expect(screen.getByText("ada@csquared.com")).toBeInTheDocument()
    expect(screen.getByText("ghana")).toBeInTheDocument()
  })

  it("shows an empty state", () => {
    render(<CabTable members={[]} language="en" showOpco={false} onRemove={vi.fn()} />)
    expect(screen.getByText("No CAB members yet.")).toBeInTheDocument()
  })
})
