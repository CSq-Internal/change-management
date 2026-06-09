"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toaster"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import { submitChange, updateChangeStatus } from "@/server/actions/changes"
import { submitApproval } from "@/server/actions/approvals"
import { REQUIRED_DOC_KINDS } from "@/lib/attachment-kinds"
import { StatusPill, RiskPill } from "@/components/change-badges"
import PirForm from "./pir-form"
import AssigneesDialog from "./assignees-dialog"

// ── Serialised types (Dates as ISO strings) ──────────────────────────────────

export type SerializedChange = {
  id: string
  title: string
  description: string
  category: string
  riskLevel: string
  status: string
  isEmergency: boolean
  contactEmail: string
  infrastructureType: string
  changeReason: string | null
  impactScope: string | null
  implementationPlan: string | null
  testingPlan: string | null
  backoutPlan: string | null
  attachments: { id: string; kind: string; filename: string }[]
  changeWindow: string | null
  plannedStart: string | null
  plannedEnd: string | null
  slaDeadline: string | null
  createdAt: string
  updatedAt: string
  opco: { slug: string; name: string }
  requester: { keycloakId: string; name: string | null; email: string }
  approvals: Array<{
    id: string
    approverId: string
    decision: string
    comment: string | null
    isCab: boolean
    decidedAt: string
    approver: { name: string | null; email: string }
  }>
  auditTrail: Array<{
    id: string
    action: string
    fromStatus: string | null
    toStatus: string | null
    note: string | null
    at: string
    actor: { name: string | null; email: string }
  }>
  implementedAt: string | null
  implementer: { name: string | null; email: string } | null
  expedited: boolean
  retroApprovalDueAt: string | null
  retroApprovedAt: string | null
  hasPir: boolean
  assignees: { userId: string; role: string; label: string }[]
}

export type Caps = {
  isRequester: boolean
  canApprove: boolean
  isAdmin: boolean
  isCabMember: boolean
  canExportEvidence: boolean
  canManageAssignees: boolean
  soleApproverIsMe: boolean
}

// Friendly labels for the five required documents (matches the request form).
const DOC_LABEL: Record<string, string> = {
  impact_scope: "Impact & Scope",
  implementation_plan: "Implementation Plan",
  testing_plan: "Testing & Validation",
  backout_plan: "Backout Plan",
  solution_document: "Solution Document",
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value || value === "—") return null
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-2 py-1.5 border-b border-border/50 last:border-0">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  change: SerializedChange
  caps: Caps
  assigneeCandidates: { id: string; label: string }[]
}

