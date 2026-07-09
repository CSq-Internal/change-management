# Google Doc Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a requester satisfy any of the five change-request document slots with either an uploaded file (unchanged) or a pasted link to a Google Workspace document.

**Architecture:** One `Attachment` row represents either a stored file (`storageKey`) or a link (`externalUrl`); the `@@unique([changeId, kind])` constraint keeps each slot to one or the other. A pure URL-validation helper gates links on client and server. The document API route branches on content-type (multipart → file, JSON → link). The form stages links alongside files and posts them in the same atomic save; the detail page renders link attachments as external anchors.

**Tech Stack:** Next.js 16 App Router, Prisma v7 (`@prisma/adapter-pg`), NextAuth v5, React + Zustand, Vitest + React Testing Library.

## Global Constraints

- Package manager is **pnpm** (never npm). Type-check with `pnpm tsc --noEmit`; test with `pnpm test`.
- Links are restricted to hosts `docs.google.com` and `drive.google.com` over `https:` only.
- `googleapis` / `@googleapis/drive` must stay **off** the link path — link handling is pure URL parsing, no Drive SDK.
- All user-visible strings go through `t(language, key)` with **both** `en` and `fr` entries in `src/lib/i18n.ts`.
- **No `Co-Authored-By` trailers** in commit messages.
- Local dev DB runs on port **5433**: `DATABASE_URL='postgresql://postgres:postgres@localhost:5433/csquared_cms'`.
- Invariant on every write: exactly one of `storageKey` / `externalUrl` is non-null on an `Attachment` row.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `prisma/schema.prisma` + new migration | `Attachment.storageKey` nullable, add `Attachment.externalUrl` |
| `src/lib/google-links.ts` (new) | `isGoogleWorkspaceUrl` — client-safe URL validation |
| `src/test/lib/google-links.test.ts` (new) | validation unit tests |
| `src/server/documents.ts` | `attachLink`; link guard in `getDocumentForDownload` |
| `src/test/server/documents.test.ts` | `attachLink` + download-guard tests |
| `src/app/api/changes/[id]/documents/route.ts` | JSON branch → `attachLink` |
| `src/components/document-section.tsx` | file/link source toggle + link input |
| `src/test/components/document-section.test.tsx` | toggle + link-input tests |
| `src/app/(dashboard)/requests/request-form.tsx` | staged links, POST links, satisfaction check |
| `src/app/(dashboard)/changes/[id]/page.tsx` | pass `externalUrl` through to detail client |
| `src/app/(dashboard)/changes/[id]/edit/page.tsx` | pass `externalUrl` through to the form |
| `src/app/(dashboard)/changes/[id]/change-detail-client.tsx` | render link attachments as external anchors |
| `src/lib/i18n.ts` | EN + FR strings for toggle, link input, errors, detail affordance |

---

### Task 1: Data model — nullable `storageKey` + `externalUrl`

**Files:**
- Modify: `prisma/schema.prisma:276-291` (model `Attachment`)
- Create: `prisma/migrations/<timestamp>_google_doc_links/migration.sql` (generated)

**Interfaces:**
- Produces: `Attachment.storageKey: string | null`, `Attachment.externalUrl: string | null` on the generated Prisma client — consumed by Tasks 3, 7, 8.

- [ ] **Step 1: Edit the `Attachment` model**

In `prisma/schema.prisma`, change the `storageKey` line and add `externalUrl` directly under it:

```prisma
model Attachment {
  id           String         @id @default(cuid())
  changeId     String
  change       ChangeRequest  @relation(fields: [changeId], references: [id])
  kind         AttachmentKind
  filename     String
  storageKey   String?        // Google Drive file ID (null when this slot is an external link)
  externalUrl  String?        // Google Workspace link (null when this slot is an uploaded file)
  mimeType     String?
  sizeBytes    Int?
  uploadedById String
  uploadedBy   User           @relation("UploadedAttachments", fields: [uploadedById], references: [id])
  uploadedAt   DateTime       @default(now())

  @@unique([changeId, kind])
  @@index([changeId])
}
```

