# Change Request Drive-backed Documents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the four change-request planning sections plus a new solution document into required file uploads stored in a private Google Drive Shared Drive, accessed only through RBAC-gated, audit-logged app endpoints; tighten submit-time validation; and turn the infrastructure-type radio list into a dropdown.

**Architecture:** Files upload to an authenticated Next.js route handler that checks RBAC, validates the file, then streams it to a private Shared Drive via a Google service account (Option A — proxy through app). Downloads stream back through the app the same way; Drive links are never exposed. An `Attachment` row per `(changeId, kind)` records the Drive file ID. Submit is blocked server-side until every required field and all five documents are present.

**Tech Stack:** Next.js App Router, Prisma v7 (`@prisma/adapter-pg`), Postgres, `googleapis` + `google-auth-library`, Vitest + React Testing Library, NextAuth/Keycloak session, existing `@/lib/permissions` RBAC helpers.

**Spec:** `docs/superpowers/specs/2026-06-05-change-request-drive-documents-design.md`

**Branch:** `feat/change-request-drive-docs` (already created off `dev`).

**Local DB note:** Prisma migrations and the Testcontainers test need the local dev stack. Run schema/migration commands with the dev `DATABASE_URL` inline (see `memory/reference_local_dev_stack.md` — docker compose Postgres+Keycloak). Example: `DATABASE_URL="postgresql://postgres:postgres@localhost:5432/cms" pnpm prisma migrate dev --name ...`.

---

## File Structure

**Create:**
- `src/server/drive.ts` — Google Drive service: service-account client, folder naming helpers, `ensureChangeFolder`, `uploadDocument`, `getDownloadBuffer`, `renameChangeFolder`, `scanFile` hook.
- `src/server/documents.ts` — RBAC + validation orchestration: `attachDocument`, `getDocumentForDownload`, shared constants (`ALLOWED_MIME_TYPES`, `MAX_FILE_BYTES`, `REQUIRED_DOC_KINDS`).
- `src/app/api/changes/[id]/documents/route.ts` — `POST` upload handler.
- `src/app/api/changes/[id]/documents/[attachmentId]/route.ts` — `GET` download handler.
- `src/components/document-upload.tsx` — client upload widget (one per document slot).
- `src/test/server/drive.test.ts` — pure naming-helper tests.
- `src/test/server/documents.test.ts` — RBAC + validation tests (drive + db mocked).
- `src/test/components/document-upload.test.tsx` — widget render smoke test.

**Modify:**
- `prisma/schema.prisma` — `AttachmentKind` enum; `ChangeRequest.reference`, `ChangeRequest.driveFolderId`; `Attachment.kind/uploadedById/uploadedBy` + `@@unique([changeId, kind])`; `User` reverse relation.
- `src/server/actions/changes.ts` — submit-time completeness guard; add `attachments` to `getChange` include.
- `src/app/(dashboard)/requests/request-form.tsx` — infra dropdown, optional summaries, upload widgets, create→edit button flow, submit validation.
- `src/app/(dashboard)/requests/page.tsx` — create-mode unchanged inputs (no attachments needed).
- `src/app/(dashboard)/changes/[id]/edit/page.tsx` — pass `attachments` to the form.
- `src/app/(dashboard)/changes/[id]/page.tsx` + `change-detail-client.tsx` — Documents section with download links.
- `src/lib/i18n.ts` — new keys (en + fr).
- `.env.example` (create if absent) / `README` — new env vars + provisioning steps.

---

## Task 1: Prisma schema — data model

**Files:**
- Modify: `prisma/schema.prisma` (enums block ~line 18-45; `ChangeRequest` ~123-159; `Attachment` ~216-225; `User` ~47-64)

- [ ] **Step 1: Add the `AttachmentKind` enum**

After the existing `enum ChangeCategory { ... }` block, add:

```prisma
enum AttachmentKind {
  impact_scope
  implementation_plan
  testing_plan
  backout_plan
  solution_document
}
```

- [ ] **Step 2: Add fields to `ChangeRequest`**

Inside `model ChangeRequest`, add after the `id` line:

```prisma
  reference          Int            @unique @default(autoincrement())
```

and after `slaDeadline DateTime?` add:

```prisma
  driveFolderId      String?
```

- [ ] **Step 3: Extend `Attachment`**

Replace the `model Attachment { ... }` block with:

```prisma
model Attachment {
  id           String         @id @default(cuid())
  changeId     String
  change       ChangeRequest  @relation(fields: [changeId], references: [id])
  kind         AttachmentKind
  filename     String
  storageKey   String         // Google Drive file ID
  mimeType     String?
  sizeBytes    Int?
  uploadedById String
  uploadedBy   User           @relation("UploadedAttachments", fields: [uploadedById], references: [id])
  uploadedAt   DateTime       @default(now())

  @@unique([changeId, kind])
  @@index([changeId])
}
```

- [ ] **Step 4: Add the reverse relation on `User`**

Inside `model User`, add a relation field alongside the other relations (e.g. near `@relation("Requester")` usages):

```prisma
  uploadedAttachments Attachment[] @relation("UploadedAttachments")
```

- [ ] **Step 5: Generate client and create the migration**

Run (with the dev DB URL inline — see header note):

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/cms" pnpm prisma migrate dev --name change_request_documents
```

Expected: a new migration under `prisma/migrations/`, Prisma Client regenerated, no errors.

- [ ] **Step 6: Type-check**

Run: `pnpm tsc --noEmit`
Expected: PASS (no schema-related type errors).

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): add AttachmentKind, change reference + driveFolderId, attachment uploader"
```

---

## Task 2: Drive naming helpers (pure, TDD)

**Files:**
- Create: `src/server/drive.ts`
- Test: `src/test/server/drive.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/test/server/drive.test.ts
import { describe, it, expect } from "vitest"
import { changeFolderName, sanitizeSegment, SUBFOLDER_FOR_KIND } from "@/server/drive"

describe("sanitizeSegment", () => {
  it("strips characters Drive dislikes and trims", () => {
    expect(sanitizeSegment("Core/router: upgrade?")).toBe("Core-router- upgrade")
  })
  it("collapses to a non-empty fallback", () => {
    expect(sanitizeSegment("   ")).toBe("untitled")
  })
})

describe("changeFolderName", () => {
  it("formats reference zero-padded with the title", () => {
    expect(changeFolderName(42, "Core router upgrade")).toBe("CHG-0042 — Core router upgrade")
  })
})

describe("SUBFOLDER_FOR_KIND", () => {
  it("maps every kind to an ordered subfolder name", () => {
    expect(SUBFOLDER_FOR_KIND.impact_scope).toBe("01_Impact-and-Scope")
    expect(SUBFOLDER_FOR_KIND.implementation_plan).toBe("02_Implementation-Plan")
    expect(SUBFOLDER_FOR_KIND.testing_plan).toBe("03_Testing-and-Validation")
    expect(SUBFOLDER_FOR_KIND.backout_plan).toBe("04_Backout-Plan")
    expect(SUBFOLDER_FOR_KIND.solution_document).toBe("05_Solution-Document")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/test/server/drive.test.ts`
