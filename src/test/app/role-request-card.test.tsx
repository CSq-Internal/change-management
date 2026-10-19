import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

const requestRole = vi.fn()
const refresh = vi.fn()
vi.mock("@/server/actions/access-requests", () => ({ requestRole: (...a: unknown[]) => requestRole(...a) }))
vi.mock("@/lib/store", () => ({ useStore: () => ({ language: "en" }) }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))

import RoleRequestCard from "@/app/(dashboard)/settings/profile/role-request-card"

const opcos = [{ name: "CSquared Ghana", slug: "ghana" }]

beforeEach(() => vi.clearAllMocks())

describe("RoleRequestCard", () => {
  it("sends the OpCo, role and reason", async () => {
    requestRole.mockResolvedValue({ id: "ar-1" })
    render(<RoleRequestCard opcos={opcos} requests={[]} />)
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "auditor" } })
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Quarterly ISO audit" } })
    fireEvent.click(screen.getByRole("button", { name: "Request role" }))
    await waitFor(() => expect(requestRole).toHaveBeenCalledWith({ opcoSlug: "ghana", role: "auditor", reason: "Quarterly ISO audit" }))
    expect(refresh).toHaveBeenCalled()
  })

  it("starts on the user's own OpCo, not the first one alphabetically", () => {
    const all = [{ name: "CSquared DRC", slug: "drc" }, { name: "CSquared Ghana", slug: "ghana" }]
    render(<RoleRequestCard opcos={all} requests={[]} defaultOpco="ghana" />)
    expect(screen.getByLabelText("OpCo")).toHaveValue("ghana")
  })

  it("keeps the button disabled until a reason is typed", () => {
    render(<RoleRequestCard opcos={opcos} requests={[]} />)
    expect(screen.getByRole("button", { name: "Request role" })).toBeDisabled()
  })

  it("shows the server's refusal", async () => {
    requestRole.mockRejectedValue(new Error("You already have a pending request for this OpCo"))
    render(<RoleRequestCard opcos={opcos} requests={[]} />)
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "x" } })
    fireEvent.click(screen.getByRole("button", { name: "Request role" }))
    expect(await screen.findByText("You already have a pending request for this OpCo")).toBeInTheDocument()
  })

  it("lists past requests with role, status and the denial reason", () => {
    render(
      <RoleRequestCard
        opcos={opcos}
        requests={[{ id: "ar-1", opcoName: "CSquared Ghana", role: "approver", status: "denied", decisionReason: "Not on the CAB", createdAt: "2026-10-16T09:00:00.000Z" }]}
      />
    )
    expect(screen.getByText(/Approver · CSquared Ghana/)).toBeInTheDocument()
    expect(screen.getByText(/Denied — Not on the CAB/)).toBeInTheDocument()
  })
})