export default function ChangeDetailClient({ change, caps, assigneeCandidates }: Props) {
  const { language } = useStore()
  const { toast } = useToast()
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [isActing, setIsActing] = useState(false)
  const [comment, setComment] = useState("")
  const [assigneesOpen, setAssigneesOpen] = useState(false)

  // ── Action gating ─────────────────────────────────────────────────────────
  const awaitingRetro = change.status === "implemented" && change.expedited && !change.retroApprovedAt
  const canDecide = change.status === "pending" || awaitingRetro
  const a = {
    submit: change.status === "draft" && (caps.isRequester || caps.isAdmin),
    edit: change.status === "draft" && (caps.isRequester || caps.isAdmin),
    // pending → normal approval; an expedited emergency awaiting its retrospective
    // approval (implemented, not yet retro-approved) reuses the same approve/reject path.
    approve: canDecide && caps.canApprove && !caps.isRequester,
    reject: canDecide && caps.canApprove && !caps.isRequester,
    // approved → normal implement; an emergency may be implemented straight from
    // pending (expedited), obtaining its approval retrospectively.
    implement:
      (change.status === "approved" || (change.status === "pending" && change.isEmergency)) &&
      (caps.canApprove || caps.isAdmin),
    close: change.status === "verified" && (caps.canApprove || caps.isAdmin),
    reopen: change.status === "rejected" && (caps.isRequester || caps.isAdmin),
  }
  const hasActions = Object.values(a).some(Boolean)

  // ── Handlers ─────────────────────────────────────────────────────────────

  async function handleAction(
    fn: () => Promise<unknown>,
    successTitle: string,
    successDesc: string
  ) {
    setIsActing(true)
    try {
      await fn()
      toast({ title: successTitle, description: successDesc, variant: "success" })
      startTransition(() => router.refresh())
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "An error occurred",
        variant: "error",
      })
    } finally {
      setIsActing(false)
    }
  }

  function handleSubmit() {
    // Pre-validate client-side so a missing-doc/field submit shows a clear reason
    // instead of a masked server 500. The server submitChange remains the backstop.
    const present = new Set(change.attachments.map((d) => d.kind))
    const missingDocs = REQUIRED_DOC_KINDS.filter((k) => !present.has(k)).map((k) => DOC_LABEL[k] ?? k)
    const missingFields = ([
      ["Title", change.title], ["Description", change.description],
      ["Contact email", change.contactEmail], ["Infrastructure type", change.infrastructureType],
      ["Planned start", change.plannedStart], ["Planned end", change.plannedEnd],
    ] as const).filter(([, v]) => v == null || v === "").map(([k]) => k)
    if (missingDocs.length || missingFields.length) {
      const parts: string[] = []
      if (missingDocs.length) parts.push(`document(s): ${missingDocs.join(", ")}`)
      if (missingFields.length) parts.push(`field(s): ${missingFields.join(", ")}`)
      toast({
        title: "Can't submit yet",
        description: `Add the missing ${parts.join(" and ")} before submitting for approval.`,
        variant: "error",
      })
      return
    }
    handleAction(
      () => submitChange(change.id),
      t(language, "detail.toast.submitted"),
      t(language, "detail.toast.submittedDesc")
    )
  }

  function handleApprove() {
    handleAction(
      () => submitApproval(change.id, "approve", comment || undefined, caps.isCabMember),
      t(language, "detail.toast.approved"),
      t(language, "detail.toast.approvedDesc")
    )
  }

  function handleReject() {
    if (!comment.trim()) {
      toast({
        title: "Error",
        description: t(language, "detail.toast.commentRequired"),
        variant: "error",
      })
      return
    }
    handleAction(
      () => submitApproval(change.id, "reject", comment, caps.isCabMember),
      t(language, "detail.toast.rejected"),
      t(language, "detail.toast.rejectedDesc")
    )
  }

  function handleStatusChange(toStatus: "implemented" | "closed" | "draft") {
    // Implementer SoD: the sole approver can't also implement. Warn before the server
    // round-trip (which would otherwise surface as a masked 500). Server stays authoritative.
    if (toStatus === "implemented" && caps.soleApproverIsMe) {
      toast({
        title: "Can't implement this change",
        description: "You approved it, so a different approver or an admin must implement it (separation of duties).",
        variant: "error",
      })
      return
    }
    const titleKey = `detail.toast.${toStatus}`
    const descKey = `detail.toast.${toStatus}Desc`
    handleAction(
      () => updateChangeStatus(change.id, toStatus),
      t(language, titleKey),
      t(language, descKey)
    )
  }

  // ── CAB quorum ───────────────────────────────────────────────────────────
  const needsCab = change.riskLevel === "high" || change.riskLevel === "emergency"
  const cabCount = new Set(
    change.approvals
      .filter((a) => a.isCab && a.decision === "approve")
      .map((a) => a.approverId)
  ).size

  const requesterLabel = change.requester.name ?? change.requester.email

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      {/* ── LEFT: Detail + Timeline ──────────────────────────────────────── */}
      <div className="space-y-6">
        {/* Header card */}
        <Card className="border-border/80 bg-card/95">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <CardTitle className="text-xl leading-snug">{change.title}</CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                {change.isEmergency && (
                  <span className="inline-flex items-center rounded-full bg-rose-600 px-2.5 py-0.5 text-xs font-semibold text-white">
                    {t(language, "detail.emergency")}
                  </span>
                )}
                <StatusPill status={change.status} />
                {caps.canExportEvidence && (
                  <a
                    href={`/api/changes/${change.id}/evidence.pdf`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center rounded-md border border-border px-2.5 py-0.5 text-xs font-medium text-foreground hover:bg-muted"
                  >
                    {t(language, "detail.exportEvidence")}
                  </a>
                )}
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{change.opco.name}</span>
              <span>•</span>
              <RiskPill risk={change.riskLevel} />
              <span>•</span>
              <span className="capitalize">{change.category}</span>
            </div>
          </CardHeader>
        </Card>

        {/* Overview card */}
        <Card className="border-border/80 bg-card/95">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t(language, "detail.overview")}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed mb-4">{change.description}</p>
            <dl>
              <DetailRow label={t(language, "detail.field.requester")} value={requesterLabel} />
              {change.implementer && (
                <DetailRow
                  label={t(language, "detail.implementedBy")}
                  value={change.implementer.name ?? change.implementer.email}
                />
              )}
              <DetailRow label={t(language, "detail.field.contactEmail")} value={change.contactEmail} />
              <DetailRow label={t(language, "detail.field.infraType")} value={change.infrastructureType} />
              <DetailRow label={t(language, "detail.field.impactScope")} value={change.impactScope} />
              <DetailRow label={t(language, "detail.field.changeReason")} value={change.changeReason} />
              <DetailRow label={t(language, "detail.field.changeWindow")} value={change.changeWindow} />
              <DetailRow label={t(language, "detail.field.plannedStart")} value={fmt(change.plannedStart)} />
              <DetailRow label={t(language, "detail.field.plannedEnd")} value={fmt(change.plannedEnd)} />
              <DetailRow label={t(language, "detail.field.slaDeadline")} value={fmt(change.slaDeadline)} />
              <DetailRow label={t(language, "detail.field.createdAt")} value={fmt(change.createdAt)} />
              <DetailRow label={t(language, "detail.field.updatedAt")} value={fmt(change.updatedAt)} />
              <DetailRow label={t(language, "detail.field.implementationPlan")} value={change.implementationPlan} />
              <DetailRow label={t(language, "detail.field.testingPlan")} value={change.testingPlan} />
              <DetailRow label={t(language, "detail.field.backoutPlan")} value={change.backoutPlan} />
            </dl>
              <div className="mt-4">
                <p className="text-sm font-medium mb-2">{t(language, "detail.field.documents")}</p>
                {change.attachments.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t(language, "detail.documents.none")}</p>
                ) : (
                  <ul className="space-y-1">
                    {change.attachments.map((a) => (
                      <li key={a.id}>
                        <a
                          className="text-sm text-primary underline"
                          href={`/api/changes/${change.id}/documents/${a.id}`}
                        >
                          {a.filename} — {t(language, "detail.documents.download")}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
          </CardContent>
        </Card>

        {/* Timeline card */}
        <Card className="border-border/80 bg-card/95">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t(language, "detail.timeline")}</CardTitle>
          </CardHeader>
          <CardContent>
            {change.auditTrail.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t(language, "detail.noTimeline")}</p>
            ) : (
              <ol className="space-y-3">
                {change.auditTrail.map((log) => (
                  <li key={log.id} className="flex gap-3">
                    <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-border" />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5 text-sm">
                        <span className="font-medium capitalize">{log.action.replace(/_/g, " ")}</span>
                        {log.fromStatus && log.toStatus && (
                          <span className="text-muted-foreground text-xs">
                            <StatusPill status={log.fromStatus} />
                            {" → "}
                            <StatusPill status={log.toStatus} />
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {log.actor.name ?? log.actor.email} · {fmt(log.at)}
                      </div>
                      {log.note && (
                        <p className="mt-1 text-xs text-muted-foreground italic">{log.note}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── RIGHT: Sticky action rail ────────────────────────────────────── */}
      <aside className="lg:sticky lg:top-24 self-start space-y-4">
        {/* Status summary */}
        <Card className="border-border/80 bg-card/95">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-medium uppercase tracking-wide">
              {t(language, "detail.status")}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <StatusPill status={change.status} />
            {change.expedited && !change.retroApprovedAt && change.retroApprovalDueAt && (
              <div className="mt-2">
                <span className="rounded-md bg-rose-100 px-2 py-1 text-xs text-rose-700 dark:bg-rose-950 dark:text-rose-300">
                  {t(language, "detail.retroDue")}: {new Date(change.retroApprovalDueAt).toLocaleString()}
                </span>
              </div>
            )}
            {needsCab && (
              <div className="mt-3 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{t(language, "detail.cabQuorum")}: </span>
                {cabCount}/2
              </div>
            )}
          </CardContent>
        </Card>

        {/* Assignees */}
        <Card className="border-border/80 bg-card/95">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">{t(language, "assignees.implementers")}</CardTitle>
              {caps.canManageAssignees && (
                <button className="text-xs text-primary hover:underline" onClick={() => setAssigneesOpen(true)}>{t(language, "assignees.manage")}</button>
              )}
            </div>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            {change.assignees.filter((a) => a.role === "implementer").map((a) => (<div key={a.userId}>{a.label}</div>))}
            {change.assignees.filter((a) => a.role === "implementer").length === 0 && <span className="text-muted-foreground">{t(language, "assignees.none")}</span>}
          </CardContent>
        </Card>
        <Card className="border-border/80 bg-card/95">
          <CardHeader className="pb-2"><CardTitle className="text-sm">{t(language, "assignees.approvers")}</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            {change.assignees.filter((a) => a.role === "approver").map((a) => (<div key={a.userId}>{a.label}</div>))}
            {change.assignees.filter((a) => a.role === "approver").length === 0 && <span className="text-muted-foreground">{t(language, "assignees.none")}</span>}
          </CardContent>
        </Card>
        {assigneesOpen && (
          <AssigneesDialog
            changeId={change.id}
            candidates={assigneeCandidates}
            current={change.assignees.map((a) => ({ userId: a.userId, role: a.role as "approver" | "implementer" }))}
            onClose={() => setAssigneesOpen(false)}
          />
        )}

        {/* Approvals */}
        {change.approvals.length > 0 && (
          <Card className="border-border/80 bg-card/95">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground font-medium uppercase tracking-wide">
                {t(language, "detail.approvals")}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-3">
              {change.approvals.map((ap) => (
                <div key={ap.id} className="rounded-lg border border-border/50 bg-muted/50 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium truncate">
                      {ap.approver.name ?? ap.approver.email}
                    </span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                        ap.decision === "approve"
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                          : "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300"
                      }`}
                    >
                      {ap.decision}
                    </span>
                  </div>
                  {ap.comment && (
                    <p className="mt-1 text-xs text-muted-foreground">{ap.comment}</p>
                  )}
                  {ap.isCab && (
                    <span className="mt-1 inline-block text-xs font-medium text-violet-600 dark:text-violet-400">
                      CAB
                    </span>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Actions */}
        <Card className="border-border/80 bg-card/95">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-medium uppercase tracking-wide">
              {t(language, "detail.actions")}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            {!hasActions && (
              <p className="text-sm text-muted-foreground">{t(language, "detail.noActions")}</p>
            )}

            {(a.approve || a.reject) && (
              <textarea
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                rows={2}
                placeholder={t(language, "detail.commentPlaceholder")}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
            )}

            {a.submit && (
              <Button
                className="w-full"
                variant="default"
                disabled={isPending || isActing}
                onClick={handleSubmit}
              >
                {t(language, "detail.submit")}
              </Button>
            )}

            {a.edit && (
              <Link
                href={`/changes/${change.id}/edit`}
                className="inline-flex w-full items-center justify-center rounded-md border border-border px-5 py-0 text-sm font-medium text-foreground transition-colors hover:bg-muted h-11 sm:h-10"
              >
                {t(language, "detail.edit")}
              </Link>
            )}

            {a.approve && (
              <Button
                className="w-full"
                variant="default"
                disabled={isPending || isActing}
                onClick={handleApprove}
              >
                {t(language, "detail.approve")}
              </Button>
            )}

            {a.reject && (
              <Button
                className="w-full"
                variant="destructive"
                disabled={isPending || isActing}
                onClick={handleReject}
              >
                {t(language, "detail.reject")}
              </Button>
            )}

            {a.implement && (
              <Button
                className="w-full"
                variant="outline"
                disabled={isPending || isActing}
                onClick={() => handleStatusChange("implemented")}
              >
                {t(language, "detail.implement")}
              </Button>
            )}

            {change.status === "implemented" && (caps.canApprove || caps.isAdmin) && !change.hasPir && (
              <PirForm changeId={change.id} />
            )}

            {a.close && (
              <Button
                className="w-full"
                variant="outline"
                disabled={isPending || isActing}
                onClick={() => handleStatusChange("closed")}
              >
                {t(language, "detail.close")}
              </Button>
            )}

            {a.reopen && (
              <Button
                className="w-full"
                variant="outline"
                disabled={isPending || isActing}
                onClick={() => handleStatusChange("draft")}
              >
                {t(language, "detail.reopen")}
              </Button>
            )}
          </CardContent>
        </Card>
      </aside>
    </div>
  )
}
