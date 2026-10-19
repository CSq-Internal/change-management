import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

const joinOpCo = vi.fn()
const update = vi.fn()
const replace = vi.fn()
vi.mock("@/server/actions/access-requests", () => ({ joinOpCo: (...a: unknown[]) => joinOpCo(...a) }))
vi.mock("next-auth/react", () => ({ useSession: () => ({ update }) }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }))
let language = "en"
vi.mock("@/lib/store", () => ({ useStore: () => ({ language }) }))

import RequestAccessClient from "@/app/(dashboard)/request-access/request-access-client"

const opcos = [{ name: "CSquared Ghana", slug: "ghana" }, { name: "CSquared Uganda", slug: "uganda" }]

beforeEach(() => {
  vi.clearAllMocks()
  language = "en"
})

describe("RequestAccessClient (choose your OpCo)", () => {
  it("shows the OpCo picker and the requester notice", () => {
    render(<RequestAccessClient opcos={opcos} />)
    expect(screen.getByText("Choose your OpCo")).toBeInTheDocument()
    expect(screen.getByRole("combobox")).toBeInTheDocument()
    expect(screen.getByText(/You'll start as a requester/)).toBeInTheDocument()
    expect(screen.getByText(/request a role from Settings → Profile/)).toBeInTheDocument()
  })

  it("shows the notice in French", () => {
    language = "fr"
    render(<RequestAccessClient opcos={opcos} />)
    expect(screen.getByText(/Vous commencerez en tant que demandeur/)).toBeInTheDocument()
  })

  it("joins the chosen OpCo, refreshes the session, then goes to the dashboard", async () => {
    joinOpCo.mockResolvedValue({ ok: true })
    render(<RequestAccessClient opcos={opcos} />)
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "uganda" } })
    fireEvent.click(screen.getByRole("button", { name: "Continue" }))
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"))
    expect(joinOpCo).toHaveBeenCalledWith("uganda")
    // update() with no argument is a plain GET that never reaches the jwt callback as
    // trigger "update"; passing data makes it a POST, so the new OpCo lands at once.
    expect(update).toHaveBeenCalledWith(expect.any(Object))
  })

  it("shows the error and stays put when joining fails", async () => {
    joinOpCo.mockRejectedValue(new Error("You already belong to an OpCo"))
    render(<RequestAccessClient opcos={opcos} />)
    fireEvent.click(screen.getByRole("button", { name: "Continue" }))
    expect(await screen.findByText("You already belong to an OpCo")).toBeInTheDocument()
    expect(replace).not.toHaveBeenCalled()
  })

  it("shows the empty state when no OpCos exist", () => {
    render(<RequestAccessClient opcos={[]} />)
    expect(screen.getByText("No OpCos are set up yet. Contact your administrator.")).toBeInTheDocument()
  })
})