Expected: FAIL — cannot resolve `@/server/drive`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/server/drive.ts
import type { AttachmentKind } from "@prisma/client"

export const SUBFOLDER_FOR_KIND: Record<AttachmentKind, string> = {
  impact_scope: "01_Impact-and-Scope",
  implementation_plan: "02_Implementation-Plan",
  testing_plan: "03_Testing-and-Validation",
  backout_plan: "04_Backout-Plan",
  solution_document: "05_Solution-Document",
}

export function sanitizeSegment(input: string): string {
  const cleaned = input.replace(/[\\/:*?"<>|]/g, "-").trim()
  return cleaned.length > 0 ? cleaned : "untitled"
}

export function changeFolderName(reference: number, title: string): string {
  const padded = String(reference).padStart(4, "0")
  return `CHG-${padded} — ${sanitizeSegment(title)}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/test/server/drive.test.ts`
Expected: PASS (5 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/server/drive.ts src/test/server/drive.test.ts
git commit -m "feat(drive): add folder naming helpers"
```

---

## Task 3: Drive client functions

**Files:**
- Modify: `src/server/drive.ts`
- Modify: `package.json` (add deps)

> The Google API wrappers are thin and verified through Task 4's mocked tests plus a manual smoke test; they are not unit-tested directly (mocking `googleapis` transport adds brittleness with little value). Keep them small.

- [ ] **Step 1: Install dependencies**

```bash
pnpm add googleapis google-auth-library
```

Expected: both appear in `package.json` dependencies; `pnpm-lock.yaml` updated.

- [ ] **Step 2: Add the client + API functions to `src/server/drive.ts`**

Append below the helpers from Task 2:

```typescript
import { google } from "googleapis"
import { Readable } from "node:stream"

function getDrive() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is not set")
  const credentials = JSON.parse(raw)
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive"],
  })
  return google.drive({ version: "v3", auth })
}

function driveId(): string {
  const id = process.env.GDRIVE_SHARED_DRIVE_ID
  if (!id) throw new Error("GDRIVE_SHARED_DRIVE_ID is not set")
  return id
}

function rootFolderId(): string {
  const id = process.env.GDRIVE_ROOT_FOLDER_ID
  if (!id) throw new Error("GDRIVE_ROOT_FOLDER_ID is not set")
  return id
}

const FOLDER_MIME = "application/vnd.google-apps.folder"

// Find a folder by name under a parent, or create it. Idempotent.
async function ensureFolder(name: string, parentId: string): Promise<string> {
  const drive = getDrive()
  const safeName = name.replace(/'/g, "\\'")
  const list = await drive.files.list({
    q: `name='${safeName}' and '${parentId}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`,
    corpora: "drive",
    driveId: driveId(),
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    fields: "files(id,name)",
  })
  const existing = list.data.files?.[0]
  if (existing?.id) return existing.id
  const created = await drive.files.create({
    requestBody: { name, mimeType: FOLDER_MIME, parents: [parentId] },
    supportsAllDrives: true,
    fields: "id",
  })
  if (!created.data.id) throw new Error(`Failed to create folder: ${name}`)
  return created.data.id
}

// Build OpCo / Year / CHG-#### — Title and return the change folder id.
export async function ensureChangeFolder(input: {
  opcoName: string
  year: number
  reference: number
  title: string
}): Promise<string> {
  const opco = await ensureFolder(sanitizeSegment(input.opcoName), rootFolderId())
  const year = await ensureFolder(String(input.year), opco)
  return ensureFolder(changeFolderName(input.reference, input.title), year)
}

export async function uploadDocument(input: {
  changeFolderId: string
  kind: AttachmentKind
  filename: string
  mimeType: string
  buffer: Buffer
}): Promise<string> {
  const subfolderId = await ensureFolder(SUBFOLDER_FOR_KIND[input.kind], input.changeFolderId)
  const drive = getDrive()
  const created = await drive.files.create({
    requestBody: { name: input.filename, parents: [subfolderId] },
    media: { mimeType: input.mimeType, body: Readable.from(input.buffer) },
    supportsAllDrives: true,
    fields: "id",
  })
  if (!created.data.id) throw new Error("Drive upload returned no file id")
  return created.data.id
}

export async function getDownloadBuffer(fileId: string): Promise<Buffer> {
  const drive = getDrive()
  const res = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" }
  )
  return Buffer.from(res.data as ArrayBuffer)
}

export async function renameChangeFolder(folderId: string, finalName: string): Promise<void> {
  const drive = getDrive()
  await drive.files.update({
    fileId: folderId,
    requestBody: { name: finalName },
    supportsAllDrives: true,
  })
}

// ISO 27001 A.8.7 malware-scan seam. No-op in v1; throw to reject a file later.
export async function scanFile(_buffer: Buffer, _filename: string): Promise<void> {
  return
}
```

- [ ] **Step 3: Type-check**

Run: `pnpm tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Confirm existing tests still pass**

Run: `pnpm test src/test/server/drive.test.ts`
Expected: PASS (helpers unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/server/drive.ts package.json pnpm-lock.yaml
git commit -m "feat(drive): add service-account Drive client (folders, upload, download, scan hook)"
```

---

## Task 4: Documents server module (RBAC + validation, TDD)

**Files:**
- Create: `src/server/documents.ts`
- Test: `src/test/server/documents.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/test/server/documents.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/session", () => ({
  getAppSession: vi.fn().mockResolvedValue({
    keycloakId: "kc-1", email: "test@csquared.com", name: "Test",
    organizations: [{ id: "org-1", name: "Ghana", alias: "ghana", roles: ["requester"] }],
    realmRoles: [],
  }),
}))

