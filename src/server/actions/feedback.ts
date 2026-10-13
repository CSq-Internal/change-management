// src/server/actions/feedback.ts
"use server"

import { headers } from "next/headers"
import { z } from "zod"
import { getPrisma } from "@/server/db"
import { getAppSession } from "@/lib/session"
import { isGroupAdmin } from "@/lib/permissions"
import { assertTriageDecision } from "@/lib/feedback-outcome"
import { CHANGE_ID_RE } from "@/lib/feedback-context"
import { sendFeedbackEmail } from "@/server/email"

// What the CLIENT may send. Author, roles and OpCos are taken from the session, never the
// payload, so a submission cannot misattribute itself.
const submissionSchema = z.object({
  category: z.enum(["bug", "confusing", "missing", "praise"]),
  severity: z.enum(["blocker", "major", "minor"]).nullable(),
  body: z.string().trim().min(1).max(4000),
  route: z.string().min(1).max(200),
  changeId: z.string().regex(CHANGE_ID_RE).nullable(),
  viewport: z.string().max(20),
  locale: z.enum(["en", "fr"]),
})

export type FeedbackSubmission = z.input<typeof submissionSchema>

/**
 * Store one piece of feedback with a snapshot of the writer's context, then (if configured)
 * tell FEEDBACK_INBOX. No audit row: feedback is not a change-control act. A failed email is
 * logged and swallowed — the row is what matters.
 */
export async function submitFeedback(input: FeedbackSubmission) {
  const session = await getAppSession()
  const parsed = submissionSchema.safeParse(input)
  if (!parsed.success) {
    throw new Error(`Invalid feedback: ${parsed.error.issues.map((i) => i.path.join(".") || i.message).join(", ")}`)
  }
  const s = parsed.data
  const db = getPrisma()

  const me = await db.user.findUnique({ where: { keycloakId: session.keycloakId }, select: { id: true } })
  if (!me) throw new Error("User not found")

  const roles = [
    ...session.realmRoles,
    ...session.organizations.flatMap((o) => o.roles.map((r) => `${o.alias}:${r}`)),
  ].join(", ").slice(0, 300)
  const opcoSlugs = session.organizations.map((o) => o.alias).join(", ").slice(0, 200)
  const userAgent = ((await headers()).get("user-agent") ?? "").slice(0, 300)

  const created = await db.feedback.create({
    data: {
      userId: me.id,
      category: s.category,
      severity: s.category === "bug" ? s.severity : null,
      body: s.body,
      route: s.route,
      roles,
      opcoSlugs,
      locale: s.locale,
      changeId: s.changeId,
      appVersion: (process.env.K_REVISION ?? "local").slice(0, 40),
      viewport: s.viewport,
      userAgent,
    },
    select: { id: true },
  })

  const inbox = process.env.FEEDBACK_INBOX
  if (inbox) {
    try {
      await sendFeedbackEmail({
        to: inbox,
        category: s.category,
        route: s.route,
        authorName: session.name ?? session.email,
        roles,
        opcoSlugs,
        body: s.body,
      })
    } catch (error) {
      console.error(`[feedback] inbox email failed for ${created.id} (feedback was stored):`, error)
    }
  }

  return { id: created.id }
}

/** Record what was decided about one report. Group admins only; a triage is final. */
export async function triageFeedback(id: string, outcome: string, note: string) {
  const session = await getAppSession()
  if (!isGroupAdmin(session.realmRoles)) throw new Error("Forbidden")
  const decision = assertTriageDecision(outcome, note)
  const db = getPrisma()

  const me = await db.user.findUnique({ where: { keycloakId: session.keycloakId }, select: { id: true } })
  if (!me) throw new Error("User not found")

  const row = await db.feedback.findUnique({ where: { id }, select: { id: true, triagedAt: true } })
  if (!row) throw new Error("Feedback not found")
  if (row.triagedAt) throw new Error("Feedback is already triaged")

  const triagedAt = new Date()
  // Conditional on triagedAt still being null, so two triagers cannot both "win".
  const { count } = await db.feedback.updateMany({
    where: { id, triagedAt: null },
    data: { triagedAt, outcome: decision.outcome, triageNote: decision.note, triagedById: me.id },
  })
  if (count === 0) throw new Error("Feedback is already triaged")

  return { id, triagedAt: triagedAt.toISOString(), outcome: decision.outcome, triageNote: decision.note }
}
