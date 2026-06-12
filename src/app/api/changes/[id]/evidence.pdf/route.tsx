import { NextRequest, NextResponse } from "next/server"
import { renderToBuffer } from "@react-pdf/renderer"
import { auth } from "@/auth"
import { getPrisma } from "@/server/db"
import { isGroupLevel, isMemberOfOpCo } from "@/lib/permissions"
import { EvidenceDocument } from "@/server/pdf/evidence-document"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const db = getPrisma()
  const change = await db.changeRequest.findUnique({
    where: { id },
    include: {
      opco: true,
      requester: true,
      implementedBy: true,
      approvals: { include: { approver: true }, orderBy: { decidedAt: "asc" } },
      auditTrail: { include: { actor: true }, orderBy: { at: "asc" } },
      attachments: { include: { uploadedBy: true }, orderBy: { kind: "asc" } },
      pir: { include: { author: true } },
    },
  })
  if (!change) return NextResponse.json({ error: "Not found" }, { status: 404 })

  if (!isGroupLevel(session.user.realmRoles) && !isMemberOfOpCo(session.user.organizations, change.opco.slug)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const buffer = await renderToBuffer(<EvidenceDocument change={change} generatedAt={new Date()} />)
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="evidence-${change.reference}.pdf"`,
    },
  })
}
