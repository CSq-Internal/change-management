import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@testing-library/react"
import type { CabMember } from "@/app/(dashboard)/cab/types"

const useSessionMock = vi.fn()
vi.mock("next-auth/react", () => ({ useSession: () => useSessionMock() }))
vi.mock("@/lib/store", () => ({ useStore: () => ({ language: "en" }) }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("@/components/ui/toaster", () => ({ useToast: () => ({ toast: vi.fn() }) }))
// Stub children so we test only CabClient's gating logic.
vi.mock("@/app/(dashboard)/cab/cab-table", () => ({ default: () => <div data-testid="cab-table" /> }))
vi.mock("@/app/(dashboard)/cab/cab-add-dialog", () => ({ default: () => <div data-testid="add-dialog" /> }))

import CabClient from "@/app/(dashboard)/cab/cab-client"

const opcos = [{ slug: "ghana", name: "Ghana" }]

function session(realmRoles: string[]) {
  useSessionMock.mockReturnValue({
    data: { user: { organizations: [], realmRoles } },
  })
}

const addButton = () => screen.getByRole("button", { name: "Add member" })

describe("CabClient add-button gating", () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => cleanup())

  it("group admin: per-OpCo Add is enabled when manageable OpCos exist", () => {
    session(["group_admin"])
    render(<CabClient perOpco={[]} group={[]} showGroup manageableOpcos={opcos} />)
    expect(addButton()).not.toBeDisabled()
    fireEvent.click(addButton())
    expect(screen.getByTestId("add-dialog")).toBeInTheDocument()
  })

  it("per-OpCo Add is disabled when there are no manageable OpCos", () => {
    session(["group_admin"])
    render(<CabClient perOpco={[]} group={[]} showGroup manageableOpcos={[]} />)
    expect(addButton()).toBeDisabled()
  })

  it("group tab Add is disabled for a non-group-admin (auditor)", () => {
    session(["group_auditor"])
    const group: CabMember[] = []
    render(<CabClient perOpco={[]} group={group} showGroup manageableOpcos={[]} />)
    // switch to the group tab
    fireEvent.click(screen.getByRole("button", { name: "Group CAB" }))
    expect(addButton()).toBeDisabled()
  })
})
