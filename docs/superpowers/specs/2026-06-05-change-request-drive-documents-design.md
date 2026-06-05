# Change Request Flow Revamp — Drive-backed Documents

**Date:** 2026-06-05
**Status:** Approved (design)
**Branch:** `feat/change-request-drive-docs`

## Summary

Revamp the change request submission flow so that the four planning sections and a
new solution document become **required file uploads** stored in a private Google
Drive Shared Drive, accessed only through RBAC-gated, audit-logged app endpoints.
Tighten field validation (everything mandatory at submit), and convert the
infrastructure-type radio list to a dropdown. The design honours the existing
RBAC model and maps to ISO 27001:2022 Annex A controls.

## Goals

- All form fields mandatory **at submit time** (drafts stay lenient).
- Infrastructure type: radio list → dropdown (mirrors the OpCo selector).
- Impact & scope, implementation plan, testing & validation plan, backout plan:
  free-text → **required file upload + optional short text summary**.
- New required **Solution Document** upload.
- Files stored in a centralized, well-ordered Google Drive Shared Drive.
- Access fully mediated by the app's RBAC; every upload/download audit-logged.
- Defensible against ISO 27001:2022 access-control and logging controls.

## Non-goals (future phases)

- Malware-scan **implementation** (the pipeline hook is designed in; scanning is deferred).
- Google Group / Drive-native sharing synchronisation.
- Document e-signatures.
- Automated retention / deletion enforcement.
- Virus-quarantine UI.

## Decisions (from brainstorming)

| Topic | Decision |
|---|---|
| Drive setup | Google Workspace + private **Shared Drive** + **service account** (to be provisioned). |
| File access | **App-mediated (proxied) downloads.** Drive links never exposed. |
| Text vs file | Each section becomes a **required upload** plus an **optional inline text summary**. |
| Mandatory timing | Enforced **only at Submit**; Save Draft stays lenient. |
| File types | PDF + Office (docx/xlsx/pptx) + images (PNG/JPG). |
| Malware scanning | **Deferred** — pipeline hook designed in, no-op in v1. |
| Folder layout | **OpCo › Year › Change › document-type subfolder.** |
| Upload mechanics | **Option A — proxy through a Next.js route handler** (service account → Drive). |
| File size cap | 25 MB/file (configurable). |
| Re-upload behaviour | New file replaces the current slot; prior file retained as version history in its subfolder. |

## Architecture

### Upload mechanics — Option A (proxy through app)

Browser uploads to an authenticated app route → route checks RBAC → validates type
and size → (scan hook) → streams to the private Shared Drive via the service account
→ records an `Attachment`. Downloads stream back through the app in reverse.
Everything stays server-side; RBAC sits at a single boundary.

Rejected alternatives: direct resumable client→Drive upload (exposes Drive, weakens
the RBAC choke point); local staging + background sync (adds a queue and failure
surface not needed yet).

### 1. Form changes (UI) — `src/app/(dashboard)/requests/request-form.tsx`

- Infrastructure type: radio list → `<select>` dropdown, same 7 options.
- Four planning sections: each becomes a **required upload** + **optional short text summary**.
- New required **Solution Document** upload.
- Mandatory enforcement at Submit only. Save Draft stays lenient.
- Each upload widget shows accepted types, 25 MB cap, current file
  (name / size / uploaded-by), and replace/remove actions while status is `draft`.

### 2. Data model (Prisma) — `prisma/schema.prisma`

- `ChangeRequest.reference Int @unique @default(autoincrement())` — displayed as
  `CHG-0042`; drives folder naming and audit readability.
- `ChangeRequest.driveFolderId String?` — the change's Drive folder, created lazily
  on first upload.
- `Attachment` gains:
  - `kind AttachmentKind` — enum
    `impact_scope | implementation_plan | testing_plan | backout_plan | solution_document`.
  - `uploadedById String` (+ relation to `User`).
  - `storageKey` reused to hold the **Drive file ID**.
  - `filename / mimeType / sizeBytes` retained.
- The four existing `String?` planning columns (`impactScope`, `implementationPlan`,
  `testingPlan`, `backoutPlan`) become the optional **summaries** — semantics change
  only, no column drop.

New enum:

```prisma
enum AttachmentKind {
  impact_scope
  implementation_plan
  testing_plan
  backout_plan
  solution_document
}
```

### 3. Drive integration — `src/server/drive.ts`