const mockDb = {
  user: { findUnique: vi.fn().mockResolvedValue({ id: "user-1", keycloakId: "kc-1" }) },
  changeRequest: {
    findUnique: vi.fn().mockResolvedValue({
      id: "cr-1", status: "draft", opcoId: "opco-1", requesterId: "user-1",
      reference: 42, title: "Router update", driveFolderId: null, createdAt: new Date("2026-06-05"),
      opco: { slug: "ghana", name: "Ghana" },
    }),
    update: vi.fn().mockResolvedValue({}),
  },
  attachment: {
    upsert: vi.fn().mockResolvedValue({ id: "att-1", kind: "impact_scope", filename: "impact.pdf" }),
    findUnique: vi.fn().mockResolvedValue({
      id: "att-1", changeId: "cr-1", kind: "impact_scope",
      filename: "impact.pdf", mimeType: "application/pdf", storageKey: "drive-file-1",
    }),
  },
  auditLog: { create: vi.fn().mockResolvedValue({}) },
}
vi.mock("@/server/db", () => ({ getPrisma: () => mockDb }))

vi.mock("@/server/drive", () => ({
  ensureChangeFolder: vi.fn().mockResolvedValue("folder-1"),
  uploadDocument: vi.fn().mockResolvedValue("drive-file-1"),
  getDownloadBuffer: vi.fn().mockResolvedValue(Buffer.from("PDF")),
  scanFile: vi.fn().mockResolvedValue(undefined),
}))

import { attachDocument, getDocumentForDownload } from "@/server/documents"
import { getAppSession } from "@/lib/session"

const pdf = { filename: "impact.pdf", mimeType: "application/pdf", buffer: Buffer.from("PDF") }
const ugandaSession = {
  keycloakId: "kc-ug", email: "ug@csquared.com", name: "UG",
  organizations: [{ id: "org-ug", name: "Uganda", alias: "uganda", roles: ["requester"] }],
  realmRoles: [] as string[],
}

beforeEach(() => vi.clearAllMocks())

describe("attachDocument", () => {
  it("uploads, upserts the attachment, and writes an audit row", async () => {
    const result = await attachDocument({ changeId: "cr-1", kind: "impact_scope", ...pdf })
    expect(result).toHaveProperty("id", "att-1")
    expect(mockDb.attachment.upsert).toHaveBeenCalled()
    expect(mockDb.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "document_uploaded" }) })
    )
  })

  it("rejects a disallowed mime type", async () => {
    await expect(
      attachDocument({ changeId: "cr-1", kind: "impact_scope", filename: "x.exe", mimeType: "application/x-msdownload", buffer: Buffer.from("x") })
    ).rejects.toThrow(/file type/i)
  })

  it("rejects a file over the size limit", async () => {
    const big = Buffer.alloc(26 * 1024 * 1024)
    await expect(
      attachDocument({ changeId: "cr-1", kind: "impact_scope", filename: "big.pdf", mimeType: "application/pdf", buffer: big })
    ).rejects.toThrow(/size/i)
  })

  it("forbids a non-requester non-admin from uploading", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ugandaSession)
    mockDb.user.findUnique.mockResolvedValueOnce({ id: "user-ug", keycloakId: "kc-ug" })
    await expect(
      attachDocument({ changeId: "cr-1", kind: "impact_scope", ...pdf })
    ).rejects.toThrow(/Forbidden/)
  })

  it("forbids uploading to a non-draft change", async () => {
    mockDb.changeRequest.findUnique.mockResolvedValueOnce({
      id: "cr-1", status: "pending", opcoId: "opco-1", requesterId: "user-1",
      reference: 42, title: "Router update", driveFolderId: "folder-1", createdAt: new Date(),
      opco: { slug: "ghana", name: "Ghana" },
    })
    await expect(
      attachDocument({ changeId: "cr-1", kind: "impact_scope", ...pdf })
    ).rejects.toThrow(/draft/i)
  })
})

