import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react"

const { submitApproval, refresh } = vi.hoisted(() => ({
  submitApproval: vi.fn(),
  refresh: vi.fn(),
}))
vi.mock("@/server/actions/approvals", () => ({ submitApproval }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))
vi.mock("@/lib/store", () => ({ useStore: () => ({ language: "en" }) }))
vi.mock("@/components/ui/toaster", () => ({ useToast: () => ({ toast: vi.fn() }) }))

import ApprovalsClient, { type ApprovalChange } from "@/app/(dashboard)/approvals/approvals-client"

const change: ApprovalChange = {
  id: "CHG-1",
  title: "Patch core router",
  description: "Routine OS patch",
  riskLevel: "low",
  createdAt: new Date("2026-06-01T09:00:00Z"),
  requester: { name: "Ada", email: "ada@csquared.com" },
  opco: { name: "Ghana", slug: "ghana" },
  approvals: [],
}

afterEach(() => {
  cleanup()
  submitApproval.mockReset()
  refresh.mockReset()
})

describe("ApprovalsClient optimistic removal", () => {
  it("removes the card immediately on approve and refreshes", async () => {
    submitApproval.mockResolvedValue(undefined)
    render(<ApprovalsClient changes={[change]} />)

    expect(screen.getByText("Patch core router")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /approve/i }))

    await waitFor(() =>
      expect(screen.queryByText("Patch core router")).not.toBeInTheDocument()
    )
    expect(submitApproval).toHaveBeenCalledWith("CHG-1", "approve", undefined)
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it("restores the card if the decision fails", async () => {
    submitApproval.mockRejectedValue(new Error("server boom"))
    render(<ApprovalsClient changes={[change]} />)

    fireEvent.click(screen.getByRole("button", { name: /approve/i }))

    await waitFor(() => expect(submitApproval).toHaveBeenCalled())
    expect(await screen.findByText("Patch core router")).toBeInTheDocument()
    expect(refresh).not.toHaveBeenCalled()
  })
})

describe("ApprovalsClient quorum progress", () => {
  const highRisk = (approvals: ApprovalChange["approvals"]): ApprovalChange => ({
    ...change, riskLevel: "high", approvals,
  })

  it("flags a high-risk change whose two approvals include no CAB vote", () => {
    render(<ApprovalsClient changes={[highRisk([
      { isCab: false, decision: "approve", approverId: "n1" },
      { isCab: false, decision: "approve", approverId: "n2" },
    ])]} />)
    expect(screen.getByText(/2\/2/).textContent).toContain("waiting for a CAB vote")
  })

  it("shows plain progress once a CAB member has approved", () => {
    render(<ApprovalsClient changes={[highRisk([
      { isCab: true, decision: "approve", approverId: "c1" },
    ])]} />)
    expect(screen.getByText(/1\/2/).textContent).not.toContain("waiting for a CAB vote")
  })
})