- [ ] **Step 2: Create the migration against the local DB**

Run:
```bash
DATABASE_URL='postgresql://postgres:postgres@localhost:5433/csquared_cms' \
  pnpm prisma migrate dev --name google_doc_links
```
Expected: a new folder `prisma/migrations/<timestamp>_google_doc_links/` whose `migration.sql` contains:
```sql
ALTER TABLE "Attachment" ALTER COLUMN "storageKey" DROP NOT NULL;
ALTER TABLE "Attachment" ADD COLUMN "externalUrl" TEXT;
```
and "Your database is now in sync with your schema."

- [ ] **Step 3: Regenerate the client (if migrate didn't already)**

Run: `pnpm prisma generate`
Expected: "Generated Prisma Client" — `externalUrl` now typed on the `Attachment` delegate.

- [ ] **Step 4: Type-check**

Run: `pnpm tsc --noEmit`
Expected: PASS (existing code that reads `storageKey` still compiles; it was always read where non-null).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): allow an attachment to be a Google Workspace link (nullable storageKey + externalUrl)"
```

---

### Task 2: URL validation helper

**Files:**
- Create: `src/lib/google-links.ts`
- Create: `src/test/lib/google-links.test.ts`

**Interfaces:**
- Produces: `isGoogleWorkspaceUrl(url: string): boolean` — consumed by Tasks 3 (server), 5 (component).

- [ ] **Step 1: Write the failing test**

Create `src/test/lib/google-links.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/test/lib/google-links.test.ts`
Expected: FAIL — cannot resolve `@/lib/google-links`.

- [ ] **Step 3: Implement the helper**

Create `src/lib/google-links.ts`:

```ts
// Client-safe: pure URL parsing, no googleapis import. Used by both the request
// form (inline validation) and the server (authoritative gate).
const ALLOWED_HOSTS = new Set(["docs.google.com", "drive.google.com"])

export function isGoogleWorkspaceUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  return parsed.protocol === "https:" && ALLOWED_HOSTS.has(parsed.hostname)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/test/lib/google-links.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/google-links.ts src/test/lib/google-links.test.ts
git commit -m "feat(links): add isGoogleWorkspaceUrl validation helper"
```

---

### Task 3: Server — `attachLink` + download guard

**Files:**
- Modify: `src/server/documents.ts` (add `attachLink`; guard in `getDocumentForDownload`)
- Modify: `src/test/server/documents.test.ts` (add tests)

**Interfaces:**
- Consumes: `isGoogleWorkspaceUrl` (Task 2); `Attachment.externalUrl` (Task 1).
- Produces: `attachLink(input: { changeId: string; kind: AttachmentKind; url: string }): Promise<Attachment>` — consumed by Task 4.

- [ ] **Step 1: Write the failing tests**

In `src/test/server/documents.test.ts`, add `externalUrl: null` to the `attachment.findUnique` mock (so download tests still model a file row), then append these suites after the existing `getDocumentForDownload` block. Also update the import line.

Change the import at the top:
```ts
import { attachDocument, attachLink, getDocumentForDownload } from "@/server/documents"
```

Extend the `attachment.findUnique` mock inside `mockDb` to include `externalUrl: null`:
```ts
    findUnique: vi.fn().mockResolvedValue({
      id: "att-1", changeId: "cr-1", kind: "impact_scope",
      filename: "impact.pdf", mimeType: "application/pdf", storageKey: "drive-file-1", externalUrl: null,
    }),
