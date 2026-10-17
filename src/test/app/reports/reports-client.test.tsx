import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

vi.mock("@/lib/store", () => ({ useStore: () => ({ language: "en" }) }))

import ReportsClient, { type ReportsData } from "@/app/(dashboard)/reports/reports-client"

const HOUR = 3_600_000
const at = new Date("2026-10-01T00:00:00Z")
const change = (id: string, status: string, approvalMs: number | null) => ({
  id, title: id, status, riskLevel: "low", createdAt: at, updatedAt: at, approvalMs,
})

function kpi(label: string) {
  return screen.getByText(label).nextElementSibling?.textContent
}

describe("ReportsClient KPIs", () => {
  const data: ReportsData = {
    byStatus: [], byRisk: [], slaCompliance: [],
    changes: [
      change("c1", "closed", 2 * HOUR),
      change("c2", "closed", 4 * HOUR),
      change("c3", "verified", 6 * HOUR),
      change("c4", "approved", 8 * HOUR),
    ],
  }

  it("counts closed changes as successful, not only verified ones", () => {
    render(<ReportsClient data={data} />)
    expect(kpi("Success rate")).toBe("75%")
  })

  it("averages the time from submission to approval", () => {
    render(<ReportsClient data={data} />)
    expect(kpi("Avg approval time")).toBe("5.0h")
  })
})
