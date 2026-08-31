import { NextRequest, NextResponse } from "next/server"
import { runDueEscalations } from "@/server/sla"
import { runDueReminders } from "@/server/reminders"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Two callers, two auth conventions for the same secret:
//  - Vercel Cron invokes via GET with `Authorization: Bearer <CRON_SECRET>`.
//  - External schedulers / the GCP prod runbook POST with `x-cron-secret: <CRON_SECRET>`.
// Both are accepted so the endpoint works on either deployment.
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return (
    req.headers.get("authorization") === `Bearer ${secret}` ||
    req.headers.get("x-cron-secret") === secret
  )
}

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const escalations = await runDueEscalations({})
  // Reminders ride the same daily sweep — no second endpoint, secret, vercel.json entry,
  // or Cloud Scheduler job to keep in step.
  const reminders = await runDueReminders()
  return NextResponse.json({ escalations, reminders })
}

export const GET = handle
export const POST = handle
