// src/lib/notifications.ts
// Pure notification copy + preference lookup. No DB. Unit-tested.

import type { Language } from "@/lib/i18n"

export type NotifyEventType =
  // pre-existing
  | "approval_requested" | "change_approved" | "change_rejected"
  | "sla_escalated" | "emergency_submitted"
  // lifecycle
  | "change_submitted" | "change_implemented" | "change_verified"
  | "change_closed" | "change_reopened" | "change_cancelled" | "change_rescheduled"
  // assignment
  | "assignee_added" | "assignee_removed"
  // emergency / compliance
  | "retro_approved" | "retro_rejected" | "retro_overdue" | "approver_nudge"

export type NotifyChannel = "email" | "in_app"

export type NotifyContext = {
  requesterName?: string
  newStatus?: string
  level?: number
  riskLevel?: string
  /** Who performed the action, for copy like "Kofi marked this implemented". */
  actorName?: string
  /** assignee_added / assignee_removed — "approver" or "implementer". */
  role?: string
  /** change_verified — the PIR outcome. */
  outcome?: string
  /** change_rescheduled — human-readable old and new windows. */
  windowFrom?: string
  windowTo?: string
  /** retro_overdue — when the retrospective approval is due. */
  dueAt?: string
  /** Free-text note (rejection comment, PIR summary, status-change note). */
  note?: string
}

export const NOTIFY_EVENT_TYPES: NotifyEventType[] = [
  "approval_requested", "approver_nudge", "change_approved", "change_rejected",
  "change_submitted", "change_implemented", "change_verified", "change_closed",
  "change_reopened", "change_cancelled", "change_rescheduled",
  "assignee_added", "assignee_removed",
  "emergency_submitted", "sla_escalated", "retro_approved", "retro_rejected", "retro_overdue",
]

/** Preference-matrix sections. 18 types x 2 channels is unusable as a flat list. */
export const NOTIFY_EVENT_GROUPS: { key: string; types: NotifyEventType[] }[] = [
  { key: "approvals", types: ["approval_requested", "approver_nudge", "change_approved", "change_rejected"] },
  { key: "lifecycle", types: ["change_submitted", "change_implemented", "change_verified", "change_closed", "change_reopened", "change_cancelled", "change_rescheduled"] },
  { key: "assignment", types: ["assignee_added", "assignee_removed"] },
  { key: "emergency", types: ["emergency_submitted", "sla_escalated", "retro_approved", "retro_rejected", "retro_overdue"] },
]

/**
 * Channel defaults applied when a user has no stored preference row.
 *
 * Email is on where the recipient is the *subject* of the event (their request moved,
 * they were named on a change, something needs their action) and off for ambient events
 * they merely have a stake in — those stay in-app so the feed remains complete without
 * flooding inboxes. The five pre-existing types keep `{ email: true, in_app: true }`,
 * which is exactly what the previous blanket `true` fallback produced.
 */
export const DEFAULT_CHANNELS: Record<NotifyEventType, { email: boolean; in_app: boolean }> = {
  approval_requested:  { email: true,  in_app: true },
  change_approved:     { email: true,  in_app: true },
  change_rejected:     { email: true,  in_app: true },
  sla_escalated:       { email: true,  in_app: true },
  emergency_submitted: { email: true,  in_app: true },

  change_submitted:    { email: true,  in_app: true },
  change_implemented:  { email: true,  in_app: true },
  change_verified:     { email: true,  in_app: true },
  assignee_added:      { email: true,  in_app: true },
  retro_approved:      { email: true,  in_app: true },
  retro_rejected:      { email: true,  in_app: true },
  retro_overdue:       { email: true,  in_app: true },
  approver_nudge:      { email: true,  in_app: true },

  change_closed:       { email: false, in_app: true },
  change_reopened:     { email: false, in_app: true },
  change_cancelled:    { email: false, in_app: true },
  change_rescheduled:  { email: false, in_app: true },
  assignee_removed:    { email: false, in_app: true },
}

