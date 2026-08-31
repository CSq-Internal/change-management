import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

const { setChangeAssignees, toast } = vi.hoisted(() => ({
  setChangeAssignees: vi.fn().mockResolvedValue(undefined),
  toast: vi.fn(),
}))

vi.mock("@/server/actions/assignees", () => ({ setChangeAssignees }))
vi.mock("@/components/ui/toaster", () => ({ useToast: () => ({ toast }) }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock("@/lib/store", () => ({ useStore: () => ({ language: "en" }) }))

import AssigneesDialog from "@/app/(dashboard)/changes/[id]/assignees-dialog"

// Implementers may be any active user in the OpCo; approvers only the eligible subset.
const IMPLEMENTERS = [
  { id: "u-req", label: "Kwame (requester)" },
  { id: "u-eng", label: "Engineer" },
  { id: "u-ada", label: "Ada" },
]
const APPROVERS = [{ id: "u-ada", label: "Ada" }]

function renderDialog(current: { userId: string; role: "approver" | "implementer" }[] = []) {
  return render(
    <AssigneesDialog
      changeId="c1"
      candidates={IMPLEMENTERS}
      approverCandidates={APPROVERS}
      current={current}
      onClose={() => {}}
    />
  )
}

function userSelect() {
  return screen.getByRole("option", { name: "Ada" }).closest("select") as HTMLSelectElement
}

function roleSelect() {
  return screen.getByRole("option", { name: "Implementer" }).closest("select") as HTMLSelectElement
}

beforeEach(() => vi.clearAllMocks())

describe("AssigneesDialog — role-specific candidate lists", () => {
  it("offers every OpCo user for the implementer role", () => {
    renderDialog()
    expect(screen.getByRole("option", { name: "Kwame (requester)" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "Engineer" })).toBeInTheDocument()
  })

  it("narrows the list to eligible approvers when the approver role is chosen", () => {
    renderDialog()
    fireEvent.change(roleSelect(), { target: { value: "approver" } })
    expect(screen.queryByRole("option", { name: "Engineer" })).not.toBeInTheDocument()
    expect(screen.getByRole("option", { name: "Ada" })).toBeInTheDocument()
  })

  it("resets the picked user when the role switch drops them from the list", () => {
    renderDialog()
    fireEvent.change(userSelect(), { target: { value: "u-eng" } })
    fireEvent.change(roleSelect(), { target: { value: "approver" } })
    expect(userSelect().value).toBe("u-ada")
  })

  it("saves the requester as an implementer", async () => {
    renderDialog()
    fireEvent.change(userSelect(), { target: { value: "u-req" } })
    fireEvent.click(screen.getByRole("button", { name: "Add" }))
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    await vi.waitFor(() =>
      expect(setChangeAssignees).toHaveBeenCalledWith("c1", [{ userId: "u-req", role: "implementer" }])
    )
  })

  it("labels an existing assignee found only in the implementer list", () => {
    renderDialog([{ userId: "u-eng", role: "implementer" }])
    expect(screen.getByText(/Engineer · Implementer/)).toBeInTheDocument()
  })
})
