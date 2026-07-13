import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"

const { addCabMember, listCabEligible } = vi.hoisted(() => ({
  addCabMember: vi.fn().mockResolvedValue({}),
  listCabEligible: vi.fn().mockResolvedValue([]),
}))
vi.mock("@/server/actions/cab", () => ({ addCabMember }))
vi.mock("@/server/actions/users", () => ({ listCabEligible }))
vi.mock("@/components/ui/toaster", () => ({ useToast: () => ({ toast: vi.fn() }) }))

import CabAddDialog from "@/app/(dashboard)/cab/cab-add-dialog"

const opcos = [
  { slug: "ghana", name: "Ghana" },
  { slug: "kenya", name: "Kenya" },
]

describe("CabAddDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listCabEligible.mockResolvedValue([])
  })

  it("renders the add dialog title and broadened hint", () => {
    render(<CabAddDialog language="en" opcos={null} existing={[]} onClose={vi.fn()} onAdded={vi.fn()} />)
    expect(screen.getByText("Add CAB member")).toBeInTheDocument()
    expect(screen.getByText("Only users with the approver or admin role are listed.")).toBeInTheDocument()
  })

  it("group mode (opcos=null) lists eligible members with a null slug and no OpCo picker", async () => {
    listCabEligible.mockResolvedValue([{ id: "u1", name: "Ada", email: "ada@csquared.com" }])
    render(<CabAddDialog language="en" opcos={null} existing={[]} onClose={vi.fn()} onAdded={vi.fn()} />)
    expect(screen.queryByLabelText("OpCo")).not.toBeInTheDocument()
    expect(listCabEligible).toHaveBeenCalledWith(null)
    await waitFor(() => expect(screen.getByText("ada@csquared.com")).toBeInTheDocument())
  })

  it("per-OpCo mode renders an OpCo picker and loads eligible members for the selected OpCo", async () => {
    listCabEligible.mockResolvedValue([{ id: "u1", name: "Ada", email: "ada@csquared.com" }])
    render(<CabAddDialog language="en" opcos={opcos} existing={[]} onClose={vi.fn()} onAdded={vi.fn()} />)
    const select = screen.getByLabelText("OpCo")
    expect(select).toBeInTheDocument()
    // defaults to the first OpCo
    expect(listCabEligible).toHaveBeenCalledWith("ghana")
    await waitFor(() => expect(screen.getByText("ada@csquared.com")).toBeInTheDocument())

    fireEvent.change(select, { target: { value: "kenya" } })
    await waitFor(() => expect(listCabEligible).toHaveBeenCalledWith("kenya"))
  })

  it("adds the selected user to the selected OpCo", async () => {
    listCabEligible.mockResolvedValue([{ id: "u1", name: "Ada", email: "ada@csquared.com" }])
    render(<CabAddDialog language="en" opcos={opcos} existing={[]} onClose={vi.fn()} onAdded={vi.fn()} />)
    const addBtn = await screen.findByRole("button", { name: "Add member" })
    fireEvent.click(addBtn)
    await waitFor(() => expect(addCabMember).toHaveBeenCalledWith("u1", "ghana"))
  })

  it("excludes users already on the selected OpCo's CAB", async () => {
    listCabEligible.mockResolvedValue([
      { id: "u1", name: "Ada", email: "ada@csquared.com" },
      { id: "u2", name: "Kofi", email: "kofi@csquared.com" },
    ])
    render(
      <CabAddDialog
        language="en"
        opcos={opcos}
        existing={[{ userId: "u1", opcoSlug: "ghana" }]}
        onClose={vi.fn()}
        onAdded={vi.fn()}
      />,
    )
    await waitFor(() => expect(screen.getByText("kofi@csquared.com")).toBeInTheDocument())
    expect(screen.queryByText("ada@csquared.com")).not.toBeInTheDocument()
  })
})
