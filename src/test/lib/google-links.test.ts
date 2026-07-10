import { describe, it, expect } from "vitest"
import { isGoogleWorkspaceUrl } from "@/lib/google-links"

describe("isGoogleWorkspaceUrl", () => {
  it("accepts a Google Docs link", () => {
    expect(isGoogleWorkspaceUrl("https://docs.google.com/document/d/abc123/edit")).toBe(true)
  })
  it("accepts a Google Sheets link", () => {
    expect(isGoogleWorkspaceUrl("https://docs.google.com/spreadsheets/d/abc/edit#gid=0")).toBe(true)
  })
  it("accepts a Google Slides link", () => {
    expect(isGoogleWorkspaceUrl("https://docs.google.com/presentation/d/abc/edit")).toBe(true)
  })
  it("accepts a Drive file link", () => {
    expect(isGoogleWorkspaceUrl("https://drive.google.com/file/d/abc/view")).toBe(true)
  })
  it("rejects a non-Google host", () => {
    expect(isGoogleWorkspaceUrl("https://example.com/doc")).toBe(false)
  })
  it("rejects a look-alike host", () => {
    expect(isGoogleWorkspaceUrl("https://docs.google.com.evil.com/x")).toBe(false)
  })
  it("rejects http (non-https)", () => {
    expect(isGoogleWorkspaceUrl("http://docs.google.com/document/d/abc/edit")).toBe(false)
  })
  it("rejects garbage / non-URL input", () => {
    expect(isGoogleWorkspaceUrl("not a url")).toBe(false)
    expect(isGoogleWorkspaceUrl("")).toBe(false)
  })
})
