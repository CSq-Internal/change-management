import { NextResponse } from "next/server"
import { getDocumentForDownload } from "@/server/documents"

// Header values are Latin-1 only, and Word names files with curly apostrophes and accents
// (a raw "Plan d’implémentation.docx" makes the response throw). RFC 6266: the real name
// goes in filename*, percent-encoded, with an ASCII stand-in for old clients.
function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "")
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`
}

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
        "content-disposition": contentDisposition(filename),
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Download failed"
    if (message.startsWith("Forbidden")) return NextResponse.json({ error: message }, { status: 403 })
    if (message.includes("not found")) return NextResponse.json({ error: message }, { status: 404 })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
