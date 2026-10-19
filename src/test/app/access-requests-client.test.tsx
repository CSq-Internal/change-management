import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

vi.mock("@/server/actions/access-requests", () => ({
  approveAccessRequest: vi.fn(),
  denyAccessRequest: vi.fn(),
}))
vi.mock("@/lib/store", () => ({ useStore: () => ({ language: "en" }) }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
const toast = vi.fn()
vi.mock("@/components/ui/toaster", () => ({ useToast: () => ({ toast }) }))

import AccessRequestsClient from "@/app/(dashboard)/access-requests/access-requests-client"
import { approveAccessRequest } from "@/server/actions/access-requests"

const row = {
  id: "ar-1",
  role: "approver",
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
    expect(screen.getByText("Approver")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Deny" })).toBeInTheDocument()
  })

  it("shows the empty state when there are no requests", () => {
    render(<AccessRequestsClient requests={[]} />)
    expect(screen.getByText("No pending role requests.")).toBeInTheDocument()
  })

  it("locks both buttons while a decision is in flight, so it can't also be denied", async () => {
    let finish!: () => void
    vi.mocked(approveAccessRequest).mockReturnValue(new Promise((r) => { finish = () => r({ ok: true }) }))
    render(<AccessRequestsClient requests={[row]} />)
    fireEvent.click(screen.getByRole("button", { name: "Approve" }))
    expect(screen.getByRole("button", { name: "Deny" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled()
    finish()
    await waitFor(() => expect(screen.getByRole("button", { name: "Deny" })).toBeEnabled())
  })

  it("shows the server's error instead of failing silently", async () => {
    vi.mocked(approveAccessRequest).mockRejectedValue(new Error("Access request already decided"))
    render(<AccessRequestsClient requests={[row]} />)
    fireEvent.click(screen.getByRole("button", { name: "Approve" }))
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ description: "Access request already decided", variant: "error" })),
    )
  })
})
