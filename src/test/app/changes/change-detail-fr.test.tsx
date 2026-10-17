import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

vi.mock("@/lib/store", () => ({ useStore: (sel?: (s: { language: string }) => unknown) => (sel ? sel({ language: "fr" }) : { language: "fr" }) }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock("@/components/ui/toaster", () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock("@/server/actions/changes", () => ({ submitChange: vi.fn(), updateChangeStatus: vi.fn(), discardChange: vi.fn() }))
vi.mock("@/server/actions/approvals", () => ({ submitApproval: vi.fn() }))
vi.mock("@/app/(dashboard)/changes/[id]/pir-form", () => ({ default: () => <form aria-label="PIR form" /> }))
vi.mock("@/app/(dashboard)/changes/[id]/assignees-dialog", () => ({ default: () => null }))
vi.mock("@/lib/use-hydrated", () => ({ useHydrated: () => true }))

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

describe("ChangeDetailClient in French", () => {
  const fr: SerializedChange = {
    ...change,
    category: "software",
    auditTrail: [{
      id: "a1", action: "pir_recorded", fromStatus: "implemented", toStatus: "verified", note: null,
      at: "2026-10-19T10:00:00Z", actor: { name: "Efua", email: "e@csquared.com" },
    }],
  }

  it("translates the timeline action, the category and the date", () => {
    render(<ChangeDetailClient change={fr} caps={caps} assigneeCandidates={[]} approverCandidates={[]} />)
    expect(screen.getByText("Revue post-implémentation enregistrée")).toBeInTheDocument()
    expect(screen.getByText("Logiciel")).toBeInTheDocument()
    expect(screen.queryByText(/Pir Recorded|pir recorded/i)).not.toBeInTheDocument()
    expect(screen.getAllByText(/19 oct\. 2026/).length).toBeGreaterThan(0)
  })

  it("translates an approval vote", () => {
    const voted: SerializedChange = {
      ...change,
      approvals: [{
        id: "v1", approverId: "u1", decision: "approve", comment: null, isCab: true,
        decidedAt: "2026-10-19T10:00:00Z", approver: { name: "Kofi", email: "k@csquared.com" },
      }],
    }
    render(<ChangeDetailClient change={voted} caps={caps} assigneeCandidates={[]} approverCandidates={[]} />)
    expect(screen.getByText("Approbation")).toBeInTheDocument()
    expect(screen.queryByText("approve")).not.toBeInTheDocument()
  })
})
