import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

vi.mock("@/server/actions/feedback", () => ({ submitFeedback: vi.fn() }))
const store = { language: "en" as "en" | "fr" }
vi.mock("@/lib/store", () => ({ useStore: () => store }))

import { FeedbackWidget } from "@/components/feedback-widget"
import { submitFeedback } from "@/server/actions/feedback"

const CUID = "clxyz0123456789abcdefghij"

function open(route = "/requests") {
  render(<FeedbackWidget route={route} />)
  fireEvent.click(screen.getByRole("button", { name: /feedback/i }))
}
const typeSel = () => screen.getByLabelText(/^type$/i)
const bodyBox = () => screen.getByLabelText(/what happened/i)
const sendBtn = () => screen.getByRole("button", { name: /send feedback/i })

beforeEach(() => {
  vi.clearAllMocks()
  store.language = "en"
  vi.mocked(submitFeedback).mockResolvedValue({ id: "fb-1" })
})

describe("FeedbackWidget", () => {
  it("opens the form from the trigger", () => {
    open()
    expect(screen.getByRole("dialog")).toBeInTheDocument()
  })

  it("renders the dialog outside its parent, so the blurred header cannot clip it", () => {
    const { container } = render(<FeedbackWidget route="/cab" />)
    fireEvent.click(screen.getByRole("button", { name: /feedback/i }))
    expect(container.contains(screen.getByRole("dialog"))).toBe(false)
  })

  it("will not submit without a category", () => {
    open()
    fireEvent.change(bodyBox(), { target: { value: "I could not find where to do this" } })
    expect(sendBtn()).toBeDisabled()
    fireEvent.click(sendBtn())
    expect(submitFeedback).not.toHaveBeenCalled()
  })

  it("will not submit an empty or whitespace-only comment", () => {
    open()
    fireEvent.change(typeSel(), { target: { value: "bug" } })
    fireEvent.change(bodyBox(), { target: { value: "   " } })
    expect(sendBtn()).toBeDisabled()
    fireEvent.click(sendBtn())
    expect(submitFeedback).not.toHaveBeenCalled()
  })

  it("offers severity only for a bug, defaulting to major", () => {
    open()
    expect(screen.queryByLabelText(/severity/i)).toBeNull()
    fireEvent.change(typeSel(), { target: { value: "bug" } })
    expect(screen.getByLabelText(/severity/i)).toHaveValue("major")
    fireEvent.change(typeSel(), { target: { value: "praise" } })
    expect(screen.queryByLabelText(/severity/i)).toBeNull()
  })

  it("posts the captured context alongside the text", async () => {
    open(`/changes/${CUID}`)
    fireEvent.change(typeSel(), { target: { value: "bug" } })
    fireEvent.change(bodyBox(), { target: { value: "  Approve did nothing  " } })
    fireEvent.click(sendBtn())
    await waitFor(() => expect(submitFeedback).toHaveBeenCalled())
    const arg = vi.mocked(submitFeedback).mock.calls[0][0]
    expect(arg).toMatchObject({
      category: "bug",
      severity: "major",
      body: "Approve did nothing",
      route: `/changes/${CUID}`,
      changeId: CUID,
      locale: "en",
    })
    expect(arg.viewport).toMatch(/^\d+x\d+$/)
  })

  it("sends a null severity and changeId when neither applies", async () => {
    open("/requests")
    fireEvent.change(typeSel(), { target: { value: "missing" } })
    fireEvent.change(bodyBox(), { target: { value: "Need a CSV export" } })
    fireEvent.click(sendBtn())
    await waitFor(() => expect(submitFeedback).toHaveBeenCalled())
    expect(vi.mocked(submitFeedback).mock.calls[0][0]).toMatchObject({ severity: null, changeId: null })
  })

  it("thanks the writer once it has been received", async () => {
    open()
    fireEvent.change(typeSel(), { target: { value: "praise" } })
    fireEvent.change(bodyBox(), { target: { value: "Looks good" } })
    fireEvent.click(sendBtn())
    expect(await screen.findByText(/thank you/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/what happened/i)).toBeNull()
  })

  it("tells the writer when it failed, keeps the form and never claims success", async () => {
    vi.mocked(submitFeedback).mockRejectedValue(new Error("boom"))
    open()
    fireEvent.change(typeSel(), { target: { value: "bug" } })
    fireEvent.change(bodyBox(), { target: { value: "Broken" } })
    fireEvent.click(sendBtn())
    expect(await screen.findByText(/did not send/i)).toBeInTheDocument()
    expect(screen.queryByText(/thank you/i)).toBeNull()
    expect(bodyBox()).toHaveValue("Broken")
  })

  it("resets when closed", () => {
    open()
    fireEvent.change(bodyBox(), { target: { value: "draft" } })
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }))
    expect(screen.queryByRole("dialog")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: /feedback/i }))
    expect(bodyBox()).toHaveValue("")
  })
})

describe("FeedbackWidget in French", () => {
  it("labels the trigger, the form and the categories in French", () => {
    store.language = "fr"
    render(<FeedbackWidget route="/requests" />)
    fireEvent.click(screen.getByRole("button", { name: "Retour d'expérience" }))
    expect(screen.getByText("Envoyer un retour")).toBeInTheDocument()
    expect(screen.getByText(/Nous enregistrons l'écran/)).toBeInTheDocument()
    expect(screen.getByText("Quelque chose ne fonctionne pas")).toBeInTheDocument()
    expect(screen.queryByText(/Something is broken|Send feedback|What happened/)).toBeNull()
  })
})
