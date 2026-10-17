import { describe, it, expect, vi } from "vitest"
import { render, screen, within } from "@testing-library/react"

vi.mock("@/lib/store", () => ({ useStore: () => ({ language: "en" }) }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("@/components/ui/toaster", () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock("@/server/actions/risk-register", () => ({ createRisk: vi.fn(), updateRisk: vi.fn() }))

import RiskRegisterClient, { type RiskRow } from "@/app/(dashboard)/risk-register/risk-register-client"

const risk = (id: string, title: string, opcoSlug: string | null): RiskRow => ({
  id, title, description: "", category: "operational", likelihood: 2, impact: 2, owner: "Ama",
  mitigationPlan: null, status: "open", reviewDate: null, opcoSlug, opcoName: opcoSlug ? "Ghana" : null,
})

describe("RiskRegisterClient", () => {
  it("an OpCo admin gets Edit on their OpCo's risks only, not on group or other OpCos' risks", () => {
    render(
      <RiskRegisterClient
        rows={[risk("r1", "Ghana fibre", "ghana"), risk("r2", "Group power", null), risk("r3", "Uganda link", "uganda")]}
        canManage canManageGroup={false} manageableOpcos={[{ slug: "ghana", name: "Ghana" }]}
      />,
    )
    const row = (title: string) => screen.getByText(title).closest("tr")!
    expect(within(row("Ghana fibre")).queryByRole("button", { name: "Edit" })).toBeInTheDocument()
    expect(within(row("Group power")).queryByRole("button", { name: "Edit" })).not.toBeInTheDocument()
    expect(within(row("Uganda link")).queryByRole("button", { name: "Edit" })).not.toBeInTheDocument()
  })
})
