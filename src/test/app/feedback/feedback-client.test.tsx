import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react"

vi.mock("@/server/actions/feedback", () => ({ triageFeedback: vi.fn() }))
vi.mock("@/lib/store", () => ({ useStore: () => ({ language: "en" }) }))

import FeedbackClient from "@/app/(dashboard)/feedback/feedback-client"
import type { FeedbackRow } from "@/app/(dashboard)/feedback/types"
import { triageFeedback } from "@/server/actions/feedback"

const CUID = "clxyz0123456789abcdefghij"

const base: FeedbackRow = {
  id: "fb-1",
  category: "bug",
  severity: null,
  body: "Approve did nothing",
  route: `/changes/${CUID}`,
  changeId: CUID,
  roles: "ghana:approver",
  opcoSlugs: "ghana",
  authorName: "Ama Mensah",
  createdAt: "2026-10-14T09:00:00.000Z",
  triagedAt: null,
  outcome: null,
  triageNote: null,
}
const ROWS: FeedbackRow[] = [
  base,
  { ...base, id: "fb-2", category: "praise", body: "Love the calendar", opcoSlugs: "uganda", roles: "uganda:requester", changeId: null, route: "/calendar", authorName: "Kato" },
  { ...base, id: "fb-3", category: "missing", body: "Need CSV", triagedAt: "2026-10-14T10:00:00.000Z", outcome: "wont_fix", triageNote: "Out of scope", authorName: "Zed" },
]

const untriagedToggle = () => screen.getByLabelText(/untriaged only/i)
const rowFor = (text: string) => screen.getByText(text).closest("tr") as HTMLElement

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(triageFeedback).mockImplementation(async (id: string, outcome: string, note: string) => ({
    id, triagedAt: "2026-10-14T11:00:00.000Z", outcome: outcome as never, triageNote: note.trim() || null,
  }))
})

describe("FeedbackClient", () => {
  it("shows the comment, who wrote it, the screen and a link to the change", () => {
    render(<FeedbackClient rows={ROWS} />)
    expect(screen.getByText("Approve did nothing")).toBeInTheDocument()
    expect(screen.getByText("Ama Mensah")).toBeInTheDocument()
    expect(screen.getByText(`/changes/${CUID}`)).toBeInTheDocument()
    expect(within(rowFor("Approve did nothing")).getByRole("link")).toHaveAttribute("href", `/changes/${CUID}`)
  })

  it("renders a missing severity as a dash, never 'null'", () => {
    render(<FeedbackClient rows={ROWS} />)
    expect(screen.queryByText("null")).toBeNull()
    expect(within(rowFor("Approve did nothing")).getAllByText("—").length).toBeGreaterThan(0)
  })

  it("renders an empty state when there is nothing", () => {
    render(<FeedbackClient rows={[]} />)
    expect(screen.getByText(/no feedback yet/i)).toBeInTheDocument()
  })

  it("shows untriaged rows only by default, and all rows when unticked", () => {
    render(<FeedbackClient rows={ROWS} />)
    expect(untriagedToggle()).toBeChecked()
    expect(screen.queryByText("Need CSV")).toBeNull()
    fireEvent.click(untriagedToggle())
    const triaged = within(rowFor("Need CSV"))
    expect(triaged.getByText("Won't fix")).toBeInTheDocument()
    expect(triaged.getByText("Out of scope")).toBeInTheDocument()
    expect(triaged.queryByRole("button", { name: /mark triaged/i })).toBeNull()
  })

  it("filters by category and by OpCo", () => {
    render(<FeedbackClient rows={ROWS} />)
    fireEvent.change(screen.getByLabelText(/^category$/i), { target: { value: "praise" } })
    expect(screen.queryByText("Approve did nothing")).toBeNull()
    expect(screen.getByText("Love the calendar")).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/^category$/i), { target: { value: "" } })
    fireEvent.change(screen.getByLabelText(/^opco$/i), { target: { value: "ghana" } })
    expect(screen.getByText("Approve did nothing")).toBeInTheDocument()
    expect(screen.queryByText("Love the calendar")).toBeNull()
  })

  it("keeps Mark triaged disabled until an outcome is chosen", () => {
    render(<FeedbackClient rows={ROWS} />)
    const row = within(rowFor("Approve did nothing"))
    expect(row.getByRole("button", { name: /mark triaged/i })).toBeDisabled()
    fireEvent.change(row.getByLabelText(/outcome/i), { target: { value: "fixed" } })
    expect(row.getByRole("button", { name: /mark triaged/i })).toBeEnabled()
  })

  it("shows the note field only for outcomes that need one", () => {
    render(<FeedbackClient rows={ROWS} />)
    const row = within(rowFor("Approve did nothing"))
    fireEvent.change(row.getByLabelText(/outcome/i), { target: { value: "fixed" } })
    expect(row.queryByLabelText(/note/i)).toBeNull()
    fireEvent.change(row.getByLabelText(/outcome/i), { target: { value: "deferred" } })
    expect(row.getByLabelText(/note/i)).toBeInTheDocument()
  })

  it("triages a row and shows its outcome in place", async () => {
    render(<FeedbackClient rows={ROWS} />)
    fireEvent.click(untriagedToggle())
    const row = within(rowFor("Approve did nothing"))
    fireEvent.change(row.getByLabelText(/outcome/i), { target: { value: "deferred" } })
    fireEvent.change(row.getByLabelText(/note/i), { target: { value: "After rollout" } })
    fireEvent.click(row.getByRole("button", { name: /mark triaged/i }))
    await waitFor(() => expect(triageFeedback).toHaveBeenCalledWith("fb-1", "deferred", "After rollout"))
    expect(await within(rowFor("Approve did nothing")).findByText("Deferred")).toBeInTheDocument()
    expect(within(rowFor("Approve did nothing")).getByText("After rollout")).toBeInTheDocument()
  })

  it("shows the server's error inline and keeps the row untriaged", async () => {
    vi.mocked(triageFeedback).mockRejectedValue(new Error("Feedback is already triaged"))
    render(<FeedbackClient rows={ROWS} />)
    const row = within(rowFor("Approve did nothing"))
    fireEvent.change(row.getByLabelText(/outcome/i), { target: { value: "fixed" } })
    fireEvent.click(row.getByRole("button", { name: /mark triaged/i }))
    expect(await row.findByText("Feedback is already triaged")).toBeInTheDocument()
    expect(row.getByRole("button", { name: /mark triaged/i })).toBeInTheDocument()
  })
})
