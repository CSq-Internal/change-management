// src/lib/notifications.ts
// Pure notification copy + preference lookup. No DB. Unit-tested.

import type { Language } from "@/lib/i18n"

export type NotifyEventType =
  | "approval_requested" | "change_approved" | "change_rejected"
  | "sla_escalated" | "emergency_submitted"

export type NotifyChannel = "email" | "in_app"

export type NotifyContext = { requesterName?: string; newStatus?: string; level?: number; riskLevel?: string }

export const NOTIFY_EVENT_TYPES: NotifyEventType[] = [
  "approval_requested", "change_approved", "change_rejected", "sla_escalated", "emergency_submitted",
]

export const CHAT_BROADCAST_TYPES: NotifyEventType[] = [
  "emergency_submitted", "sla_escalated", "change_approved", "change_rejected",
]

export function notificationContent(
  type: NotifyEventType, changeTitle: string, ctx: NotifyContext, locale: Language
): { title: string; body: string } {
  if (locale === "fr") {
    switch (type) {
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
  return prefs.has(key) ? prefs.get(key)! : true
}

export function chatMessageText(type: NotifyEventType, changeTitle: string, ctx: NotifyContext, locale: Language): string {
  if (locale === "fr") {
    switch (type) {
      case "emergency_submitted": return `🚨 Changement d'urgence soumis : « ${changeTitle} »`
      case "sla_escalated": return `⏰ SLA dépassé (niveau ${ctx.level ?? 1}) : « ${changeTitle} »`
      case "change_approved": return `✅ Changement approuvé : « ${changeTitle} »`
      case "change_rejected": return `❌ Changement rejeté : « ${changeTitle} »`
      case "approval_requested": return `📋 Approbation requise : « ${changeTitle} »`
    }
  }
  switch (type) {
    case "emergency_submitted": return `🚨 Emergency change submitted: "${changeTitle}"`
    case "sla_escalated": return `⏰ SLA breached (level ${ctx.level ?? 1}): "${changeTitle}"`
    case "change_approved": return `✅ Change approved: "${changeTitle}"`
    case "change_rejected": return `❌ Change rejected: "${changeTitle}"`
    case "approval_requested": return `📋 Approval requested: "${changeTitle}"`
  }
}