describe("getDocumentForDownload", () => {
  it("returns the file buffer + metadata for an OpCo member and audit-logs", async () => {
    const result = await getDocumentForDownload({ changeId: "cr-1", attachmentId: "att-1" })
    expect(result.filename).toBe("impact.pdf")
    expect(result.buffer.toString()).toBe("PDF")
    expect(mockDb.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "document_downloaded" }) })
    )
  })

  it("forbids a non-member of the OpCo", async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce(ugandaSession)
    await expect(
      getDocumentForDownload({ changeId: "cr-1", attachmentId: "att-1" })
    ).rejects.toThrow(/Forbidden|not found/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/test/server/documents.test.ts`
Expected: FAIL — cannot resolve `@/server/documents`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/server/documents.ts
"use server"

import { getPrisma } from "@/server/db"
import { getAppSession } from "@/lib/session"
import {
  isGroupAdmin, isGroupLevel, isMemberOfOpCo, hasRoleInOpCo,
} from "@/lib/permissions"
import {
  ensureChangeFolder, uploadDocument, getDownloadBuffer, renameChangeFolder,
  scanFile, changeFolderName,
} from "@/server/drive"
import type { AttachmentKind } from "@prisma/client"

export const MAX_FILE_BYTES = 25 * 1024 * 1024 // 25 MB

export const ALLOWED_MIME_TYPES = new Set<string>([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "image/png",
  "image/jpeg",
])

export const REQUIRED_DOC_KINDS: AttachmentKind[] = [
  "impact_scope", "implementation_plan", "testing_plan", "backout_plan", "solution_document",
]

type AttachInput = {
  changeId: string
  kind: AttachmentKind
  filename: string
  mimeType: string
  buffer: Buffer
}

export async function attachDocument(input: AttachInput) {
  if (!ALLOWED_MIME_TYPES.has(input.mimeType)) {
    throw new Error(`Unsupported file type: ${input.mimeType}`)
  }
  if (input.buffer.length > MAX_FILE_BYTES) {
    throw new Error("File exceeds the 25 MB size limit")
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
    throw new Error("Forbidden: only the requester or an admin can upload documents")
  }
  if (change.status !== "draft") throw new Error("Documents can only be uploaded to a draft change")

  await scanFile(input.buffer, input.filename)

  const folderId = change.driveFolderId ?? await ensureChangeFolder({
    opcoName: change.opco.name,
    year: change.createdAt.getFullYear(),
    reference: change.reference,
    title: change.title,
  })
  if (!change.driveFolderId) {
    await db.changeRequest.update({ where: { id: change.id }, data: { driveFolderId: folderId } })
  }

  const driveFileId = await uploadDocument({
    changeFolderId: folderId, kind: input.kind,
    filename: input.filename, mimeType: input.mimeType, buffer: input.buffer,
  })

  const attachment = await db.attachment.upsert({
    where: { changeId_kind: { changeId: change.id, kind: input.kind } },
    create: {
      changeId: change.id, kind: input.kind, filename: input.filename,
      storageKey: driveFileId, mimeType: input.mimeType, sizeBytes: input.buffer.length,
      uploadedById: user.id,
    },
    update: {
      filename: input.filename, storageKey: driveFileId,
      mimeType: input.mimeType, sizeBytes: input.buffer.length, uploadedById: user.id,
    },
  })

  await db.auditLog.create({
    data: {
      changeId: change.id, actorId: user.id, action: "document_uploaded",
      metadata: { attachmentId: attachment.id, kind: input.kind, filename: input.filename },
    },
  })

  return attachment
}

export async function getDocumentForDownload(input: { changeId: string; attachmentId: string }) {
  const session = await getAppSession()
  const db = getPrisma()
  const user = await db.user.findUnique({ where: { keycloakId: session.keycloakId } })
  if (!user) throw new Error("User not found")

  const change = await db.changeRequest.findUnique({
    where: { id: input.changeId }, include: { opco: true },
  })
  if (!change) throw new Error("Change not found")

  if (!isGroupLevel(session.realmRoles) && !isMemberOfOpCo(session.organizations, change.opco.slug)) {
    throw new Error("Forbidden: not a member of this OpCo")
  }

  const attachment = await db.attachment.findUnique({ where: { id: input.attachmentId } })
  if (!attachment || attachment.changeId !== change.id) throw new Error("Attachment not found")

  const buffer = await getDownloadBuffer(attachment.storageKey)

  await db.auditLog.create({
    data: {
      changeId: change.id, actorId: user.id, action: "document_downloaded",
      metadata: { attachmentId: attachment.id, kind: attachment.kind, filename: attachment.filename },
    },
  })

  return { buffer, filename: attachment.filename, mimeType: attachment.mimeType ?? "application/octet-stream" }
}

// Finalize the Drive folder name to the change's current title (called at submit).
export async function finalizeChangeFolderName(changeId: string) {
  const db = getPrisma()
  const change = await db.changeRequest.findUnique({ where: { id: changeId } })
  if (!change?.driveFolderId) return
  await renameChangeFolder(change.driveFolderId, changeFolderName(change.reference, change.title))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/test/server/documents.test.ts`
Expected: PASS (8 assertions across the suites).

- [ ] **Step 5: Type-check**

Run: `pnpm tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/documents.ts src/test/server/documents.test.ts
git commit -m "feat(documents): add RBAC-gated attach/download with audit logging"
```

---

## Task 5: Upload route handler (TDD)

**Files:**
- Create: `src/app/api/changes/[id]/documents/route.ts`
- Test: `src/test/server/upload-route.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/test/server/upload-route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/server/documents", () => ({
  attachDocument: vi.fn().mockResolvedValue({ id: "att-1", kind: "impact_scope", filename: "impact.pdf" }),
}))

import { POST } from "@/app/api/changes/[id]/documents/route"
import { attachDocument } from "@/server/documents"

function makeRequest(form: FormData) {
  return new Request("http://localhost/api/changes/cr-1/documents", { method: "POST", body: form })
}

beforeEach(() => vi.clearAllMocks())

describe("POST /api/changes/[id]/documents", () => {
  it("attaches the uploaded file and returns the attachment", async () => {
    const form = new FormData()
    form.set("kind", "impact_scope")
    form.set("file", new File([new Uint8Array([1, 2, 3])], "impact.pdf", { type: "application/pdf" }))
    const res = await POST(makeRequest(form), { params: Promise.resolve({ id: "cr-1" }) })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ id: "att-1" })
    expect(attachDocument).toHaveBeenCalledWith(
      expect.objectContaining({ changeId: "cr-1", kind: "impact_scope", filename: "impact.pdf" })
    )
  })

  it("returns 400 when the file is missing", async () => {
    const form = new FormData()
    form.set("kind", "impact_scope")
    const res = await POST(makeRequest(form), { params: Promise.resolve({ id: "cr-1" }) })
    expect(res.status).toBe(400)
  })

  it("returns 403 when attachDocument throws Forbidden", async () => {
    vi.mocked(attachDocument).mockRejectedValueOnce(new Error("Forbidden: nope"))
    const form = new FormData()
    form.set("kind", "impact_scope")
    form.set("file", new File([new Uint8Array([1])], "x.pdf", { type: "application/pdf" }))
    const res = await POST(makeRequest(form), { params: Promise.resolve({ id: "cr-1" }) })
    expect(res.status).toBe(403)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/test/server/upload-route.test.ts`
Expected: FAIL — cannot resolve the route module.

- [ ] **Step 3: Write the implementation**

```typescript
// src/app/api/changes/[id]/documents/route.ts
import { NextResponse } from "next/server"
import { attachDocument } from "@/server/documents"
import type { AttachmentKind } from "@prisma/client"

const VALID_KINDS: AttachmentKind[] = [
  "impact_scope", "implementation_plan", "testing_plan", "backout_plan", "solution_document",
]

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const form = await req.formData()
  const kind = form.get("kind")
  const file = form.get("file")

  if (typeof kind !== "string" || !VALID_KINDS.includes(kind as AttachmentKind)) {
    return NextResponse.json({ error: "Invalid or missing document kind" }, { status: 400 })
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 })
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer())
    const attachment = await attachDocument({
      changeId: id, kind: kind as AttachmentKind,
      filename: file.name, mimeType: file.type, buffer,
    })
    return NextResponse.json(attachment)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed"
    const status = message.startsWith("Forbidden") ? 403 : 400
    return NextResponse.json({ error: message }, { status })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/test/server/upload-route.test.ts`
Expected: PASS (3 assertions).

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/changes/[id]/documents/route.ts" src/test/server/upload-route.test.ts
git commit -m "feat(api): add document upload route handler"
```

---

## Task 6: Download route handler (TDD)

**Files:**
- Create: `src/app/api/changes/[id]/documents/[attachmentId]/route.ts`
- Test: `src/test/server/download-route.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/test/server/download-route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/server/documents", () => ({
  getDocumentForDownload: vi.fn().mockResolvedValue({
    buffer: Buffer.from("PDFDATA"), filename: "impact.pdf", mimeType: "application/pdf",
  }),
}))

