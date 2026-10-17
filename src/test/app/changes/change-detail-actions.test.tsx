import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

vi.mock("@/lib/store", () => ({ useStore: () => ({ language: "en" }) }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock("@/components/ui/toaster", () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock("@/server/actions/changes", () => ({ submitChange: vi.fn(), updateChangeStatus: vi.fn(), discardChange: vi.fn() }))
vi.mock("@/server/actions/approvals", () => ({ submitApproval: vi.fn() }))
vi.mock("@/app/(dashboard)/changes/[id]/pir-form", () => ({ default: () => <form aria-label="PIR form" /> }))
vi.mock("@/app/(dashboard)/changes/[id]/assignees-dialog", () => ({ default: () => null }))

import ChangeDetailClient, { type SerializedChange, type Caps } from "@/app/(dashboard)/changes/[id]/change-detail-client"

const change: SerializedChange = {
  id: "c1", title: "Router swap", description: "d", category: "config", riskLevel: "low", status: "implemented",
  isEmergency: false, contactEmail: "a@csquared.com", infrastructureType: "Wifi",
  changeReason: null, impactScope: null, implementationPlan: null, testingPlan: null, backoutPlan: null,
  attachments: [], changeWindow: null, plannedStart: null, plannedEnd: null, slaDeadline: null,
  createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-02T00:00:00Z",
  opco: { slug: "ghana", name: "Ghana" }, requester: { name: "Ama", email: "a@csquared.com" },
  approvals: [], auditTrail: [], implementedAt: "2026-10-02T00:00:00Z", implementer: null,
  expedited: false, retroApprovalDueAt: null, retroApprovedAt: null, hasPir: false, assignees: [],
}
const caps: Caps = {
  isRequester: false, isImplementer: false, isNamedImplementer: false, canApprove: true, isAdmin: false,
  canExportEvidence: false, canManageAssignees: false, soleApproverIsMe: false, hasVotedThisStage: false,
}

describe("ChangeDetailClient actions", () => {
  it("doesn't say 'No actions' above the PIR form it is showing", () => {
    render(<ChangeDetailClient change={change} caps={caps} assigneeCandidates={[]} approverCandidates={[]} />)
    expect(screen.getByRole("form", { name: "PIR form" })).toBeInTheDocument()
    expect(screen.queryByText("No actions available for your role at this stage.")).not.toBeInTheDocument()
  })
})
