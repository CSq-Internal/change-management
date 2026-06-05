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
