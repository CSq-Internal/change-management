import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import DocumentSection from "@/components/document-section"

describe("DocumentSection", () => {
  it("shows the choose-file action and hint when nothing is selected", () => {
    render(
      <DocumentSection kind="impact_scope" label="Impact & Scope" onFileChange={() => {}} />
    )
    expect(screen.getByRole("button", { name: /choose file/i })).toBeInTheDocument()
  })

  it("renders the optional summary textarea only when hasSummary", () => {
    const { rerender } = render(
      <DocumentSection kind="impact_scope" label="Impact & Scope" hasSummary onFileChange={() => {}} />
    )
    expect(screen.getByRole("textbox")).toBeInTheDocument()
    rerender(
      <DocumentSection kind="solution_document" label="Solution Document" hasSummary={false} onFileChange={() => {}} />
    )
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
  })

  it("shows the existing filename for an already-uploaded slot", () => {
    render(
      <DocumentSection
        kind="impact_scope" label="Impact & Scope"
        existingFilename="impact.pdf" onFileChange={() => {}}
      />
    )
    expect(screen.getByText("impact.pdf")).toBeInTheDocument()
    expect(screen.getByText(/current file/i)).toBeInTheDocument()
  })

  it("marks a staged file as pending upload", () => {
    const file = new File([new Uint8Array([1, 2, 3])], "impact.pdf", { type: "application/pdf" })
    render(
      <DocumentSection
        kind="impact_scope" label="Impact & Scope"
        stagedFile={file} onFileChange={() => {}}
      />
    )
    expect(screen.getByText("impact.pdf")).toBeInTheDocument()
    expect(screen.getByText(/pending upload/i)).toBeInTheDocument()
  })

  it("rejects a disallowed file type and does not stage it", () => {
    const onFileChange = vi.fn()
    const { container } = render(
      <DocumentSection kind="impact_scope" label="Impact & Scope" onFileChange={onFileChange} />
    )
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const exe = new File([new Uint8Array([1])], "malware.exe", { type: "application/x-msdownload" })
    fireEvent.change(input, { target: { files: [exe] } })
    expect(onFileChange).not.toHaveBeenCalled()
    expect(screen.getByText(/unsupported file type/i)).toBeInTheDocument()
  })

  it("accepts a valid file and stages it", () => {
    const onFileChange = vi.fn()
    const { container } = render(
      <DocumentSection kind="impact_scope" label="Impact & Scope" onFileChange={onFileChange} />
    )
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const pdf = new File([new Uint8Array([1, 2, 3])], "impact.pdf", { type: "application/pdf" })
    fireEvent.change(input, { target: { files: [pdf] } })
    expect(onFileChange).toHaveBeenCalledWith(pdf)
  })

  it("shows both source toggles (upload file / link a Google Doc)", () => {
    render(<DocumentSection kind="impact_scope" label="Impact & Scope" onFileChange={() => {}} onLinkChange={() => {}} />)
    expect(screen.getByRole("button", { name: /upload file/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /link a google doc/i })).toBeInTheDocument()
  })

  it("stages a valid Google link", () => {
    const onLinkChange = vi.fn()
    render(<DocumentSection kind="impact_scope" label="Impact & Scope" onFileChange={() => {}} onLinkChange={onLinkChange} />)
    fireEvent.click(screen.getByRole("button", { name: /link a google doc/i }))
    const input = screen.getByPlaceholderText(/paste a google/i)
    fireEvent.change(input, { target: { value: "https://docs.google.com/document/d/abc/edit" } })
    expect(onLinkChange).toHaveBeenCalledWith("https://docs.google.com/document/d/abc/edit")
  })

  it("rejects a non-Google link and does not stage it", () => {
    const onLinkChange = vi.fn()
    render(<DocumentSection kind="impact_scope" label="Impact & Scope" onFileChange={() => {}} onLinkChange={onLinkChange} />)
    fireEvent.click(screen.getByRole("button", { name: /link a google doc/i }))
    const input = screen.getByPlaceholderText(/paste a google/i)
    fireEvent.change(input, { target: { value: "https://example.com/doc" } })
    expect(onLinkChange).toHaveBeenLastCalledWith(null)
    expect(screen.getByText(/valid google/i)).toBeInTheDocument()
  })
})
