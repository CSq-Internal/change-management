import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

vi.mock("@/server/actions/opcos", () => ({
  createOpCo: vi.fn().mockResolvedValue({ id: "o-new" }),
  renameOpCo: vi.fn().mockResolvedValue({ id: "o1" }),
}))
vi.mock("@/components/ui/toaster", () => ({ useToast: () => ({ toast: vi.fn() }) }))

import OpcoFormDialog from "@/app/(dashboard)/opcos/opco-form-dialog"

describe("OpcoFormDialog", () => {
  it("renders create mode with slug field", () => {
    render(<OpcoFormDialog language="en" opco={null} onClose={vi.fn()} onSaved={vi.fn()} />)
    expect(screen.getByText("Create OpCo")).toBeInTheDocument()
    expect(screen.getByPlaceholderText("Slug (lowercase, unique)")).toBeInTheDocument()
  })

  it("renders rename mode pre-filled, without slug field", () => {
    render(
      <OpcoFormDialog
        language="en"
        opco={{ id: "o1", name: "Ghana", slug: "ghana", locale: "en", archived: false }}
        onClose={vi.fn()} onSaved={vi.fn()}
      />
    )
    expect(screen.getByText("Rename OpCo")).toBeInTheDocument()
    expect(screen.getByDisplayValue("Ghana")).toBeInTheDocument()
    expect(screen.queryByPlaceholderText("Slug (lowercase, unique)")).not.toBeInTheDocument()
  })
})
