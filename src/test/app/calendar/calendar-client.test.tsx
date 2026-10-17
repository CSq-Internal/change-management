import { describe, it, expect, vi, beforeAll, afterAll } from "vitest"
import { render, screen } from "@testing-library/react"

vi.mock("@/lib/store", () => ({ useStore: () => ({ language: "en" }) }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("@/components/ui/toaster", () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock("@/server/actions/changes", () => ({ rescheduleChange: vi.fn() }))
vi.mock("@/server/actions/blackout", () => ({ createBlackoutPeriod: vi.fn(), deleteBlackoutPeriod: vi.fn() }))

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
})
