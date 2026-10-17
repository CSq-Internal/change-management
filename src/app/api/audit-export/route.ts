import { auth } from "@/auth"
import { getPrisma } from "@/server/db"
import { NextRequest, NextResponse } from "next/server"
import { isGroupLevel } from "@/lib/permissions"
import { csvRow } from "@/lib/csv"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = req.nextUrl
  const opcoSlug = searchParams.get("opco")
  // Dates are whole days (yyyy-mm-dd from the date pickers): "to" includes all of that day.
  const from = searchParams.get("from") ? new Date(searchParams.get("from")!) : null
  const to = searchParams.get("to") ? new Date(searchParams.get("to")!) : null
  if ((from && isNaN(from.getTime())) || (to && isNaN(to.getTime()))) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 })
  }
  const at = from || to
    ? {
        ...(from && { gte: from }),
        ...(to && { lt: new Date(to.getTime() + 24 * 60 * 60 * 1000) }),
      }
    : undefined

  const db = getPrisma()
  const groupLevel = isGroupLevel(session.user.realmRoles)
  const opcoSlugs = groupLevel
    ? (opcoSlug ? [opcoSlug] : undefined)
    : session.user.organizations.map((o) => o.alias)

  const entries = await db.auditLog.findMany({
    where: {
      change: opcoSlugs ? { opco: { slug: { in: opcoSlugs } } } : undefined,
      at,
    },
    include: { actor: true, change: { include: { opco: true } } },
    orderBy: { at: "desc" },
  })

  const headers = ["Timestamp", "Actor", "Action", "Change Title", "OpCo", "From Status", "To Status", "Note"]
  const rows = entries.map((e) => [
    e.at.toISOString(), e.actor.email, e.action, e.change.title,
    e.change.opco.slug, e.fromStatus ?? "", e.toStatus ?? "", e.note ?? "",
  ])
  const csv = [headers, ...rows].map(csvRow).join("\n")

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="csquared-audit-${Date.now()}.csv"`,
    },
  })
}
