import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

vi.mock("@/server/actions/access-requests", () => ({
  approveAccessRequest: vi.fn(),
  denyAccessRequest: vi.fn(),
}))
vi.mock("@/lib/store", () => ({ useStore: () => ({ language: "en" }) }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import AccessRequestsClient from "@/app/(dashboard)/access-requests/access-requests-client"

const row = {
  id: "ar-1",
  note: "Need access",
  createdAt: "2026-06-24T00:00:00.000Z",
  opcoName: "CSquared Ghana",
  opcoSlug: "ghana",
  requesterName: "Bob",
  requesterEmail: "bob@csquared.com",
}

describe("AccessRequestsClient", () => {
  it("renders a pending request with approve/deny actions", () => {
    render(<AccessRequestsClient requests={[row]} />)
    expect(screen.getByText("Bob")).toBeInTheDocument()
    expect(screen.getByText("CSquared Ghana")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Deny" })).toBeInTheDocument()
  })

  it("shows the empty state when there are no requests", () => {
    render(<AccessRequestsClient requests={[]} />)
    expect(screen.getByText("No pending access requests.")).toBeInTheDocument()
  })
})