- Singleton Google Drive client authed via a **service account** (JSON key in
  env/secret manager), scoped to one **private Shared Drive**. No end-user OAuth.
- Functions:
  - `ensureChangeFolder(change)` → creates `OpCo / Year / CHG-#### — Title /` with the
    five `01_…05_` subfolders; returns folder IDs; idempotent.
  - `uploadDocument({ folderId, kind, file })` → streams the file into the correct
    subfolder; returns the Drive file ID.
  - `getDownloadStream(fileId)` → for proxied download.
  - `renameChangeFolder(folderId, finalTitle)` → called when the title is finalized
    at submit, keeping the tree clean.
- Folder scheme: **OpCo › Year › Change › document-type subfolder.** Year = change
  creation year. Folder created lazily on first upload; renamed to the final title at
  submit.

Example tree:

```
Change Management/
  Equiano/
    2026/
      CHG-0042 — Core router upgrade/
        01_Impact-and-Scope/
        02_Implementation-Plan/
        03_Testing-and-Validation/
        04_Backout-Plan/
        05_Solution-Document/
  CSquared-Group/
    2026/
      CHG-0043 — .../
```

### 4. Upload & download flow (RBAC + audit)

**Upload** — `POST /api/changes/[id]/documents`:
1. Auth via existing session.
2. Allow only the **requester or an OpCo/group admin** while status is `draft`
   (reuses `updateChange`'s rule).
3. Validate type + size.
4. **Scan hook** (no-op pass-through in v1; seam for ClamAV / scanning API later).
5. `ensureChangeFolder` → `uploadDocument`.
6. Upsert `Attachment` keyed by `(changeId, kind)` — replacing the same `kind` keeps
   one current file per slot; the previous Drive file remains in the subfolder as
   version history.
7. Write `AuditLog` action `document_uploaded`, metadata `{ attachmentId, kind, filename }`.

**Download** — `GET /api/changes/[id]/documents/[attachmentId]`:
1. Auth.
2. Allow **group-level or OpCo member** (reuses `getChange`'s read rule).
3. `getDownloadStream` → stream bytes through the app.
4. Write `AuditLog` action `document_downloaded`, metadata `{ attachmentId, kind, filename }`.
5. **No Drive links ever leave the server.**

### 5. Validation rules

- Submit-time guard lives in `submitChange` (server) **and** is mirrored in the form
  (client) for UX. The **server is the source of truth**: before allowing
  `draft → pending` it re-checks all required fields plus that all five `Attachment`
  kinds exist. Enforcement holds even if the client is bypassed.

### 6. ISO 27001:2022 control mapping

| Control | How it's satisfied |
|---|---|
| A.5.15 Access control | RBAC-gated proxy; OpCo + role checks on every operation. |
| A.8.3 Information access restriction | Service-account-only Shared Drive; zero public links. |
| A.8.15 Logging | Upload / download / access events in the immutable audit trail. |
| A.8.24 Use of cryptography | TLS in transit; Drive encryption at rest. |
| A.8.7 Malware protection | Pipeline scan hook (deferred implementation, designed in). |
| A.5.33 / A.8.10 Protection & handling of records | Structured, attributable, retained change evidence. |
| A.8.12 Data-leakage prevention | No shareable links; access only through audited app paths. |

### 7. Config / secrets

New env vars (documented, never committed):

- `GOOGLE_SERVICE_ACCOUNT_KEY` — service-account JSON key.
- `GDRIVE_SHARED_DRIVE_ID` — the private Shared Drive ID.
- `GDRIVE_ROOT_FOLDER_ID` — the `Change Management` root folder ID.

Provisioning steps (Google Cloud) to be documented in the plan:
1. Create a service account in the CSquared Google Cloud project.
2. Generate a JSON key; store it in the secret manager / env, not in git.
3. Create the private Shared Drive and the `Change Management` root folder.
4. Add the service account as a Content Manager of the Shared Drive.

### 8. Testing

- **Unit:** submit blocked when any field/document missing; allowed when complete.
- **Permissions:** upload denied for non-requester/non-admin; download denied for
  non-OpCo members; both allowed for the correct roles.
- **Drive service mocked** in tests (no real API calls); the existing Testcontainers
  integration path stays Drive-free.

## Open assumptions

- 25 MB per-file cap, configurable.
- Re-uploading a document replaces the current slot and keeps the prior file in its
  Drive subfolder (no hard delete).
