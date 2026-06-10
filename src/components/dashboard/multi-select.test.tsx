import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@testing-library/react"
import { MultiSelect } from "@/components/dashboard/multi-select"

afterEach(cleanup)

const options = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
]

describe("MultiSelect", () => {
  it("shows a count badge for selected items", () => {
    render(<MultiSelect label="Things" options={options} selected={["a"]} onChange={() => {}} />)
    expect(screen.getByText("1")).toBeInTheDocument()
  })
  it("toggles a value on checkbox change", () => {
    const onChange = vi.fn()
    render(<MultiSelect label="Things" options={options} selected={["a"]} onChange={onChange} />)
    fireEvent.click(screen.getByLabelText("Beta"))
    expect(onChange).toHaveBeenCalledWith(["a", "b"])
  })
  it("removes a value that was already selected", () => {
    const onChange = vi.fn()
    render(<MultiSelect label="Things" options={options} selected={["a", "b"]} onChange={onChange} />)
    fireEvent.click(screen.getByLabelText("Alpha"))
    expect(onChange).toHaveBeenCalledWith(["b"])
  })
})
