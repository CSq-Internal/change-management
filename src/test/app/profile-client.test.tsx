import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

vi.mock("@/lib/store", () => ({ useStore: () => ({ language: "en" }) }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("@/server/actions/access-requests", () => ({ requestRole: vi.fn() }))
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { name: "Ama", email: "a@csquared.com", organizations: [{ id: "o1", name: "CSquared Ghana", alias: "ghana", roles: ["requester"] }] } },
  }),
}))

import ProfileClient from "@/app/(dashboard)/settings/profile/profile-client"

describe("ProfileClient", () => {
  it("shows the OpCo role by its label", () => {
    render(<ProfileClient opcos={[]} requests={[]} />)
    expect(screen.getByText("CSquared Ghana · Requester")).toBeInTheDocument()
  })
})
