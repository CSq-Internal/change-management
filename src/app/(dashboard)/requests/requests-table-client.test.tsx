import { describe, it, expect } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import RequestsTableClient, { type RequestRow } from "./requests-table-client"

const rows: RequestRow[] = [
  { id: "c1", title: "Core router upgrade", status: "pending", riskLevel: "high", infrastructureType: "Backbone IP Network", opcoName: "Ghana", approvalsGiven: 1, requesterName: "Ada" },
  { id: "c2", title: "Wifi patch", status: "approved", riskLevel: "medium", infrastructureType: "Wifi", opcoName: "Ghana", approvalsGiven: 2, requesterName: "Bob" },
]

describe("RequestsTableClient", () => {
  it("renders rows and a New Request link", () => {
    render(<RequestsTableClient rows={rows} showRequester />)
    expect(screen.getByText("Core router upgrade")).toBeInTheDocument()
    expect(screen.getByText("Wifi patch")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /New Request/i })).toHaveAttribute("href", "/requests/new")
  })

  it("filters by status", () => {
    render(<RequestsTableClient rows={rows} showRequester />)
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "approved" } })
    expect(screen.queryByText("Core router upgrade")).not.toBeInTheDocument()
    expect(screen.getByText("Wifi patch")).toBeInTheDocument()
  })

  it("honors initialStatus", () => {
    render(<RequestsTableClient rows={rows} showRequester initialStatus="approved" />)
    expect(screen.queryByText("Core router upgrade")).not.toBeInTheDocument()
    expect(screen.getByText("Wifi patch")).toBeInTheDocument()
  })

  it("shows the empty state when nothing matches", () => {
    render(<RequestsTableClient rows={[]} showRequester />)
    expect(screen.getByText(/No requests/i)).toBeInTheDocument()
  })
})
