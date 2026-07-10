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
