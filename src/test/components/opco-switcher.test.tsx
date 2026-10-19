import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

const session = vi.hoisted(() => ({ current: null as unknown }))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: session.current }) }))
vi.mock("@/server/actions/opcos", () => ({ listActiveOpCos: vi.fn().mockResolvedValue([]) }))

import { OpCoSwitcher } from "@/components/opco-switcher"

const org = (alias: string, name: string) => ({ id: alias, alias, name, roles: ["approver"] })

describe("OpCoSwitcher", () => {
  it("a user in two OpCos can switch back to seeing both", () => {
    session.current = { user: { realmRoles: [], organizations: [org("ghana", "CSquared Ghana"), org("uganda", "CSquared Uganda")] } }
    render(<OpCoSwitcher />)
    const values = screen.getAllByRole("option").map((o) => (o as HTMLOptionElement).value)
    expect(values).toEqual(["all", "ghana", "uganda"])
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("all")
  })

  it("a user in one OpCo gets no switcher", () => {
    session.current = { user: { realmRoles: [], organizations: [org("ghana", "CSquared Ghana")] } }
    const { container } = render(<OpCoSwitcher />)
    expect(container).toBeEmptyDOMElement()
  })
})
