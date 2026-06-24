import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

vi.mock("@/server/actions/access-requests", () => ({ requestAccess: vi.fn() }))
vi.mock("@/lib/store", () => ({ useStore: () => ({ language: "en" }) }))

import RequestAccessClient from "@/app/(dashboard)/request-access/request-access-client"

describe("RequestAccessClient", () => {
  it("renders the form when OpCos are available", () => {
    render(
      <RequestAccessClient
        opcos={[{ name: "CSquared Ghana", slug: "ghana" }]}
        requests={[]}
      />
    )
    expect(screen.getByText("Request access")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Submit request" })).toBeInTheDocument()
  })

  it("shows the empty state when no OpCos are available", () => {
    render(<RequestAccessClient opcos={[]} requests={[]} />)
    expect(screen.getByText("No OpCos are available to request right now.")).toBeInTheDocument()
  })

  it("lists existing requests with their status", () => {
    render(
      <RequestAccessClient
        opcos={[]}
        requests={[{ id: "ar-1", opcoName: "Ghana", status: "pending", decisionReason: null, createdAt: "2026-06-24T00:00:00.000Z" }]}
      />
    )
    expect(screen.getByText("Ghana")).toBeInTheDocument()
    expect(screen.getByText("Pending")).toBeInTheDocument()
  })
})
