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
    render(<ApprovalsClient changes={[change]} isCabMember />)

    expect(screen.getByText("Patch core router")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /approve/i }))

    await waitFor(() =>
      expect(screen.queryByText("Patch core router")).not.toBeInTheDocument()
    )
    expect(submitApproval).toHaveBeenCalledWith("CHG-1", "approve", undefined, true)
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it("restores the card if the decision fails", async () => {
    submitApproval.mockRejectedValue(new Error("server boom"))
    render(<ApprovalsClient changes={[change]} isCabMember />)

    fireEvent.click(screen.getByRole("button", { name: /approve/i }))

    await waitFor(() => expect(submitApproval).toHaveBeenCalled())
    expect(await screen.findByText("Patch core router")).toBeInTheDocument()
    expect(refresh).not.toHaveBeenCalled()
  })
})
