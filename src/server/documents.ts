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
