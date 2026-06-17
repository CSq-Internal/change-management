import { describe, it, expect, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { StatusPill, RiskPill } from "@/components/change-badges"
import { useStore } from "@/lib/store"

afterEach(() => {
  cleanup()
  useStore.getState().setLanguage("en")
  localStorage.clear()
})

describe("StatusPill / RiskPill localization", () => {
  it("renders English status and risk labels by default", () => {
    render(<><StatusPill status="pending" /><RiskPill risk="high" /></>)
    expect(screen.getByText("Pending")).toBeInTheDocument()
    expect(screen.getByText("High")).toBeInTheDocument()
  })

  it("renders French status and risk labels when language is fr", () => {
    useStore.getState().setLanguage("fr")
    render(<><StatusPill status="pending" /><RiskPill risk="high" /></>)
    expect(screen.getByText("En attente")).toBeInTheDocument()
    expect(screen.getByText("Élevé")).toBeInTheDocument()
  })

  it("falls back to the raw value for an unknown status", () => {
    render(<StatusPill status="mystery" />)
    expect(screen.getByText("status.mystery")).toBeInTheDocument()
  })
})
