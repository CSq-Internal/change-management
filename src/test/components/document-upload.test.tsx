import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import DocumentUpload from "@/components/document-upload"

describe("DocumentUpload", () => {
  it("shows the draft-first hint when there is no changeId", () => {
    render(<DocumentUpload changeId={null} kind="impact_scope" label="Impact & Scope" />)
    expect(screen.getByText(/Save as draft first/i)).toBeInTheDocument()
  })

  it("shows the current filename when an attachment exists", () => {
    render(
      <DocumentUpload
        changeId="cr-1" kind="impact_scope" label="Impact & Scope"
        current={{ id: "att-1", filename: "impact.pdf" }}
      />
    )
    expect(screen.getByText("impact.pdf")).toBeInTheDocument()
  })
})
