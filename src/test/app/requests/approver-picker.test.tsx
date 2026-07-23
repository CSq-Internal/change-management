import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"

const { listEligibleApproversAction, createChange, submitChange, updateChange, setChangeApprovers, toast } =
  vi.hoisted(() => ({
    listEligibleApproversAction: vi.fn(),
    createChange: vi.fn().mockResolvedValue({ id: "cr-new" }),
    submitChange: vi.fn().mockResolvedValue({}),
    updateChange: vi.fn().mockResolvedValue({}),
    setChangeApprovers: vi.fn().mockResolvedValue({}),
    toast: vi.fn(),
  }))

vi.mock("@/server/actions/eligible-approvers", () => ({ listEligibleApproversAction }))
vi.mock("@/server/actions/changes", () => ({ createChange, submitChange, updateChange }))
vi.mock("@/server/actions/assignees", () => ({ setChangeApprovers }))
vi.mock("@/components/ui/toaster", () => ({ useToast: () => ({ toast }) }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock("@/lib/store", () => ({ useStore: () => ({ language: "en" }) }))

import RequestForm from "@/app/(dashboard)/requests/request-form"

const APPROVERS = [
  { id: "appr1", name: "Ada", email: "ada@csquared.com" },
  { id: "appr2", name: "Kofi", email: "kofi@csquared.com" },
]

function renderForm() {
  return render(<RequestForm opcoOptions={["ghana"]} defaultEmail="me@csquared.com" />)
}

// The form labels its fields with card headings, not <label>/aria-label, so the
// infrastructure <select> is reached through one of its own options.
function infraSelect() {
  return screen.getByRole("option", { name: "Wifi" }).closest("select") as HTMLSelectElement
}

function submitButton() {
  return screen.getByRole("button", { name: /submit for approval/i })
}

beforeEach(() => {
  vi.clearAllMocks()
  listEligibleApproversAction.mockResolvedValue(APPROVERS)
})

describe("request form approver picker", () => {
  it("does not query until an infrastructure type is chosen", () => {
    renderForm()
    expect(listEligibleApproversAction).not.toHaveBeenCalled()
  })

  it("loads candidates for the chosen OpCo and infrastructure type", async () => {
    renderForm()
    fireEvent.change(infraSelect(), { target: { value: "Wifi" } })
    await waitFor(() =>
      expect(listEligibleApproversAction).toHaveBeenCalledWith("ghana", "Wifi", undefined)
    )
    await waitFor(() => expect(screen.getByText("ada@csquared.com")).toBeInTheDocument())
  })

  it("re-queries and clears selection when the infrastructure type changes to Equiano", async () => {
    renderForm()
    const infra = infraSelect()

    fireEvent.change(infra, { target: { value: "Wifi" } })
    await waitFor(() => expect(screen.getByText("ada@csquared.com")).toBeInTheDocument())
    fireEvent.click(screen.getByLabelText("ada@csquared.com"))

    listEligibleApproversAction.mockResolvedValue([
      { id: "cto", name: "Group CTO", email: "cto@csquared.com" },
    ])
    fireEvent.change(infra, { target: { value: "Equiano IP" } })

    await waitFor(() =>
      expect(listEligibleApproversAction).toHaveBeenCalledWith("ghana", "Equiano IP", undefined)
    )
    await waitFor(() => expect(screen.getByText("cto@csquared.com")).toBeInTheDocument())
    expect(screen.queryByText("ada@csquared.com")).not.toBeInTheDocument()
    expect(screen.getByText(/no longer apply to this infrastructure type/i)).toBeInTheDocument()
  })

  it("still shows the cleared notice when the new scope has no approvers at all", async () => {
    renderForm()
    const infra = infraSelect()

    fireEvent.change(infra, { target: { value: "Wifi" } })
    await waitFor(() => expect(screen.getByText("ada@csquared.com")).toBeInTheDocument())
    fireEvent.click(screen.getByLabelText("ada@csquared.com"))

    listEligibleApproversAction.mockResolvedValue([])
    fireEvent.change(infra, { target: { value: "Equiano IP" } })

    await waitFor(() =>
      expect(screen.getByText(/no group cab members are configured/i)).toBeInTheDocument()
    )
    expect(screen.getByText(/no longer apply to this infrastructure type/i)).toBeInTheDocument()
  })

  it("shows the OpCo empty state when no approvers are configured", async () => {
    listEligibleApproversAction.mockResolvedValue([])
    renderForm()
    fireEvent.change(infraSelect(), { target: { value: "Wifi" } })
    await waitFor(() =>
      expect(screen.getByText(/no eligible approvers are configured for this opco/i)).toBeInTheDocument()
    )
  })

  it("shows the group empty state for Equiano infra", async () => {
    listEligibleApproversAction.mockResolvedValue([])
    renderForm()
    fireEvent.change(infraSelect(), { target: { value: "Equiano IP" } })
    await waitFor(() =>
      expect(screen.getByText(/no group cab members are configured/i)).toBeInTheDocument()
    )
  })

  it("shows an error with retry when the load fails, and retry re-queries", async () => {
    listEligibleApproversAction.mockRejectedValueOnce(new Error("boom"))
    renderForm()
    fireEvent.change(infraSelect(), { target: { value: "Wifi" } })
    await waitFor(() => expect(screen.getByText(/could not load approvers/i)).toBeInTheDocument())

    listEligibleApproversAction.mockResolvedValue(APPROVERS)
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    await waitFor(() => expect(screen.getByText("ada@csquared.com")).toBeInTheDocument())
  })

  it("passes selected approverIds to createChange", async () => {
    renderForm()
    fireEvent.change(infraSelect(), { target: { value: "Wifi" } })
    await waitFor(() => expect(screen.getByText("ada@csquared.com")).toBeInTheDocument())
    fireEvent.click(screen.getByLabelText("ada@csquared.com"))

    fireEvent.change(screen.getByPlaceholderText("Describe the change at a glance"), { target: { value: "T" } })
    fireEvent.change(screen.getByPlaceholderText("Provide background, scope, and justification."), { target: { value: "D" } })
    fireEvent.click(screen.getByRole("button", { name: /save draft/i }))

    await waitFor(() =>
      expect(createChange).toHaveBeenCalledWith(
        "ghana",
        expect.objectContaining({ approverIds: ["appr1"] })
      )
    )
  })

  it("keeps approvers already named on the change when editing a draft", async () => {
    render(
      <RequestForm
        mode="edit"
        opcoOptions={["ghana"]}
        initialApproverIds={["appr1"]}
        initial={{
          id: "cr-1",
          title: "T",
          description: "D",
          category: "software",
          riskLevel: "medium",
          contactEmail: "me@csquared.com",
          infrastructureType: "Wifi",
          opcoSlug: "ghana",
        }}
      />
    )
    await waitFor(() => expect(screen.getByLabelText("ada@csquared.com")).toBeChecked())

    fireEvent.click(screen.getByRole("button", { name: /save draft/i }))
    await waitFor(() => expect(setChangeApprovers).toHaveBeenCalledWith("cr-1", ["appr1"]))
    // updateChange never receives approverIds — it writes its payload straight to the row.
    expect(updateChange).toHaveBeenCalledWith("cr-1", expect.not.objectContaining({ approverIds: expect.anything() }))
  })
})

describe("submit button gating", () => {
  it("is disabled once an infra type is chosen but no approver is selected", async () => {
    renderForm()
    fireEvent.change(infraSelect(), { target: { value: "Wifi" } })
    await waitFor(() => expect(screen.getByText("ada@csquared.com")).toBeInTheDocument())
    expect(submitButton()).toBeDisabled()
  })

  it("is enabled once an approver is selected", async () => {
    renderForm()
    fireEvent.change(infraSelect(), { target: { value: "Wifi" } })
    await waitFor(() => expect(screen.getByText("ada@csquared.com")).toBeInTheDocument())
    fireEvent.click(screen.getByLabelText("ada@csquared.com"))
    expect(submitButton()).toBeEnabled()
  })

  it("is disabled while the picker is loading, even with a selection from the old scope", async () => {
    renderForm()
    const infra = infraSelect()

    fireEvent.change(infra, { target: { value: "Wifi" } })
    await waitFor(() => expect(screen.getByText("ada@csquared.com")).toBeInTheDocument())
    fireEvent.click(screen.getByLabelText("ada@csquared.com"))

    // Never settles, so the picker stays in `loading` for the assertion.
    listEligibleApproversAction.mockReturnValue(new Promise(() => {}))
    fireEvent.change(infra, { target: { value: "Equiano IP" } })

    await waitFor(() =>
      expect(listEligibleApproversAction).toHaveBeenCalledWith("ghana", "Equiano IP", undefined)
    )
    expect(submitButton()).toBeDisabled()
  })

  it("is disabled in the error state even though a selection survives from the old scope", async () => {
    renderForm()
    const infra = infraSelect()

    fireEvent.change(infra, { target: { value: "Wifi" } })
    await waitFor(() => expect(screen.getByText("ada@csquared.com")).toBeInTheDocument())
    fireEvent.click(screen.getByLabelText("ada@csquared.com"))
    expect(submitButton()).toBeEnabled()

    listEligibleApproversAction.mockRejectedValueOnce(new Error("boom"))
    fireEvent.change(infra, { target: { value: "Equiano IP" } })
    await waitFor(() => expect(screen.getByText(/could not load approvers/i)).toBeInTheDocument())
    expect(submitButton()).toBeDisabled()
  })

  it("stays enabled on an untouched form so submitting shows the missing-fields toast", async () => {
    render(<RequestForm opcoOptions={["ghana"]} />)
    const submit = submitButton()
    expect(submit).toBeEnabled()

    fireEvent.click(submit)
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Missing required fields" })
      )
    )
    expect(createChange).not.toHaveBeenCalled()
  })
})
