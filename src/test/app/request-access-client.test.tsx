import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

const joinOpCo = vi.fn()
const update = vi.fn()
const replace = vi.fn()
vi.mock("@/server/actions/access-requests", () => ({ joinOpCo: (...a: unknown[]) => joinOpCo(...a) }))
let status = "authenticated"
vi.mock("next-auth/react", () => ({ useSession: () => ({ update, status }) }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }))
let language = "en"
vi.mock("@/lib/store", () => ({ useStore: () => ({ language }) }))

import RequestAccessClient from "@/app/(dashboard)/request-access/request-access-client"

const opcos = [{ name: "CSquared Ghana", slug: "ghana" }, { name: "CSquared Uganda", slug: "uganda" }]

beforeEach(() => {
  vi.clearAllMocks()
  language = "en"
  status = "authenticated"
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

  it("with access already granted, refreshes the session cookie before leaving", async () => {
    // The server saw the access on its 60s refresh, but the cookie the proxy reads is stale;
    // a server redirect to / would bounce straight back here.
    update.mockResolvedValue({})
    render(<RequestAccessClient opcos={[]} hasAccess />)
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"))
    expect(update).toHaveBeenCalledWith({})
    expect(update.mock.invocationCallOrder[0]).toBeLessThan(replace.mock.invocationCallOrder[0])
  })

  it("waits for the first session load, since update() is a no-op while it is loading", async () => {
    update.mockResolvedValue({})
    status = "loading"
    const { rerender } = render(<RequestAccessClient opcos={[]} hasAccess />)
    expect(update).not.toHaveBeenCalled()
    status = "authenticated"
    rerender(<RequestAccessClient opcos={[]} hasAccess />)
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"))
    status = "loading" // update() itself flips status while it fetches
    rerender(<RequestAccessClient opcos={[]} hasAccess />)
    status = "authenticated"
    rerender(<RequestAccessClient opcos={[]} hasAccess />)
    expect(update).toHaveBeenCalledTimes(1)
  })
})