import { GET } from "@/app/api/changes/[id]/documents/[attachmentId]/route"
import { getDocumentForDownload } from "@/server/documents"

const ctx = { params: Promise.resolve({ id: "cr-1", attachmentId: "att-1" }) }
beforeEach(() => vi.clearAllMocks())

describe("GET /api/changes/[id]/documents/[attachmentId]", () => {
  it("streams the file with content-disposition", async () => {
    const res = await GET(new Request("http://localhost"), ctx)
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("application/pdf")
    expect(res.headers.get("content-disposition")).toContain("impact.pdf")
    expect(await res.text()).toBe("PDFDATA")
  })

  it("returns 403 on Forbidden", async () => {
    vi.mocked(getDocumentForDownload).mockRejectedValueOnce(new Error("Forbidden: not a member"))
    const res = await GET(new Request("http://localhost"), ctx)
    expect(res.status).toBe(403)
  })

  it("returns 404 when not found", async () => {
    vi.mocked(getDocumentForDownload).mockRejectedValueOnce(new Error("Attachment not found"))
    const res = await GET(new Request("http://localhost"), ctx)
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/test/server/download-route.test.ts`
Expected: FAIL — cannot resolve the route module.

- [ ] **Step 3: Write the implementation**

```typescript
// src/app/api/changes/[id]/documents/[attachmentId]/route.ts
import { NextResponse } from "next/server"
import { getDocumentForDownload } from "@/server/documents"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  const { id, attachmentId } = await params
  try {
    const { buffer, filename, mimeType } = await getDocumentForDownload({ changeId: id, attachmentId })
    return new NextResponse(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "content-type": mimeType,
        "content-disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Download failed"
    if (message.startsWith("Forbidden")) return NextResponse.json({ error: message }, { status: 403 })
    if (message.includes("not found")) return NextResponse.json({ error: message }, { status: 404 })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/test/server/download-route.test.ts`
Expected: PASS (3 assertions).

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/changes/[id]/documents/[attachmentId]/route.ts" src/test/server/download-route.test.ts
git commit -m "feat(api): add RBAC-gated document download route handler"
```

---

## Task 7: Submit completeness guard + getChange include (TDD)

**Files:**
- Modify: `src/server/actions/changes.ts` (`getChange` ~30-47, `submitChange` ~131-177)
- Modify: `src/test/actions/changes.test.ts`

- [ ] **Step 1: Add `attachments` to the existing `mockDb.changeRequest.findUnique` defaults and the submit happy-path**

In `src/test/actions/changes.test.ts`, update the default `changeRequest.findUnique` mock (lines ~21-24) to include the fields the guard needs:

```typescript
    findUnique: vi.fn().mockResolvedValue({
      id: 'cr-1', status: 'draft', opcoId: 'opco-1', requesterId: 'user-1',
      opco: { slug: 'ghana' }, title: 'Router update', description: 'BGP config',
      riskLevel: 'low', category: 'config', contactEmail: 'test@csquared.com',
      infrastructureType: 'Backbone IP Network',
      plannedStart: new Date('2026-07-01'), plannedEnd: new Date('2026-07-02'),
      attachments: [
        { kind: 'impact_scope' }, { kind: 'implementation_plan' }, { kind: 'testing_plan' },
        { kind: 'backout_plan' }, { kind: 'solution_document' },
      ],
    }),
```

Add `attachment` to `mockDb` (sibling of `auditLog`):

```typescript
  attachment: { findMany: vi.fn().mockResolvedValue([]) },
```

- [ ] **Step 2: Write a failing test for the guard**

Add inside `describe('submitChange', ...)`:

```typescript
  it('rejects submit when a required document is missing', async () => {
    mockDb.changeRequest.findUnique.mockResolvedValueOnce({
      id: 'cr-1', status: 'draft', opcoId: 'opco-1', requesterId: 'user-1',
      opco: { slug: 'ghana' }, title: 'Router update', description: 'BGP config',
      riskLevel: 'low', category: 'config', contactEmail: 'test@csquared.com',
      infrastructureType: 'Backbone IP Network',
      plannedStart: new Date('2026-07-01'), plannedEnd: new Date('2026-07-02'),
      isEmergency: false,
      attachments: [{ kind: 'impact_scope' }], // only 1 of 5
    })
    await expect(submitChange('cr-1')).rejects.toThrow(/required document/i)
  })

  it('rejects submit when planned dates are missing', async () => {
    mockDb.changeRequest.findUnique.mockResolvedValueOnce({
      id: 'cr-1', status: 'draft', opcoId: 'opco-1', requesterId: 'user-1',
      opco: { slug: 'ghana' }, title: 'Router update', description: 'BGP config',
      riskLevel: 'low', category: 'config', contactEmail: 'test@csquared.com',
      infrastructureType: 'Backbone IP Network',
      plannedStart: null, plannedEnd: null, isEmergency: false,
      attachments: [
        { kind: 'impact_scope' }, { kind: 'implementation_plan' }, { kind: 'testing_plan' },
        { kind: 'backout_plan' }, { kind: 'solution_document' },
      ],
    })
    await expect(submitChange('cr-1')).rejects.toThrow(/required/i)
  })
```

- [ ] **Step 3: Run the new tests to verify they fail**

Run: `pnpm test src/test/actions/changes.test.ts -t "rejects submit"`
Expected: FAIL — submit currently performs no completeness check.

- [ ] **Step 4: Implement the guard in `submitChange`**

In `src/server/actions/changes.ts`, change the `submitChange` `findUnique` to include attachments:

```typescript
  const change = await db.changeRequest.findUnique({
    where: { id }, include: { opco: true, attachments: true },
  })
```

Then, immediately after the existing `if (change.status !== "draft") ...` line, add the completeness guard (place above the blackout check):

```typescript
  const REQUIRED_KINDS = [
    "impact_scope", "implementation_plan", "testing_plan", "backout_plan", "solution_document",
  ] as const
  const present = new Set(change.attachments.map((a) => a.kind))
  const missing = REQUIRED_KINDS.filter((k) => !present.has(k))
  if (missing.length > 0) {
    throw new Error(`Cannot submit: required document(s) missing: ${missing.join(", ")}`)
  }
  const requiredFields: [string, unknown][] = [
    ["title", change.title], ["description", change.description],
    ["contactEmail", change.contactEmail], ["infrastructureType", change.infrastructureType],
    ["plannedStart", change.plannedStart], ["plannedEnd", change.plannedEnd],
  ]
  const missingFields = requiredFields.filter(([, v]) => v === null || v === undefined || v === "").map(([k]) => k)
  if (missingFields.length > 0) {
    throw new Error(`Cannot submit: required field(s) missing: ${missingFields.join(", ")}`)
  }
```

- [ ] **Step 5: Add `attachments` to `getChange`'s include**

In `getChange`, add `attachments: true` to the `include` block so the detail/edit pages receive documents:

```typescript
    include: {
      opco: true,
      requester: true,
      approvals: { include: { approver: true }, orderBy: { decidedAt: "asc" } },
      auditTrail: { include: { actor: true }, orderBy: { at: "asc" } },
      attachments: { orderBy: { kind: "asc" } },
    },
```

- [ ] **Step 6: Run the full changes test file**

Run: `pnpm test src/test/actions/changes.test.ts`
Expected: PASS — existing submit happy-path tests pass (mock now supplies all docs + fields) and the two new rejection tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/server/actions/changes.ts src/test/actions/changes.test.ts
git commit -m "feat(changes): block submit until all fields and documents present; include attachments in getChange"
```

---

## Task 8: i18n keys

**Files:**
- Modify: `src/lib/i18n.ts` (en map ~267-306 and the matching fr map)

- [ ] **Step 1: Add keys to the English map**

Add alongside the existing `requests.*` keys:

```typescript
    "requests.summaryOptional": "Optional summary",
    "requests.uploadRequired": "Required document",
    "requests.uploadHint": "PDF, Word, Excel, PowerPoint, or image — up to 25 MB.",
    "requests.uploadDraftFirst": "Save as draft first to attach documents.",
    "requests.uploadReplace": "Replace",
    "requests.uploadCurrent": "Current file",
    "requests.solutionDocument": "Solution Document",
    "requests.saveAndContinue": "Save & Continue",
    "requests.toast.docMissing": "Missing required documents",
    "requests.toast.docMissingDesc": "All five planning documents must be uploaded before submitting.",
    "detail.field.documents": "Documents",
    "detail.documents.download": "Download",
    "detail.documents.none": "No documents uploaded.",
```

- [ ] **Step 2: Add the same keys to the French map**

Add the French translations to the `fr` object (match the existing French style):

```typescript
    "requests.summaryOptional": "Résumé facultatif",
    "requests.uploadRequired": "Document requis",
    "requests.uploadHint": "PDF, Word, Excel, PowerPoint ou image — jusqu'à 25 Mo.",
    "requests.uploadDraftFirst": "Enregistrez d'abord le brouillon pour joindre des documents.",
    "requests.uploadReplace": "Remplacer",
    "requests.uploadCurrent": "Fichier actuel",
    "requests.solutionDocument": "Document de solution",
    "requests.saveAndContinue": "Enregistrer et continuer",
    "requests.toast.docMissing": "Documents requis manquants",
    "requests.toast.docMissingDesc": "Les cinq documents de planification doivent être téléversés avant la soumission.",
    "detail.field.documents": "Documents",
    "detail.documents.download": "Télécharger",
    "detail.documents.none": "Aucun document téléversé.",
```

- [ ] **Step 3: Type-check**

Run: `pnpm tsc --noEmit`
Expected: PASS (the i18n map type, if keyed, stays consistent across both languages).

- [ ] **Step 4: Commit**

```bash
git add src/lib/i18n.ts
git commit -m "feat(i18n): add document upload + summary + detail document keys"
```

---

## Task 9: Document upload widget (TDD smoke)

**Files:**
- Create: `src/components/document-upload.tsx`
- Test: `src/test/components/document-upload.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// src/test/components/document-upload.test.tsx
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/test/components/document-upload.test.tsx`
Expected: FAIL — cannot resolve `@/components/document-upload`.

- [ ] **Step 3: Write the implementation**

```tsx
// src/components/document-upload.tsx
"use client"

import { useState, useRef } from "react"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toaster"
import type { AttachmentKind } from "@prisma/client"

const ACCEPT =
  ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg"

type Current = { id: string; filename: string }

interface Props {
  changeId: string | null
  kind: AttachmentKind
  label: string
  current?: Current
  onUploaded?: (attachment: { id: string; filename: string }) => void
}

export default function DocumentUpload({ changeId, kind, label, current, onUploaded }: Props) {
  const { language } = useStore()
  const { toast } = useToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploaded, setUploaded] = useState<Current | undefined>(current)

  async function handleFile(file: File) {
    if (!changeId) return
    setUploading(true)
    try {
      const form = new FormData()
      form.set("kind", kind)
      form.set("file", file)
      const res = await fetch(`/api/changes/${changeId}/documents`, { method: "POST", body: form })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? "Upload failed")
      }
      const att = await res.json()
      setUploaded({ id: att.id, filename: att.filename })
      onUploaded?.({ id: att.id, filename: att.filename })
      toast({ title: `${label}: ${att.filename}`, variant: "success" })
    } catch (err) {
      toast({ title: "Upload failed", description: err instanceof Error ? err.message : "Error", variant: "error" })
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        {label} <span className="text-rose-600">*</span>
      </div>
      {!changeId ? (
        <p className="text-xs text-amber-600">{t(language, "requests.uploadDraftFirst")}</p>
      ) : (
        <>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void handleFile(f)
            }}
          />
          <div className="flex items-center gap-3">
            <Button type="button" variant="outline" disabled={uploading} onClick={() => inputRef.current?.click()}>
              {uploaded ? t(language, "requests.uploadReplace") : t(language, "requests.uploadRequired")}
            </Button>
            {uploaded && (
              <span className="text-sm text-muted-foreground">
                {t(language, "requests.uploadCurrent")}: <span className="font-medium text-foreground">{uploaded.filename}</span>
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{t(language, "requests.uploadHint")}</p>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/test/components/document-upload.test.tsx`
Expected: PASS (2 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/components/document-upload.tsx src/test/components/document-upload.test.tsx
git commit -m "feat(ui): add document upload widget"
```

---

## Task 10: Infra dropdown + summaries + attachments prop in the form

**Files:**
- Modify: `src/app/(dashboard)/requests/request-form.tsx`

- [ ] **Step 1: Replace the infrastructure-type radio list with a dropdown**

Replace the `<CardContent className="grid gap-2">…radio…</CardContent>` block (the infra card body, ~208-220) with:

```tsx
          <CardContent>
            <select
              className="h-10 sm:h-9 w-full rounded-md border border-border bg-white px-3 text-sm"
              value={infrastructureType}
              onChange={(e) => setInfrastructureType(e.target.value as (typeof infraTypes)[number])}
            >
              <option value="" disabled>
                {t(language, "requests.oneOption")}
              </option>
              {infraTypes.map((infra) => (
                <option key={infra} value={infra}>
                  {infra}
                </option>
              ))}
            </select>
          </CardContent>
```

- [ ] **Step 2: Add the `attachments` prop and relabel the four planning textareas as optional summaries**

Extend `Props` and `Initial`:

```tsx
type AttachmentSlot = { id: string; kind: string; filename: string }

interface Props {
  opcoOptions: string[]
  myRequests?: MyRequest[]
  mode?: "create" | "edit"
  initial?: Initial
  defaultEmail?: string
  attachments?: AttachmentSlot[]
}
```

Add `attachments = []` to the destructured params:

```tsx
export default function RequestForm({ opcoOptions, myRequests, mode = "create", initial, defaultEmail, attachments = [] }: Props) {
```

For each of the four planning `<Card>`s (impact, implementation, testing, backout), change the `CardTitle` to indicate the textarea is now an optional summary by appending the summary label. Example for impact scope (apply the same pattern to the other three):

```tsx
            <CardTitle className="text-base">
              {t(language, "requests.impactScope")} — {t(language, "requests.summaryOptional")}
            </CardTitle>
```

- [ ] **Step 3: Type-check**

Run: `pnpm tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/requests/request-form.tsx"
git commit -m "feat(form): infra dropdown + optional summaries + attachments prop"
```

---

## Task 11: Upload widgets + create→edit button flow in the form

**Files:**
- Modify: `src/app/(dashboard)/requests/request-form.tsx`
- Modify: `src/app/(dashboard)/changes/[id]/edit/page.tsx`

- [ ] **Step 1: Import the widget and build a slot lookup**

At the top of `request-form.tsx`, add:

```tsx
import DocumentUpload from "@/components/document-upload"
import type { AttachmentKind } from "@prisma/client"
```

Inside the component body (after the state hooks), derive a per-kind current-file map and which docs are present:

```tsx
  const changeId = mode === "edit" && initial ? initial.id : null
  const slotByKind = new Map(attachments.map((a) => [a.kind, a]))
  const DOC_SLOTS: { kind: AttachmentKind; labelKey: string }[] = [
    { kind: "impact_scope", labelKey: "requests.impactScope" },
    { kind: "implementation_plan", labelKey: "requests.implementationPlan" },
    { kind: "testing_plan", labelKey: "requests.testingPlan" },
    { kind: "backout_plan", labelKey: "requests.backoutPlan" },
    { kind: "solution_document", labelKey: "requests.solutionDocument" },
  ]
  // Live set of uploaded kinds — seeded from props, updated as widgets upload in-session
  // so the Submit gate doesn't go stale against the static `attachments` prop.
  const [uploadedKinds, setUploadedKinds] = useState<Set<string>>(
    () => new Set(attachments.map((a) => a.kind))
  )
```

- [ ] **Step 2: Render the five upload widgets**

Immediately after the four summary `<Card>`s and before the action-buttons `<div>`, add:

```tsx
        <Card className="border-border/80 bg-card/95">
          <CardHeader>
            <CardTitle className="text-base">{t(language, "detail.field.documents")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5">
            {DOC_SLOTS.map((slot) => {
              const cur = slotByKind.get(slot.kind)
              return (
                <DocumentUpload
                  key={slot.kind}
                  changeId={changeId}
                  kind={slot.kind}
                  label={t(language, slot.labelKey)}
                  current={cur ? { id: cur.id, filename: cur.filename } : undefined}
                  onUploaded={() => setUploadedKinds((prev) => new Set(prev).add(slot.kind))}
                />
              )
            })}
          </CardContent>
        </Card>
```

- [ ] **Step 3: Make create mode redirect to the edit page so uploads become available**

In `save()`, change the create-mode redirect so the user lands where uploads are enabled. Replace the post-save navigation:

```tsx
      if (submit) await submitChange(id)
      toast({
        title: submit ? t(language, "requests.toast.submitted") : t(language, "requests.toast.savedDraft"),
        variant: "success",
      })
      if (!submit && mode === "create") {
        router.push(`/changes/${id}/edit`)
      } else {
        router.push(`/changes/${id}`)
      }
      router.refresh()
```

- [ ] **Step 4: Replace the action buttons so Submit only appears (and is gated) in edit mode**

Replace the action-button `<div className="flex flex-col sm:flex-row items-center gap-3">…</div>` block with:

```tsx
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <Button
            variant="outline"
            onClick={() => save({ submit: false })}
            disabled={isSaving}
            className="w-full sm:w-auto"
          >
            {mode === "create" ? t(language, "requests.saveAndContinue") : t(language, "requests.saveDraft")}
          </Button>
          {mode === "edit" && (
            <Button
              onClick={() => {
                const allDocs = ["impact_scope", "implementation_plan", "testing_plan", "backout_plan", "solution_document"]
                  .every((k) => uploadedKinds.has(k))
                if (!allDocs) {
                  toast({
                    title: t(language, "requests.toast.docMissing"),
                    description: t(language, "requests.toast.docMissingDesc"),
                    variant: "error",
                  })
                  return
                }
                void save({ submit: true })
              }}
              disabled={isSaving}
              className="w-full sm:w-auto"
            >
              {t(language, "requests.submitForApproval")}
            </Button>
          )}
          <p className="text-xs text-muted-foreground sm:text-center sm:ml-2">{t(language, "requests.submitHint")}</p>
        </div>
```

> Note: this client check is a UX convenience driven by the live `uploadedKinds` set (seeded from props, updated by each widget's `onUploaded`). The server guard in Task 7 is the real gate (it re-reads attachments from the DB), so correctness does not depend on this client check.

- [ ] **Step 5: Pass `attachments` from the edit page**

In `src/app/(dashboard)/changes/[id]/edit/page.tsx`, add to the `RequestForm` props:

```tsx
    <RequestForm
      mode="edit"
      initial={initial}
      opcoOptions={[change.opco.slug]}
      defaultEmail={change.contactEmail}
      attachments={change.attachments.map((a) => ({ id: a.id, kind: a.kind, filename: a.filename }))}
    />
```

- [ ] **Step 6: Type-check and run the form-adjacent tests**

Run: `pnpm tsc --noEmit && pnpm test src/test/components/document-upload.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(dashboard)/requests/request-form.tsx" "src/app/(dashboard)/changes/[id]/edit/page.tsx"
git commit -m "feat(form): document upload slots + create→edit flow + submit gating"
```

---

## Task 12: Documents section on the change detail page

**Files:**
- Modify: `src/app/(dashboard)/changes/[id]/page.tsx` (`serialize` ~10-40, `SerializedChange` import)
- Modify: `src/app/(dashboard)/changes/[id]/change-detail-client.tsx` (type ~28-31, render ~232-242)

- [ ] **Step 1: Add `attachments` to `SerializedChange` and serialize them**

In `change-detail-client.tsx`, add to the `SerializedChange` type (near the other fields):

```tsx
  attachments: { id: string; kind: string; filename: string }[]
```

In `page.tsx`'s `serialize`, add to the returned object:

```tsx
    attachments: change.attachments.map((a) => ({ id: a.id, kind: a.kind, filename: a.filename })),
```

- [ ] **Step 2: Render a Documents card with download links**

In `change-detail-client.tsx`, after the backout-plan `DetailRow` (~242), add:

```tsx
              <div className="mt-4">
                <p className="text-sm font-medium mb-2">{t(language, "detail.field.documents")}</p>
                {change.attachments.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t(language, "detail.documents.none")}</p>
                ) : (
                  <ul className="space-y-1">
                    {change.attachments.map((a) => (
                      <li key={a.id}>
                        <a
                          className="text-sm text-primary underline"
                          href={`/api/changes/${change.id}/documents/${a.id}`}
                        >
                          {a.filename} — {t(language, "detail.documents.download")}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
```

- [ ] **Step 3: Type-check**

Run: `pnpm tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/changes/[id]/page.tsx" "src/app/(dashboard)/changes/[id]/change-detail-client.tsx"
git commit -m "feat(detail): show change documents with RBAC-gated download links"
```

---

## Task 13: Env vars + provisioning docs

**Files:**
- Modify/Create: `.env.example`
- Modify: `README.md` (or create `docs/google-drive-setup.md` if README lacks a config section)

- [ ] **Step 1: Document the new env vars**

Add to `.env.example`:

```bash
# Google Drive document storage (service account)
GOOGLE_SERVICE_ACCOUNT_KEY=   # full service-account JSON, single line
GDRIVE_SHARED_DRIVE_ID=       # ID of the private "Change Management" Shared Drive
GDRIVE_ROOT_FOLDER_ID=        # ID of the root folder inside that Shared Drive
```

- [ ] **Step 2: Write the provisioning steps**

Create `docs/google-drive-setup.md`:

```markdown
# Google Drive Document Storage Setup

1. In the CSquared Google Cloud project, enable the **Google Drive API**.
2. Create a **service account**; generate a **JSON key**. Store the JSON as the
   `GOOGLE_SERVICE_ACCOUNT_KEY` env var (single line). Never commit it.
3. In Google Drive, create a **private Shared Drive** named "Change Management" and a
   root folder inside it. Copy the Shared Drive ID → `GDRIVE_SHARED_DRIVE_ID`, and the
   root folder ID → `GDRIVE_ROOT_FOLDER_ID`.
4. Add the service account's email as a **Content Manager** of the Shared Drive.
5. Verify: upload a document through a draft change request and confirm it appears under
   `OpCo / Year / CHG-#### — Title / NN_Section/` in the Shared Drive.

Access is service-account-only; no human or end-user OAuth is used, and no shareable
links are issued (ISO 27001:2022 A.8.3 / A.8.12).
```

- [ ] **Step 3: Commit**

```bash
git add .env.example docs/google-drive-setup.md
git commit -m "docs: document Google Drive service-account env vars and provisioning"
```

---

## Task 14: Final verification (phase gate)

> Per `memory/feedback_phase_gates.md`: run the deslop skill and ensure all tests pass before this work is considered done.

- [ ] **Step 1: Run the deslop skill over the new/changed files**

Invoke the `deslop` skill on `src/server/drive.ts`, `src/server/documents.ts`, `src/components/document-upload.tsx`, the route handlers, and the form changes. Apply its findings.

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: PASS (no new errors).

- [ ] **Step 3: Type-check**

Run: `pnpm tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Full test suite**

Run: `pnpm test`
Expected: PASS — all prior suites plus the new drive/documents/route/widget tests. (The Testcontainers isolation test needs Docker running; ensure the local stack is up.)

- [ ] **Step 5: Manual smoke test (with the local dev stack + Drive env vars set)**

1. `pnpm dev`, log in as `devops@csquared.com`.
2. Create a change request (scalar fields) → Save & Continue → lands on the edit page.
3. Upload all five documents; confirm each appears under the correct Drive subfolder.
4. Try Submit with one document missing → blocked with the missing-docs message.
5. Upload the last document → Submit succeeds → change goes `pending`.
6. Open the change detail page → download a document → file streams; confirm a
   `document_downloaded` audit row exists.

- [ ] **Step 6: Commit any deslop/lint fixes**

```bash
git add -A
git commit -m "chore: deslop + lint pass for change-request documents"
```

---

## Self-Review Notes (for the implementer)

- **Create vs edit upload availability:** uploads require a persisted change (and its `id`), so they are only enabled in edit mode. Create mode collects scalar fields and redirects to the edit page on save. This is intentional, not a gap.
- **Version history:** re-uploading a slot creates a new Drive file and repoints the `Attachment` row (`@@unique([changeId, kind])` upsert); the prior Drive file is left in its subfolder as history (no hard delete) — matches the spec.
- **Server is the source of truth:** the form's submit check is UX only; `submitChange` re-reads attachments and required fields and is the real gate.
- **Folder finalize:** `finalizeChangeFolderName` exists for renaming the folder to the final title at submit; wire it into `submitChange` if you want the rename to happen automatically (optional — folder is already created with the title at first upload).
