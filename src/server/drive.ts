import { drive as driveApi, type drive_v3 } from "@googleapis/drive"
import { GoogleAuth } from "google-auth-library"
import { Readable } from "node:stream"

export function sanitizeSegment(input: string): string {
  const cleaned = input
    .replace(/[?*"<>|]/g, "")
    .replace(/[\\/:]/g, "-")
    .trim()
  return cleaned.length > 0 ? cleaned : "untitled"
}

export function changeFolderName(reference: number, title: string): string {
  const padded = String(reference).padStart(4, "0")
  return `CHG-${padded} — ${sanitizeSegment(title)}`
}

function getDrive(): drive_v3.Drive {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is not set")
  const credentials = JSON.parse(raw)
  const auth = new GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive"],
  })
  return driveApi({ version: "v3", auth })
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

// Files land directly in the change folder (Change Management / OpCo / Year / CHG-#### — Title);
// no per-kind subfolders. The DB Attachment row tracks which file is which kind.
export async function uploadDocument(input: {
  changeFolderId: string
  filename: string
  mimeType: string
  buffer: Buffer
}): Promise<string> {
  const drive = getDrive()
  const created = await drive.files.create({
    requestBody: { name: input.filename, parents: [input.changeFolderId] },
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

// ISO 27001 A.8.7 malware-scan seam. No-op in v1; throw to reject a file later.
export async function scanFile(_buffer: Buffer, _filename: string): Promise<void> {
  return
}
