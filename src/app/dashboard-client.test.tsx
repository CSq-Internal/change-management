import { describe, it, expect, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@testing-library/react"
import DashboardClient from "@/app/dashboard-client"
import { type DashboardChange } from "@/lib/dashboard-metrics"

afterEach(() => { cleanup(); localStorage.clear() })

const now = Date.parse("2026-06-02T09:00:00Z")
const iso = (h: number) => new Date(now + h * 3600_000).toISOString()

const changes: DashboardChange[] = [
  { id: "CHG-1", title: "Core router OS patch", status: "pending", riskLevel: "high", isEmergency: false, slaDeadline: iso(-1.5), plannedStart: iso(30), opcoName: "Liberia", opcoSlug: "liberia", infrastructureType: "Backbone IP Network", createdAt: iso(-48), ownerInitials: "JG", expedited: false, retroApprovalDueAt: null, retroApprovedAt: null },
  { id: "CHG-2", title: "BGP peering change", status: "pending", riskLevel: "high", isEmergency: false, slaDeadline: iso(1), plannedStart: iso(26), opcoName: "Ghana", opcoSlug: "ghana", infrastructureType: "Backbone IP Network", createdAt: iso(-40), ownerInitials: "KO", expedited: false, retroApprovalDueAt: null, retroApprovedAt: null },
  { id: "CHG-3", title: "DWDM card replacement", status: "approved", riskLevel: "high", isEmergency: false, slaDeadline: iso(6), plannedStart: iso(14), opcoName: "Uganda", opcoSlug: "uganda", infrastructureType: "Equiano Optics", createdAt: iso(-30), ownerInitials: "SN", expedited: false, retroApprovalDueAt: null, retroApprovedAt: null },
  { id: "CHG-4", title: "Submarine cable maintenance", status: "approved", riskLevel: "emergency", isEmergency: true, slaDeadline: iso(0.4), plannedStart: iso(9), opcoName: "Mauritius", opcoSlug: "mauritius", infrastructureType: "Equiano Optics", createdAt: iso(-20), ownerInitials: "RB", expedited: false, retroApprovalDueAt: null, retroApprovedAt: null },
  { id: "CHG-5", title: "Power redundancy test", status: "closed", riskLevel: "low", isEmergency: false, slaDeadline: null, plannedStart: null, opcoName: "Ghana", opcoSlug: "ghana", infrastructureType: "Power", createdAt: iso(-10), ownerInitials: "AM", expedited: false, retroApprovalDueAt: null, retroApprovedAt: null },
]

const props = {
  changes,
  now,
  infraOptions: [...new Set(changes.map((c) => c.infrastructureType))].sort(),
  opcoOptions: [...new Map(changes.map((c) => [c.opcoSlug, c.opcoName])).entries()]
    .map(([slug, name]) => ({ slug, name })),
  blackouts: [{ id: "b1", label: "Year-end freeze", scope: "Group", endsIn: "2d", amber: false }],
  feed: [{ id: "f1", changeId: "CHG-1", changeTitle: "Core router upgrade", label: "submitted", actor: "S. Nakato", ago: "8m ago", tone: "bg-amber-500" }],
  blackoutCount: 1,
}

describe("DashboardClient", () => {
  it("renders the Triage worklist by default with an overdue change", () => {
    render(<DashboardClient {...props} />)
    expect(screen.getByText("Your worklist")).toBeInTheDocument()
    // "Core router OS patch" now renders in both the Triage worklist and the
    // (collapsed but DOM-present) matching list, so allow more than one match.
    expect(screen.getAllByText("Core router OS patch").length).toBeGreaterThan(0)
  })

  it("switches to the Report tab and renders distributions", () => {
    render(<DashboardClient {...props} />)
    fireEvent.click(screen.getByRole("button", { name: /Report/ }))
    expect(screen.getByText("Risk mix")).toBeInTheDocument()
    expect(screen.getByText("Status distribution")).toBeInTheDocument()
  })

  it("switches to the Monitor tab and renders the activity feed", () => {
    render(<DashboardClient {...props} />)
    fireEvent.click(screen.getByRole("button", { name: /Monitor/ }))
    expect(screen.getByText("Live activity")).toBeInTheDocument()
  })

  it("narrows the matching list when a risk filter is applied", () => {
    render(<DashboardClient {...props} />)
    expect(screen.getByText("Matching changes · 5")).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText("emergency"))
    expect(screen.getByText("Matching changes · 1")).toBeInTheDocument()
  })
})
