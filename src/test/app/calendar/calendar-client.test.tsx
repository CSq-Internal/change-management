import { describe, it, expect, vi, beforeAll, afterAll } from "vitest"
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react"

vi.mock("@/lib/store", () => ({ useStore: () => ({ language: "en" }) }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
const { toast, deleteBlackoutPeriod } = vi.hoisted(() => ({ toast: vi.fn(), deleteBlackoutPeriod: vi.fn() }))
vi.mock("@/components/ui/toaster", () => ({ useToast: () => ({ toast }) }))
vi.mock("@/server/actions/changes", () => ({ rescheduleChange: vi.fn() }))
vi.mock("@/server/actions/blackout", () => ({ createBlackoutPeriod: vi.fn(), deleteBlackoutPeriod }))

import CalendarClient, { type CalDay, type CalChipData } from "@/app/(dashboard)/calendar/calendar-client"

const savedTz = process.env.TZ
beforeAll(() => { process.env.TZ = "Africa/Nairobi" }) // UTC+3
afterAll(() => { process.env.TZ = savedTz })

const october: CalDay[] = Array.from({ length: 31 }, (_, i) => ({
  key: `2026-10-${String(i + 1).padStart(2, "0")}`, inMonth: true, dayNum: i + 1,
}))
const chip = (id: string, title: string, startIso: string, endIso: string): CalChipData => ({
  id, title, opcoName: "Ghana", riskLevel: "low", status: "approved",
  startMs: Date.parse(startIso), endMs: Date.parse(endIso),
  overlap: false, blackout: false, severity: null, blackoutLabels: [], canReschedule: false,
})

const dayOf = (title: string) => screen.getAllByText(title)[0].closest("div.min-h-24")!.querySelector("div")!.textContent

describe("CalendarClient", () => {
  it("puts changes on the viewer's day, and a change from last month on day 1", () => {
    render(
      <CalendarClient monthLabel="October 2026" prevMonth="2026-09" nextMonth="2026-11" cells={october}
        chips={[
          chip("a", "Early fix", "2026-09-30T22:30:00Z", "2026-09-30T23:30:00Z"), // 01:30 on 1 Oct in Nairobi, 30 Sep in UTC
          chip("b", "Long migration", "2026-09-28T08:00:00Z", "2026-10-03T08:00:00Z"),
        ]} />,
    )
    expect(dayOf("Early fix")).toBe("1")
    expect(dayOf("Long migration")).toBe("1")
  })

  it("offers Remove only on blackouts the viewer may delete", () => {
    render(
      <CalendarClient monthLabel="October 2026" prevMonth="2026-09" nextMonth="2026-11" cells={october} chips={[]}
        canManageBlackouts blackoutScopes={[{ value: "ghana", label: "Ghana" }]}
        blackouts={[
          { id: "b1", label: "Ghana freeze", scopeName: "Ghana", opcoSlug: "ghana", startMs: 0, endMs: 1 },
          { id: "b2", label: "Group freeze", scopeName: "Group", opcoSlug: null, startMs: 0, endMs: 1 },
        ]} />,
    )
    const row = (label: string) => screen.getByText(label).closest("div.flex")! as HTMLElement
    expect(within(row("Ghana freeze")).queryByRole("button", { name: "Remove" })).toBeInTheDocument()
    expect(within(row("Group freeze")).queryByRole("button", { name: "Remove" })).not.toBeInTheDocument()
  })

  it("shades the days a blackout covers, for viewers who cannot manage blackouts too", () => {
    const { container } = render(
      <CalendarClient monthLabel="October 2026" prevMonth="2026-09" nextMonth="2026-11" cells={october} chips={[]}
        blackouts={[{ id: "b1", label: "Ghana freeze", scopeName: "Ghana", opcoSlug: "ghana",
          startMs: Date.parse("2026-10-09T21:00:00Z"), endMs: Date.parse("2026-10-11T21:00:00Z") }]} />, // 10-11 Oct, Nairobi
    )
    const cell = (n: number) => [...container.querySelectorAll("div.min-h-24")].find((c) => c.querySelector("div")!.textContent === String(n))!
    expect(cell(9).textContent).not.toContain("Ghana freeze")
    expect(cell(10).textContent).toContain("Ghana freeze")
    expect(cell(11).textContent).toContain("Ghana freeze")
    expect(cell(12).textContent).not.toContain("Ghana freeze")
    // Phones get the agenda, not the grid; the blackout is listed there as well.
    expect(container.querySelector("div.sm\\:hidden")!.textContent).toContain("Ghana freeze")
  })

  it("shows a server error's own words, though production hides its message", async () => {
    const { UserError } = await import("@/lib/user-error")
    const sent = new UserError("Forbidden: not authorized to remove this blackout period")
    deleteBlackoutPeriod.mockRejectedValue(Object.assign(new Error("An error occurred in the Server Components render."), { digest: sent.digest }))
    render(
      <CalendarClient monthLabel="October 2026" prevMonth="2026-09" nextMonth="2026-11" cells={october} chips={[]}
        canManageBlackouts blackoutScopes={[{ value: "ghana", label: "Ghana" }]}
        blackouts={[{ id: "b1", label: "Ghana freeze", scopeName: "Ghana", opcoSlug: "ghana", startMs: 0, endMs: 1 }]} />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Remove" }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      description: "Forbidden: not authorized to remove this blackout period", variant: "error",
    })))
  })
})
