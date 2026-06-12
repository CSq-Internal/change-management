import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

vi.mock("@/server/actions/cab", () => ({ addCabMember: vi.fn().mockResolvedValue({}) }))
vi.mock("@/server/actions/users", () => ({ listOpCoApprovers: vi.fn().mockResolvedValue([]) }))
vi.mock("@/components/ui/toaster", () => ({ useToast: () => ({ toast: vi.fn() }) }))

import CabAddDialog from "@/app/(dashboard)/cab/cab-add-dialog"

describe("CabAddDialog", () => {
  it("renders the add dialog title and hint", () => {
    render(<CabAddDialog language="en" opcoSlug="ghana" existingUserIds={[]} onClose={vi.fn()} onAdded={vi.fn()} />)
    expect(screen.getByText("Add CAB member")).toBeInTheDocument()
    expect(screen.getByText("Only users with the approver role are listed.")).toBeInTheDocument()
  })
})