export const CHAT_BROADCAST_TYPES: NotifyEventType[] = [
  "emergency_submitted", "sla_escalated", "change_approved", "change_rejected",
  "change_implemented", "change_verified",
]

export function notificationContent(
  type: NotifyEventType, changeTitle: string, ctx: NotifyContext, locale: Language
): { title: string; body: string } {
  if (locale === "fr") {
    switch (type) {
      case "change_submitted":
        return { title: "Demande soumise", body: `Votre demande « ${changeTitle} » a été soumise pour approbation.` }
      case "change_implemented":
        return { title: "Changement mis en œuvre", body: `${ctx.actorName ?? "Quelqu'un"} a marqué « ${changeTitle} » comme mis en œuvre.` }
      case "change_verified":
        return { title: "Changement vérifié", body: `« ${changeTitle} » a été vérifié${ctx.outcome ? ` (${ctx.outcome})` : ""}.` }
      case "change_closed":
        return { title: "Changement clôturé", body: `« ${changeTitle} » a été clôturé.` }
      case "change_reopened":
        return { title: "Changement rouvert", body: `« ${changeTitle} » a été rouvert et repasse en brouillon.` }
      case "change_cancelled":
        return { title: "Changement annulé", body: `« ${changeTitle} » a été annulé.` }
      case "change_rescheduled":
        return { title: "Changement replanifié", body: `« ${changeTitle} » a été replanifié${ctx.windowFrom ? ` de ${ctx.windowFrom}` : ""}${ctx.windowTo ? ` à ${ctx.windowTo}` : ""}.` }
      case "assignee_added":
        return { title: "Vous avez été désigné", body: `Vous avez été désigné ${ctx.role ?? "intervenant"} sur « ${changeTitle} ».` }
      case "assignee_removed":
        return { title: "Désignation retirée", body: `Vous n'êtes plus ${ctx.role ?? "intervenant"} sur « ${changeTitle} ».` }
      case "retro_approved":
        return { title: "Approbation rétrospective", body: `« ${changeTitle} » a reçu son approbation rétrospective.` }
      case "retro_rejected":
        return { title: "Approbation rétrospective refusée", body: `L'approbation rétrospective de « ${changeTitle} » a été refusée.` }
      case "retro_overdue":
        return { title: "Approbation rétrospective en retard", body: `« ${changeTitle} » attend toujours son approbation rétrospective${ctx.dueAt ? ` (échéance ${ctx.dueAt})` : ""}.` }
      case "approver_nudge":
        return { title: "Approbation en attente", body: `« ${changeTitle} » attend toujours votre approbation.` }
      case "approval_requested":
        return { title: "Approbation requise", body: `« ${changeTitle} » nécessite votre approbation.` }
      case "change_approved":
        return { title: "Changement approuvé", body: `« ${changeTitle} » a été approuvé.` }
      case "change_rejected":
        return { title: "Changement rejeté", body: `« ${changeTitle} » a été rejeté.` }
      case "sla_escalated":
        return { title: "SLA dépassé", body: `« ${changeTitle} » a dépassé son SLA (niveau ${ctx.level ?? 1}).` }
      case "emergency_submitted":
        return { title: "Changement d'urgence", body: `${ctx.requesterName ?? "Quelqu'un"} a soumis le changement d'urgence « ${changeTitle} ».` }
    }
  }
  switch (type) {
    case "change_submitted":
      return { title: "Request submitted", body: `Your request "${changeTitle}" has been submitted for approval.` }
    case "change_implemented":
      return { title: "Change implemented", body: `${ctx.actorName ?? "Someone"} marked "${changeTitle}" as implemented.` }
    case "change_verified":
      return { title: "Change verified", body: `"${changeTitle}" was verified${ctx.outcome ? ` (${ctx.outcome})` : ""}.` }
    case "change_closed":
      return { title: "Change closed", body: `"${changeTitle}" was closed.` }
    case "change_reopened":
      return { title: "Change reopened", body: `"${changeTitle}" was reopened and is back in draft.` }
    case "change_cancelled":
      return { title: "Change cancelled", body: `"${changeTitle}" was cancelled.` }
    case "change_rescheduled":
      return { title: "Change rescheduled", body: `"${changeTitle}" was rescheduled${ctx.windowFrom ? ` from ${ctx.windowFrom}` : ""}${ctx.windowTo ? ` to ${ctx.windowTo}` : ""}.` }
    case "assignee_added":
      return { title: "You were assigned", body: `You were named ${ctx.role ?? "an assignee"} on "${changeTitle}".` }
    case "assignee_removed":
      return { title: "Assignment removed", body: `You are no longer ${ctx.role ?? "an assignee"} on "${changeTitle}".` }
    case "retro_approved":
      return { title: "Retrospective approval recorded", body: `"${changeTitle}" received its retrospective approval.` }
    case "retro_rejected":
      return { title: "Retrospective approval rejected", body: `The retrospective approval for "${changeTitle}" was rejected.` }
    case "retro_overdue":
      return { title: "Retrospective approval overdue", body: `"${changeTitle}" is still awaiting retrospective approval${ctx.dueAt ? ` (due ${ctx.dueAt})` : ""}.` }
    case "approver_nudge":
      return { title: "Approval still pending", body: `"${changeTitle}" is still waiting for your approval.` }
    case "approval_requested":
      return { title: "Approval requested", body: `"${changeTitle}" needs your approval.` }
    case "change_approved":
      return { title: "Change approved", body: `"${changeTitle}" was approved.` }
    case "change_rejected":
      return { title: "Change rejected", body: `"${changeTitle}" was rejected.` }
    case "sla_escalated":
      return { title: "SLA breached", body: `"${changeTitle}" breached its SLA (level ${ctx.level ?? 1}).` }
    case "emergency_submitted":
      return { title: "Emergency change", body: `${ctx.requesterName ?? "Someone"} submitted emergency change "${changeTitle}".` }
  }
}

