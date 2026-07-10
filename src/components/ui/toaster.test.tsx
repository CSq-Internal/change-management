import { describe, it, expect, afterEach, vi } from "vitest"
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react"
import { Toaster, useToast } from "@/components/ui/toaster"

// A separate component that raises a toast, mirroring the real app where
// useToast() is called from page/route components while <Toaster> is mounted
// in the shell. Regression guard for the bug where writer and reader ended up
// on different store instances and no toast ever rendered.
function Trigger() {
  const { toast } = useToast()
  return (
    <button onClick={() => toast({ title: "Saved changes", description: "All good", variant: "success" })}>
      fire
    </button>
  )
}

afterEach(() => {
  cleanup()
  // Reset the (globalThis-pinned singleton) store so toasts don't leak between tests.
  const store = (globalThis as unknown as { __toastStore?: { setState: (s: { toasts: [] }) => void } }).__toastStore
  store?.setState({ toasts: [] })
})

describe("Toaster", () => {
  it("renders a toast raised from a separate component via useToast()", () => {
    render(
      <>
        <Trigger />
        <Toaster />
      </>
    )
    expect(screen.queryByText("Saved changes")).toBeNull()

    fireEvent.click(screen.getByText("fire"))

    expect(screen.getByText("Saved changes")).toBeInTheDocument()
    expect(screen.getByText("All good")).toBeInTheDocument()
  })

  it("auto-dismisses the toast after the timeout", () => {
    vi.useFakeTimers()
    try {
      render(
        <>
          <Trigger />
          <Toaster />
        </>
      )
      fireEvent.click(screen.getByText("fire"))
      expect(screen.getByText("Saved changes")).toBeInTheDocument()

      act(() => {
        vi.advanceTimersByTime(4000)
      })
      expect(screen.queryByText("Saved changes")).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
