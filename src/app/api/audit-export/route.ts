import { auth } from "@/auth"
import { getPrisma } from "@/server/db"
import { NextRequest, NextResponse } from "next/server"
import { isGroupAdmin } from "@/lib/permissions"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = req.nextUrl
  const opcoSlug = searchParams.get("opco")
  const from = searchParams.get("from")
  const to = searchParams.get("to")

  const db = getPrisma()
  const groupLevel = isGroupAdmin(session.user.realmRoles)
  const opcoSlugs = groupLevel
    ? (opcoSlug ? [opcoSlug] : undefined)
    : session.user.organizations.map((o) => o.alias)

  const entries = await db.auditLog.findMany({
    where: {
      change: opcoSlugs ? { opco: { slug: { in: opcoSlugs } } } : undefined,
      ...(from && { at: { gte: new Date(from) } }),
      ...(to && { at: { lte: new Date(to) } }),
    },
    include: { actor: true, change: { include: { opco: true } } },
    orderBy: { at: "desc" },
  })

  const headers = ["Timestamp", "Actor", "Action", "Change Title", "OpCo", "From Status", "To Status", "Note"]
  const rows = entries.map((e) => [
    e.at.toISOString(), e.actor.email, e.action, e.change.title,
    e.change.opco.slug, e.fromStatus ?? "", e.toStatus ?? "", e.note ?? "",
  ])
  const csv = [headers, ...rows]
    .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\n")

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="csquared-audit-${Date.now()}.csv"`,
    },
  })
}
