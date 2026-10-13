import { describe, it, expect, afterEach } from "vitest"
import { render, cleanup } from "@testing-library/react"
import { QuorumProgress } from "@/components/quorum-progress"
import type { QuorumApproval } from "@/lib/cab-quorum"

afterEach(cleanup)

const renderText = (approvals: QuorumApproval[]) =>
  render(<div><QuorumProgress approvals={approvals} language="en" /></div>).container.textContent

describe("QuorumProgress", () => {
  it("shows progress below quorum", () => {
    expect(renderText([{ isCab: false, decision: "approve", approverId: "n1" }]))
      .toBe("CAB quorum: 1/2")
  })

  it("flags two approvals with no CAB vote", () => {
    expect(renderText([
      { isCab: false, decision: "approve", approverId: "n1" },
      { isCab: false, decision: "approve", approverId: "n2" },
    ])).toBe("CAB quorum: 2/2 (waiting for a CAB vote)")
  })

  it("shows plain progress once quorum includes a CAB vote", () => {
    expect(renderText([
      { isCab: true, decision: "approve", approverId: "c1" },
      { isCab: false, decision: "approve", approverId: "n1" },
    ])).toBe("CAB quorum: 2/2")
  })
})
