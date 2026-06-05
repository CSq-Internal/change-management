import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import OpcoList from "@/app/(dashboard)/opcos/opco-list"
import type { DbOpCo } from "@/app/(dashboard)/opcos/types"

const opcos: DbOpCo[] = [
  { id: "o1", name: "Ghana", slug: "ghana", locale: "en", archived: false },
  { id: "o2", name: "Uganda", slug: "uganda", locale: "en", archived: true },
]

describe("OpcoList", () => {
  it("renders OpCo rows with status", () => {
    render(<OpcoList opcos={opcos} language="en" onRename={vi.fn()} onArchiveToggle={vi.fn()} />)
    expect(screen.getByText("Ghana")).toBeInTheDocument()
    expect(screen.getByText("Active")).toBeInTheDocument()
    expect(screen.getByText("Archived")).toBeInTheDocument()
  })

  it("shows an empty state", () => {
    render(<OpcoList opcos={[]} language="en" onRename={vi.fn()} onArchiveToggle={vi.fn()} />)
    expect(screen.getByText("No OpCos yet.")).toBeInTheDocument()
  })
})
