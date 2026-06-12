import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import DelegationList from "@/app/(dashboard)/delegations/delegation-list"
import type { DbDelegation } from "@/app/(dashboard)/delegations/types"

const rows: DbDelegation[] = [
  {
    id: "d1", opco: { name: "Ghana", slug: "ghana" },
    fromUser: { id: "u1", name: "Ada", email: "ada@csquared.com" },
    toUser: { id: "u2", name: "Bo", email: "bo@csquared.com" },
    validUntil: "2026-12-31T00:00:00.000Z",
  },
]

describe("DelegationList", () => {
  it("renders delegation rows", () => {
    render(<DelegationList delegations={rows} language="en" onRevoke={vi.fn()} />)
    expect(screen.getByText("ada@csquared.com")).toBeInTheDocument()
    expect(screen.getByText("bo@csquared.com")).toBeInTheDocument()
    expect(screen.getByText("ghana")).toBeInTheDocument()
  })

  it("shows an empty state", () => {
    render(<DelegationList delegations={[]} language="en" onRevoke={vi.fn()} />)
    expect(screen.getByText("No active delegations.")).toBeInTheDocument()
  })
})
