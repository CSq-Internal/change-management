import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

vi.mock("@/lib/store", () => ({ useStore: (pick: (s: { language: string }) => unknown) => pick({ language: "en" }) }))

import { StatusDistribution } from "@/components/dashboard/charts"

describe("StatusDistribution", () => {
  it("shows cancelled changes, so the segments add up to every change", () => {
    const counts = { draft: 0, pending: 2, approved: 0, implemented: 0, verified: 0, rejected: 0, closed: 1, cancelled: 3 }
    render(<StatusDistribution counts={counts} />)
    expect(screen.getByText("Cancelled")).toBeInTheDocument()
  })
})
