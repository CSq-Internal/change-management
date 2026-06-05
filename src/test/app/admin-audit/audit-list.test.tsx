import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import AuditList from "@/app/(dashboard)/admin-audit/audit-list"
import type { AuditRow } from "@/app/(dashboard)/admin-audit/types"

const rows: AuditRow[] = [
  { id: "a1", actorEmail: "ga@csquared.com", action: "role.update", summary: "Updated assignments", opcoSlug: "ghana", at: "2026-06-01T10:00:00.000Z" },
]

describe("AuditList", () => {
  it("renders audit rows", () => {
    render(<AuditList rows={rows} language="en" />)
    expect(screen.getByText("ga@csquared.com")).toBeInTheDocument()
    expect(screen.getByText("role.update")).toBeInTheDocument()
    expect(screen.getByText("Updated assignments")).toBeInTheDocument()
  })

  it("shows an empty state", () => {
    render(<AuditList rows={[]} language="en" />)
    expect(screen.getByText("No audit entries.")).toBeInTheDocument()
  })
})
