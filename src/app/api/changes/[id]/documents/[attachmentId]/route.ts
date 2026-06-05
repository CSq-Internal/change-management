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
