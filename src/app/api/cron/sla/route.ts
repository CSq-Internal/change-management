import { NextRequest, NextResponse } from "next/server"
import { runDueEscalations } from "@/server/sla"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const result = await runDueEscalations({})
  return NextResponse.json(result)
}
