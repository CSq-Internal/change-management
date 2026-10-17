import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

const addApproverAssignment = vi.fn()
vi.mock("@/server/actions/approval-matrix", () => ({
  addApproverAssignment: (a: unknown) => addApproverAssignment(a),
  removeApproverAssignment: vi.fn(),
}))
vi.mock("@/lib/store", () => ({ useStore: () => ({ language: "en" }) }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("@/components/ui/toaster", () => ({ useToast: () => ({ toast: vi.fn() }) }))

import ApprovalMatrixClient from "@/app/(dashboard)/approval-matrix/approval-matrix-client"

describe("ApprovalMatrixClient", () => {
  it("locks Add while an override is being saved, so a double-click adds it once", async () => {
    let finish!: () => void
    addApproverAssignment.mockReturnValue(new Promise((r) => { finish = () => r({}) }))
    render(
      <ApprovalMatrixClient canManage infraTypes={["Equiano IP"]} scopes={[{ slug: "", name: "Group" }]}
        candidates={[{ id: "u1", label: "Ama" }]} rows={[]} />,
    )
    const add = screen.getByRole("button", { name: "Add override" })
    fireEvent.click(add)
    await waitFor(() => expect(add).toBeDisabled())
    fireEvent.click(add)
    expect(addApproverAssignment).toHaveBeenCalledTimes(1)
    finish()
    await waitFor(() => expect(add).toBeEnabled())
  })
})
