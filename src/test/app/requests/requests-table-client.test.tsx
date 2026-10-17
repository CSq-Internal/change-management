import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

vi.mock("@/lib/store", () => ({ useStore: () => ({ language: "en" }) }))

import RequestsTableClient, { type RequestRow } from "@/app/(dashboard)/requests/requests-table-client"

const rows: RequestRow[] = Array.from({ length: 150 }, (_, i) => ({
  id: `c${i}`, title: `Change ${i}`, status: "pending", riskLevel: "low", infrastructureType: "Wifi",
  opcoName: "Ghana", approvalsGiven: 0, requesterName: "Ama",
}))

describe("RequestsTableClient", () => {
  it("renders the first 100 rows, and the rest on request", () => {
    render(<RequestsTableClient rows={rows} showRequester olderHidden={false} />)
    expect(screen.getAllByRole("link", { name: /^Change \d+$/ })).toHaveLength(100)
    fireEvent.click(screen.getByRole("button", { name: /show all/i }))
    expect(screen.getAllByRole("link", { name: /^Change \d+$/ })).toHaveLength(150)
  })

  it("offers older finished requests when they were left out", () => {
    render(<RequestsTableClient rows={rows.slice(0, 3)} showRequester olderHidden />)
    expect(screen.getByRole("link", { name: /older/i })).toHaveAttribute("href", "/requests?all=1")
  })
})