```

Append:
```ts
describe("attachLink", () => {
  const goodUrl = "https://docs.google.com/document/d/abc123/edit"

  it("upserts a link attachment and writes a document_linked audit row", async () => {
    mockDb.attachment.upsert.mockResolvedValueOnce({
      id: "att-2", kind: "impact_scope", filename: goodUrl, externalUrl: goodUrl,
    })
    const result = await attachLink({ changeId: "cr-1", kind: "impact_scope", url: goodUrl })
    expect(result).toHaveProperty("externalUrl", goodUrl)
    expect(mockDb.attachment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ externalUrl: goodUrl, storageKey: null }),
        update: expect.objectContaining({ externalUrl: goodUrl, storageKey: null }),
      })
    )
    expect(mockDb.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "document_linked" }) })
    )
  })

  it("rejects a non-Google URL", async () => {
    await expect(
      attachLink({ changeId: "cr-1", kind: "impact_scope", url: "https://example.com/x" })
    ).rejects.toThrow(/google/i)
  })

  it("forbids a non-requester non-admin from linking", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ugandaSession)
    mockDb.user.findUnique.mockResolvedValueOnce({ id: "user-ug", keycloakId: "kc-ug" })
    await expect(
      attachLink({ changeId: "cr-1", kind: "impact_scope", url: goodUrl })
    ).rejects.toThrow(/Forbidden/)
  })

  it("forbids linking on a non-draft change", async () => {
    mockDb.changeRequest.findUnique.mockResolvedValueOnce({
      id: "cr-1", status: "pending", opcoId: "opco-1", requesterId: "user-1",
      reference: 42, title: "Router update", driveFolderId: "folder-1", createdAt: new Date(),
      opco: { slug: "ghana", name: "Ghana" },
    })
    await expect(
      attachLink({ changeId: "cr-1", kind: "impact_scope", url: goodUrl })
    ).rejects.toThrow(/draft/i)
  })
})