export function isChannelEnabled(
  prefs: Map<string, boolean>, userId: string, type: NotifyEventType, channel: NotifyChannel
): boolean {
  const key = `${userId}:${type}:${channel}`
  if (prefs.has(key)) return prefs.get(key)!
  return DEFAULT_CHANNELS[type][channel]
}

export function chatMessageText(type: NotifyEventType, changeTitle: string, ctx: NotifyContext, locale: Language): string {
  if (locale === "fr") {
    switch (type) {
      case "emergency_submitted": return `🚨 Changement d'urgence soumis : « ${changeTitle} »`
      case "sla_escalated": return `⏰ SLA dépassé (niveau ${ctx.level ?? 1}) : « ${changeTitle} »`
      case "change_approved": return `✅ Changement approuvé : « ${changeTitle} »`
      case "change_rejected": return `❌ Changement rejeté : « ${changeTitle} »`
      case "change_implemented": return `🚀 Changement mis en œuvre : « ${changeTitle} »`
      case "change_verified": return `🔎 Changement vérifié : « ${changeTitle} »`
      case "approval_requested": return `📋 Approbation requise : « ${changeTitle} »`
      // Types outside CHAT_BROADCAST_TYPES never reach a webhook; this keeps the
      // switch total without eleven dead arms.
      default: return `« ${changeTitle} »`
    }
  }
  switch (type) {
    case "emergency_submitted": return `🚨 Emergency change submitted: "${changeTitle}"`
    case "sla_escalated": return `⏰ SLA breached (level ${ctx.level ?? 1}): "${changeTitle}"`
    case "change_approved": return `✅ Change approved: "${changeTitle}"`
    case "change_rejected": return `❌ Change rejected: "${changeTitle}"`
    case "change_implemented": return `🚀 Change implemented: "${changeTitle}"`
    case "change_verified": return `🔎 Change verified: "${changeTitle}"`
    case "approval_requested": return `📋 Approval requested: "${changeTitle}"`
    default: return `"${changeTitle}"`
  }
}
