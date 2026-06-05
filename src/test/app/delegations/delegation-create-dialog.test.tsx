import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

vi.mock("@/server/actions/delegations", () => ({ createDelegation: vi.fn().mockResolvedValue({}) }))
vi.mock("@/server/actions/users", () => ({ listOpCoApprovers: vi.fn().mockResolvedValue([]) }))
vi.mock("@/components/ui/toaster", () => ({ useToast: () => ({ toast: vi.fn() }) }))

import DelegationCreateDialog from "@/app/(dashboard)/delegations/delegation-create-dialog"

describe("DelegationCreateDialog", () => {
  it("renders the create dialog with an OpCo picker", () => {
    render(
      <DelegationCreateDialog language="en" manageableSlugs={["ghana"]} onClose={vi.fn()} onCreated={vi.fn()} />
    )
    expect(screen.getByText("Create delegation")).toBeInTheDocument()
    expect(screen.getByText("ghana")).toBeInTheDocument()
  })
})
