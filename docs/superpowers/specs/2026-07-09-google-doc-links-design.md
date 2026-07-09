# Google Doc links as an alternative to file uploads

**Date:** 2026-07-09
**Status:** Approved — ready for implementation plan
**Area:** Change-request document slots

## Problem

The change-request form requires five planning documents (impact scope, implementation
plan, testing plan, backout plan, solution document) to be uploaded as local files for
high/emergency-risk changes. Today those files are stored in a private service-account
Shared Drive and every view is proxied through an RBAC-gated, audit-logged route
(`src/server/documents.ts`, ISO 27001 A.8.3/A.8.15).

Stakeholders often already have a plan written in a shared Google Doc that "everyone has
access to." They want to satisfy a document slot by **pasting a link to that Google Doc**
instead of re-uploading a file.

## Goal

Let a requester satisfy any of the five document slots with **either** an uploaded file
(unchanged behavior) **or** a link to a Google Workspace document. Minimal, YAGNI:
store-and-display only — no per-user OAuth, no Google Picker, no title fetch, no
accessibility verification.

## Non-goals

- Google Picker / per-user OAuth (the ask is a pasted link, not a browse-my-Drive flow).
- Fetching the doc title or verifying the service account can read the link (would
  re-introduce `googleapis` on the submit path and assumes SA access we can't guarantee).
- Any change to how uploaded files are stored, proxied, or audited.
- Non-Google links (Confluence, SharePoint, etc.) — explicitly out of scope.

## Design

### 1. Data model (`prisma/schema.prisma`)

One `Attachment` row represents **either** a stored file **or** a link:

- Make `storageKey` **nullable** (`String?`).
- Add `externalUrl String?`.
- Invariant: exactly one of `storageKey` / `externalUrl` is set.
  - `storageKey` set → uploaded file (Drive file ID), current behavior.
  - `externalUrl` set → linked Google doc; `mimeType` / `sizeBytes` are null.
- The existing `@@unique([changeId, kind])` is unchanged, so a slot holds one file **or**
  one link. Pasting a link into a slot that had a file (or vice-versa) **replaces** it via
  upsert.

One Prisma migration (nullable `storageKey` + new `externalUrl`). Existing rows are
unaffected (they keep a non-null `storageKey`).

### 2. Validation (`src/lib/google-links.ts`, new — client-safe, no server imports)

```
isGoogleWorkspaceUrl(url: string): boolean
```

True only when `url` parses as an `https:` URL whose host is `docs.google.com` or
`drive.google.com` (covers Docs, Sheets, Slides, and Drive file links). Pure URL parsing,
no `googleapis` import, so it is importable from both the client form and server modules.
Used on the client for an inline error and on the server as the authoritative gate.

### 3. Server (`src/server/documents.ts`)

New `attachLink({ changeId, kind, url })`, mirroring `attachDocument`'s guards:

- Session → user; requester-or-admin check; `change.status === "draft"` only.
- Reject when `isGoogleWorkspaceUrl(url)` is false.
- `upsert` on `changeId_kind` with `externalUrl: url`, `storageKey: null`,
  `mimeType: null`, `sizeBytes: null`, `uploadedById` = the actor, and
  `filename` = the pasted URL (schema requires `filename` non-null; kept as a raw
  record of what was linked, though the detail page shows the kind label — see below).
- Write an audit row `action: "document_linked"`, metadata `{ kind, url }`.

`getDocumentForDownload` gains a guard: a link attachment has no bytes, so it throws
"This document is an external link" rather than calling Drive.

### 4. API + client

- `POST /api/changes/[id]/documents` branches on content-type:
  - `multipart/form-data` → file path (unchanged).
  - `application/json { kind, url }` → `attachLink`.
  - No new route; the `[attachmentId]` download route is unchanged (link attachments are
    never routed through it — see below).
- `DocumentSection` (`src/components/document-section.tsx`) gains a per-slot
  **toggle: "Upload file" | "Link a Google Doc."**
  - File mode: today's button + staged-file display.
  - Link mode: a URL input with the same inline-error style used for file type/size;
    invalid (non-Google) input shows the bad-link message and does not stage.
  - A staged link is held client-side and passed up via `onLinkChange(url | null)`.
- `request-form.tsx`:
  - Add `stagedLinks: Partial<Record<AttachmentKind, string>>` alongside `stagedFiles`.
  - Initialize `linkedByKind` from persisted attachments that have `externalUrl`
    (parallel to `uploadedByKind`).
  - A slot counts as satisfied at submit if it has a staged file **or** staged link **or**
    a persisted file **or** a persisted link.
  - On Save/Submit, after persisting the change, POST staged links (JSON) the same way
    staged files are POSTed (multipart) — one atomic flow; clear each from staging on
    success.
- Change-detail (`change-detail-client.tsx`): the attachment shape gains
  `externalUrl?: string | null`. A link attachment renders as an external
  `<a href={externalUrl} target="_blank" rel="noopener">` whose text is the document
  **kind label** (e.g. "Implementation Plan ↗"), instead of the
  `/api/changes/[id]/documents/[attachmentId]` proxy link used for files.

### 5. Error handling & i18n

- Invalid / non-Google URL → rejected client-side (inline) and server-side (thrown).
- Empty link while in link mode is treated like a missing document at submit (same
  "required document missing" toast path).
- FR/EN strings for: the toggle labels, the link-input placeholder ("Paste a Google
  Docs/Sheets/Slides link"), the bad-link error, and the detail "Open in Google"
  affordance.

### 6. Governance note

Linking intentionally moves access control for the linked doc **outside** the app's
RBAC/audit boundary — the doc's visibility is whatever Google sharing says. Mitigations:
(a) restrict to Google Workspace hosts, (b) audit-log who linked what and when
(`document_linked`). Uploaded files keep the full app-mediated, proxied, RBAC-gated
behavior. This trade-off is the stakeholder's explicit request.

## Testing

- `src/test/lib/google-links.test.ts` — `isGoogleWorkspaceUrl` accepts Docs/Sheets/Slides/
  Drive URLs, rejects non-Google hosts, non-https, and garbage.
- `attachLink` action tests — RBAC (requester/admin only), draft-only, URL rejection,
  file↔link replacement on the same slot, and `document_linked` audit row written.
- Submit-guard test — a slot satisfied only by a link passes the required-documents check.
- Detail render — a link attachment renders an external anchor, not the proxy download link.
- Full suite stays green.

## Touchpoints (summary)

| File | Change |
|------|--------|
| `prisma/schema.prisma` + migration | `storageKey` nullable, add `externalUrl` |
| `src/lib/google-links.ts` (new) | `isGoogleWorkspaceUrl` |
| `src/server/documents.ts` | `attachLink`; link guard in `getDocumentForDownload` |
| `src/app/api/changes/[id]/documents/route.ts` | JSON branch → `attachLink` |
| `src/components/document-section.tsx` | file/link toggle + link input |
| `src/app/(dashboard)/requests/request-form.tsx` | staged links, POST links, satisfaction check |
| `src/app/(dashboard)/changes/[id]/change-detail-client.tsx` | render link attachments as external anchors |
| `src/lib/i18n.ts` | FR/EN strings |
| tests | as above |