describe("getDocumentForDownload — link guard", () => {
  it("rejects downloading a link attachment", async () => {
    mockDb.attachment.findUnique.mockResolvedValueOnce({
      id: "att-2", changeId: "cr-1", kind: "impact_scope",
      filename: "https://docs.google.com/document/d/abc/edit", mimeType: null,
      storageKey: null, externalUrl: "https://docs.google.com/document/d/abc/edit",
    })
    await expect(
      getDocumentForDownload({ changeId: "cr-1", attachmentId: "att-2" })
    ).rejects.toThrow(/external link/i)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/test/server/documents.test.ts`
Expected: FAIL — `attachLink` is not exported.

- [ ] **Step 3: Implement `attachLink` and the download guard**

In `src/server/documents.ts`, add the import near the top (after the existing imports):
```ts
import { isGoogleWorkspaceUrl } from "@/lib/google-links"
```

Add `attachLink` (place it after `attachDocument`):
```ts
export async function attachLink(input: { changeId: string; kind: AttachmentKind; url: string }) {
  if (!isGoogleWorkspaceUrl(input.url)) {
    throw new Error("Link must be a Google Docs, Sheets, Slides, or Drive URL")
  }

  const session = await getAppSession()
  const db = getPrisma()
  const user = await db.user.findUnique({ where: { keycloakId: session.keycloakId } })
  if (!user) throw new Error("User not found")

  const change = await db.changeRequest.findUnique({
    where: { id: input.changeId },
    include: { opco: true },
  })
  if (!change) throw new Error("Change not found")

  const isAdmin = isGroupAdmin(session.realmRoles) ||
    hasRoleInOpCo(session.organizations, change.opco.slug, "admin")
  if (change.requesterId !== user.id && !isAdmin) {
    throw new Error("Forbidden: only the requester or an admin can link documents")
  }
  if (change.status !== "draft") throw new Error("Documents can only be linked on a draft change")

  const attachment = await db.attachment.upsert({
    where: { changeId_kind: { changeId: change.id, kind: input.kind } },
    create: {
      changeId: change.id, kind: input.kind, filename: input.url,
      storageKey: null, externalUrl: input.url, mimeType: null, sizeBytes: null,
      uploadedById: user.id,
    },
    update: {
      filename: input.url, storageKey: null, externalUrl: input.url,
      mimeType: null, sizeBytes: null, uploadedById: user.id,
    },
  })

  await db.auditLog.create({
    data: {
      changeId: change.id, actorId: user.id, action: "document_linked",
      metadata: { attachmentId: attachment.id, kind: input.kind, url: input.url },
    },
  })

  return attachment
}
```

In `getDocumentForDownload`, add the guard immediately after the `attachment` existence check (after the line `if (!attachment || attachment.changeId !== change.id) throw new Error("Attachment not found")`):
```ts
  if (attachment.externalUrl || !attachment.storageKey) {
    throw new Error("This document is an external link — open it in Google instead")
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test src/test/server/documents.test.ts`
Expected: PASS (existing tests + 5 new).

- [ ] **Step 5: Commit**

```bash
git add src/server/documents.ts src/test/server/documents.test.ts
git commit -m "feat(documents): attachLink server action + external-link download guard"
```

---

### Task 4: API route — JSON branch

**Files:**
- Modify: `src/app/api/changes/[id]/documents/route.ts`

**Interfaces:**
- Consumes: `attachLink` (Task 3).
- Produces: `POST /api/changes/[id]/documents` with `content-type: application/json` body `{ kind, url }` → link attachment JSON — consumed by Task 6.

- [ ] **Step 1: Rewrite the route to branch on content-type**

Replace the full contents of `src/app/api/changes/[id]/documents/route.ts`:

```ts
import { NextResponse } from "next/server"
import { attachDocument, attachLink } from "@/server/documents"
import { REQUIRED_DOC_KINDS } from "@/lib/attachment-kinds"
import type { AttachmentKind } from "@prisma/client"

function isValidKind(kind: unknown): kind is AttachmentKind {
  return typeof kind === "string" && REQUIRED_DOC_KINDS.includes(kind as AttachmentKind)
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const contentType = req.headers.get("content-type") ?? ""

  try {
    if (contentType.includes("application/json")) {
      const body = (await req.json()) as { kind?: unknown; url?: unknown }
      if (!isValidKind(body.kind)) {
        return NextResponse.json({ error: "Invalid or missing document kind" }, { status: 400 })
      }
      if (typeof body.url !== "string" || body.url.trim() === "") {
        return NextResponse.json({ error: "Missing link URL" }, { status: 400 })
      }
      const attachment = await attachLink({ changeId: id, kind: body.kind, url: body.url })
      return NextResponse.json(attachment)
    }

    const form = await req.formData()
    const kind = form.get("kind")
    const file = form.get("file")
    if (!isValidKind(kind)) {
      return NextResponse.json({ error: "Invalid or missing document kind" }, { status: 400 })
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 })
    }
    const buffer = Buffer.from(await file.arrayBuffer())
    const attachment = await attachDocument({
      changeId: id, kind, filename: file.name, mimeType: file.type, buffer,
    })
    return NextResponse.json(attachment)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed"
    const status = message.startsWith("Forbidden") ? 403 : 400
    return NextResponse.json({ error: message }, { status })
  }
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Run the full suite (no regressions)**

Run: `pnpm test`
Expected: PASS (all green).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/changes/[id]/documents/route.ts
git commit -m "feat(api): documents route accepts a JSON link payload"
```

---

### Task 5: `DocumentSection` — file/link source toggle

**Files:**
- Modify: `src/components/document-section.tsx`
- Modify: `src/test/components/document-section.test.tsx`
- Modify: `src/lib/i18n.ts` (add the strings this component uses)

**Interfaces:**
- Consumes: `isGoogleWorkspaceUrl` (Task 2).
- Produces: `DocumentSection` props `existingLink?: string`, `stagedLink?: string | null`, `onLinkChange?: (url: string | null) => void` — consumed by Task 6.

- [ ] **Step 1: Add i18n strings (EN + FR)**

In `src/lib/i18n.ts`, in the `en` block near the other `requests.upload*` keys (around line 449), add:
```ts
    "requests.docSourceFile": "Upload file",
    "requests.docSourceLink": "Link a Google Doc",
    "requests.linkPlaceholder": "Paste a Google Docs, Sheets, or Slides link",
    "requests.linkBadUrl": "Enter a valid Google Docs, Sheets, Slides, or Drive link.",
    "requests.linkPending": "Pending link",
    "requests.linkCurrent": "Current link",
```
In the `fr` block near its `requests.upload*` keys (around line 1181), add:
```ts
    "requests.docSourceFile": "Téléverser un fichier",
    "requests.docSourceLink": "Lier un Google Doc",
    "requests.linkPlaceholder": "Collez un lien Google Docs, Sheets ou Slides",
    "requests.linkBadUrl": "Saisissez un lien Google Docs, Sheets, Slides ou Drive valide.",
    "requests.linkPending": "Lien en attente",
    "requests.linkCurrent": "Lien actuel",
```

- [ ] **Step 2: Write the failing component tests**

In `src/test/components/document-section.test.tsx`, append inside the `describe("DocumentSection", ...)` block:

```ts
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm test src/test/components/document-section.test.tsx`
Expected: FAIL — no "link a google doc" button.

- [ ] **Step 4: Rewrite `DocumentSection`**

Replace the full contents of `src/components/document-section.tsx`:

```tsx
"use client"

import { useRef, useState } from "react"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { MAX_FILE_BYTES, ACCEPT_EXTENSIONS } from "@/lib/upload-constraints"
import { isGoogleWorkspaceUrl } from "@/lib/google-links"
import type { AttachmentKind } from "@prisma/client"

interface Props {
  kind: AttachmentKind
  label: string
  /** Whether this document is mandatory for submission (drives the required asterisk). */
  required?: boolean
  hasSummary?: boolean
  summaryValue?: string
  summaryPlaceholder?: string
  onSummaryChange?: (value: string) => void
  /** Filename of a document already uploaded for this slot (edit mode). */
  existingFilename?: string
  /** URL of a Google Doc already linked for this slot (edit mode). */
  existingLink?: string
  /** A file chosen this session but not yet uploaded. */
  stagedFile?: File | null
  /** A link entered this session but not yet saved. */
  stagedLink?: string | null
  onFileChange: (file: File | null) => void
  onLinkChange?: (url: string | null) => void
}

function isAcceptedExtension(filename: string): boolean {
  const lower = filename.toLowerCase()
  return ACCEPT_EXTENSIONS.split(",").some((ext) => lower.endsWith(ext))
}

export default function DocumentSection({
  label,
  required = true,
  hasSummary = true,
  summaryValue = "",
  summaryPlaceholder,
  onSummaryChange,
  existingFilename,
  existingLink,
  stagedFile,
  stagedLink,
  onFileChange,
  onLinkChange,
}: Props) {
  const { language } = useStore()
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [linkMode, setLinkMode] = useState<boolean>(Boolean(stagedLink || existingLink))
  const [linkValue, setLinkValue] = useState<string>(stagedLink ?? existingLink ?? "")
  const [linkError, setLinkError] = useState<string | null>(null)

  function handleSelect(file: File | null) {
    if (!file) {
      setError(null)
      onFileChange(null)
      return
    }
    if (!isAcceptedExtension(file.name)) {
      setError(t(language, "requests.uploadBadType"))
      return
    }
    if (file.size > MAX_FILE_BYTES) {
      setError(t(language, "requests.uploadTooLarge"))
      return
    }
    setError(null)
    onFileChange(file)
  }

  function handleLink(value: string) {
    setLinkValue(value)
    if (!value.trim()) {
      setLinkError(null)
      onLinkChange?.(null)
      return
    }
    if (!isGoogleWorkspaceUrl(value)) {
      setLinkError(t(language, "requests.linkBadUrl"))
      onLinkChange?.(null)
      return
    }
    setLinkError(null)
    onLinkChange?.(value)
  }

  function switchToFile() {
    setLinkMode(false)
    setLinkError(null)
    onLinkChange?.(null)
  }

  function switchToLink() {
    setLinkMode(true)
    setError(null)
    onFileChange(null)
  }

  const currentName = stagedFile?.name ?? existingFilename
  const isStaged = Boolean(stagedFile)

  return (
    <div className="rounded-lg border border-border/80 bg-card/95 p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        {label}{" "}
        {required ? (
          <span className="text-rose-600">*</span>
        ) : (
          <span className="text-xs font-normal text-muted-foreground">{t(language, "requests.optional")}</span>
        )}
      </div>

      {hasSummary && (
        <Textarea
          placeholder={summaryPlaceholder ?? t(language, "requests.summaryOptional")}
          value={summaryValue}
          onChange={(e) => onSummaryChange?.(e.target.value)}
        />
      )}

      <div className="flex gap-1 text-xs">
        <Button type="button" variant={linkMode ? "outline" : "secondary"} size="sm" onClick={switchToFile}>
          {t(language, "requests.docSourceFile")}
        </Button>
        <Button type="button" variant={linkMode ? "secondary" : "outline"} size="sm" onClick={switchToLink}>
          {t(language, "requests.docSourceLink")}
        </Button>
      </div>

      {linkMode ? (
        <div className="space-y-1">
          <Input
            type="url"
            placeholder={t(language, "requests.linkPlaceholder")}
            value={linkValue}
            onChange={(e) => handleLink(e.target.value)}
          />
          {linkError && <p className="text-xs text-rose-600">{linkError}</p>}
        </div>
      ) : (
        <>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT_EXTENSIONS}
            className="hidden"
            onChange={(e) => handleSelect(e.target.files?.[0] ?? null)}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" onClick={() => inputRef.current?.click()}>
              {currentName ? t(language, "requests.uploadReplace") : t(language, "requests.chooseFile")}
            </Button>
            {currentName ? (
              <span className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{currentName}</span>
                {isStaged
                  ? ` — ${t(language, "requests.uploadPending")}`
                  : ` — ${t(language, "requests.uploadCurrent")}`}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">{t(language, "requests.uploadHint")}</span>
            )}
          </div>
          {error && <p className="text-xs text-rose-600">{error}</p>}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test src/test/components/document-section.test.tsx`
Expected: PASS (existing 6 + 3 new).

- [ ] **Step 6: Commit**

```bash
git add src/components/document-section.tsx src/test/components/document-section.test.tsx src/lib/i18n.ts
git commit -m "feat(requests): file/link source toggle on DocumentSection"
```

---

### Task 6: Request form — stage links, post them, count them toward submission

**Files:**
- Modify: `src/app/(dashboard)/requests/request-form.tsx`

**Interfaces:**
- Consumes: `DocumentSection` link props (Task 5); JSON link endpoint (Task 4).
- Produces: `AttachmentSlot` type gains `externalUrl?: string | null` — consumed by Task 8 (edit page passes it in).

- [ ] **Step 1: Extend the `AttachmentSlot` type and link state**

In `src/app/(dashboard)/requests/request-form.tsx`, change the `AttachmentSlot` type (line 51):
```ts
type AttachmentSlot = { id: string; kind: string; filename: string; externalUrl?: string | null }
```

After the `uploadedByKind` state block (line 96-98), add staged-link + linked-by-kind state:
```ts
  // Links entered this session but not yet saved (saved on submit).
  const [stagedLinks, setStagedLinks] = useState<Partial<Record<AttachmentKind, string>>>({})
  // Links already saved for each slot (seeded from props, updated after each save).
  const [linkedByKind, setLinkedByKind] = useState<Partial<Record<AttachmentKind, string>>>(
    () => Object.fromEntries(
      attachments.filter((a) => a.externalUrl).map((a) => [a.kind, a.externalUrl as string])
    )
  )
```

- [ ] **Step 2: Update the submit-time missing-docs check**

Replace the `missingDocs` computation (lines 132-134) so a link satisfies a slot:
```ts
      const missingDocs = documentsRequiredForRisk(riskLevel)
        ? REQUIRED_DOC_KINDS.filter(
            (k) => !stagedFiles[k] && !uploadedByKind[k] && !stagedLinks[k] && !linkedByKind[k]
          )
        : []
```

- [ ] **Step 3: POST staged links after staged files**

Immediately after the staged-files upload loop (after the loop that ends at line 188, before `if (submit) await submitChange(id)`), add:
```ts
      // Save any staged links; clear each from staging as it succeeds (idempotent on retry).
      for (const [kind, url] of Object.entries(stagedLinks) as [AttachmentKind, string][]) {
        const res = await fetch(`/api/changes/${id}/documents`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind, url }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error ?? "Link failed")
        }
        const att = await res.json()
        setLinkedByKind((prev) => ({ ...prev, [kind]: att.externalUrl }))
        setStagedLinks((prev) => {
          const next = { ...prev }
          delete next[kind]
          return next
        })
      }
```

- [ ] **Step 4: Pass link props into `DocumentSection`**

In the `REQUIRED_DOC_KINDS.map` render (around line 397), add the three link props to the `<DocumentSection>` element (alongside the existing `existingFilename` / `stagedFile` / `onFileChange`):
```tsx
                existingFilename={uploadedByKind[kind]}
                existingLink={linkedByKind[kind]}
                stagedFile={stagedFiles[kind] ?? null}
                stagedLink={stagedLinks[kind] ?? null}
                onFileChange={(file) =>
                  setStagedFiles((prev) => {
                    const next = { ...prev }
                    if (file) next[kind] = file
                    else delete next[kind]
                    return next
                  })
                }
                onLinkChange={(url) =>
                  setStagedLinks((prev) => {
                    const next = { ...prev }
                    if (url) next[kind] = url
                    else delete next[kind]
                    return next
                  })
                }
```

- [ ] **Step 5: Type-check and run the full suite**

Run: `pnpm tsc --noEmit && pnpm test`
Expected: PASS (all green).

- [ ] **Step 6: Commit**

```bash
git add src/app/\(dashboard\)/requests/request-form.tsx
git commit -m "feat(requests): stage and save Google Doc links alongside file uploads"
```

---

### Task 7: Detail page — render link attachments as external anchors

**Files:**
- Modify: `src/app/(dashboard)/changes/[id]/change-detail-client.tsx`
- Modify: `src/app/(dashboard)/changes/[id]/page.tsx`
- Modify: `src/app/(dashboard)/changes/[id]/edit/page.tsx`
- Modify: `src/lib/i18n.ts` (detail affordance string)

**Interfaces:**
- Consumes: `Attachment.externalUrl` (Task 1); `AttachmentSlot.externalUrl` (Task 6).

- [ ] **Step 1: Add the detail affordance i18n strings (EN + FR)**

In `src/lib/i18n.ts`, next to `"detail.documents.download"` in the `en` block (line 680):
```ts
    "detail.documents.openInGoogle": "Open in Google",
```
and in the `fr` block (line 1412):
```ts
    "detail.documents.openInGoogle": "Ouvrir dans Google",
```

- [ ] **Step 2: Pass `externalUrl` through the server pages**

In `src/app/(dashboard)/changes/[id]/page.tsx`, extend the attachments map (line 28):
```ts
    attachments: change.attachments.map((a) => ({ id: a.id, kind: a.kind, filename: a.filename, externalUrl: a.externalUrl })),
```
In `src/app/(dashboard)/changes/[id]/edit/page.tsx`, extend the attachments map (line 57):
```ts
      attachments={change.attachments.map((a) => ({ id: a.id, kind: a.kind, filename: a.filename, externalUrl: a.externalUrl }))}
```

- [ ] **Step 3: Widen the detail-client attachment type and add a label map**

In `src/app/(dashboard)/changes/[id]/change-detail-client.tsx`, change the attachments field on the props type (line 36):
```ts
  attachments: { id: string; kind: string; filename: string; externalUrl?: string | null }[]
```
Add a kind→label map near the top of the component module (after the imports, alongside other module constants):
```ts
const DOC_LABEL_KEY: Record<string, string> = {
  impact_scope: "requests.impactScope",
  implementation_plan: "requests.implementationPlan",
  testing_plan: "requests.testingPlan",
  backout_plan: "requests.backoutPlan",
  solution_document: "requests.solutionDocument",
}
```

- [ ] **Step 4: Branch the attachment render**

Replace the attachment `<li>` render (lines 350-359) with:
```tsx
                    {change.attachments.map((a) => (
                      <li key={a.id}>
                        {a.externalUrl ? (
                          <a
                            className="text-sm text-primary underline"
                            href={a.externalUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {DOC_LABEL_KEY[a.kind] ? t(language, DOC_LABEL_KEY[a.kind]) : a.filename}
                            {" — "}
                            {t(language, "detail.documents.openInGoogle")} ↗
                          </a>
                        ) : (
                          <a
                            className="text-sm text-primary underline"
                            href={`/api/changes/${change.id}/documents/${a.id}`}
                          >
                            {a.filename} — {t(language, "detail.documents.download")}
                          </a>
                        )}
                      </li>
                    ))}
```

- [ ] **Step 5: Type-check and run the full suite**

Run: `pnpm tsc --noEmit && pnpm test`
Expected: PASS (all green).

- [ ] **Step 6: Commit**

```bash
git add src/app/\(dashboard\)/changes/\[id\]/change-detail-client.tsx src/app/\(dashboard\)/changes/\[id\]/page.tsx src/app/\(dashboard\)/changes/\[id\]/edit/page.tsx src/lib/i18n.ts
git commit -m "feat(detail): render linked Google Docs as external links"
```

---

### Task 8: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Build**

Run: `pnpm build`
Expected: `prisma generate` + `next build` succeed with no type errors.

- [ ] **Step 2: Manual smoke test (local stack on :5433, Playwright MCP or browser)**

1. Log in (`devops@csquared.com` / `Admin2025$`), create a high-risk change.
2. On a document slot, click **Link a Google Doc**, paste `https://example.com/x` → inline error, cannot submit.
3. Paste `https://docs.google.com/document/d/abc/edit` → error clears.
4. Satisfy the remaining slots (files or links), **Submit** → succeeds (no "missing document" toast).
5. Open the change detail → the linked slot shows the **kind label + "Open in Google ↗"** opening the Google URL in a new tab; file slots still show **filename — Download**.
6. Hit `/api/changes/<id>/documents/<linkAttachmentId>` directly → returns the "external link" error (not a download).
7. Check the admin audit / change audit trail → a **`document_linked`** row exists.

- [ ] **Step 3: Final full suite**

Run: `pnpm test`
Expected: PASS (all green, including the new google-links, documents, and document-section tests).

---

## Self-Review Notes

- **Spec coverage:** data model → Task 1; validation → Task 2; `attachLink` + download guard → Task 3; API JSON branch → Task 4; toggle UX → Task 5; staged links + satisfaction + POST → Task 6; detail external anchor + kind label → Task 7; governance (audit `document_linked`) → Task 3 audit row; i18n EN/FR → Tasks 5 & 7. All spec sections mapped.
- **Type consistency:** `attachLink({ changeId, kind, url })` defined in Task 3, consumed identically in Task 4; `onLinkChange: (url: string | null) => void` and `existingLink`/`stagedLink` defined in Task 5, consumed identically in Task 6; `externalUrl?: string | null` on the attachment shape consistent across Tasks 6, 7.
- **Governance trade-off** (link bypasses app-mediated RBAC; mitigated by Google-host restriction + `document_linked` audit) is carried from the spec and realized in Tasks 2 & 3.
