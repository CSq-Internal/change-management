"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import { OPCO_NAMES } from "@/lib/opco"
import type { OpCoSlug } from "@/lib/opco"
import { createChange, updateChange, submitChange } from "@/server/actions/changes"
import { listEligibleApproversAction } from "@/server/actions/eligible-approvers"
import { setChangeApprovers } from "@/server/actions/assignees"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/toaster"
import DocumentSection from "@/components/document-section"
import { REQUIRED_DOC_KINDS, documentsRequiredForRisk } from "@/lib/attachment-kinds"
import { isGroupLevelInfra } from "@/lib/approver-routing"
import type { AttachmentKind } from "@prisma/client"

const infraTypes = [
  "Equiano Optics",
  "Backbone Transport Network",
  "Metro Transport Network",
  "Wifi",
  "Internal IT Infrastructure",
  "Equiano IP",
  "Backbone IP Network",
  "Power",
] as const

type Initial = {
  id: string
  title: string
  description: string
  category: string
  riskLevel: string
  contactEmail: string
  infrastructureType: string
  impactScope?: string | null
  implementationPlan?: string | null
  testingPlan?: string | null
  backoutPlan?: string | null
  plannedStart?: string | null
  plannedEnd?: string | null
  opcoSlug: string
}

type AttachmentSlot = { id: string; kind: string; filename: string; externalUrl?: string | null }

interface Props {
  opcoOptions: string[]
  mode?: "create" | "edit"
  initial?: Initial
  defaultEmail?: string
  attachments?: AttachmentSlot[]
  /** Approvers already named on the change (edit mode), so saving does not clear them. */
  initialApproverIds?: string[]
}

export default function RequestForm({ opcoOptions, mode = "create", initial, defaultEmail, attachments = [], initialApproverIds = [] }: Props) {
  const { language } = useStore()
  const router = useRouter()
  const { toast } = useToast()

  const [email, setEmail] = useState(initial?.contactEmail ?? defaultEmail ?? "")
  const [opcoSlug, setOpcoSlug] = useState(initial?.opcoSlug ?? opcoOptions[0] ?? "")
  const [infrastructureType, setInfrastructureType] = useState<(typeof infraTypes)[number] | "">(
    (initial?.infrastructureType as (typeof infraTypes)[number]) ?? ""
  )
  const [title, setTitle] = useState(initial?.title ?? "")
  const [description, setDescription] = useState(initial?.description ?? "")
  const [riskLevel, setRiskLevel] = useState<"low" | "medium" | "high" | "emergency">(
    (initial?.riskLevel as "low" | "medium" | "high" | "emergency") ?? "medium"
  )
  const [category, setCategory] = useState<"config" | "infrastructure" | "software" | "process">(
    (initial?.category as "config" | "infrastructure" | "software" | "process") ?? "software"
  )
  const [plannedStart, setPlannedStart] = useState(initial?.plannedStart ?? "")
  const [plannedEnd, setPlannedEnd] = useState(initial?.plannedEnd ?? "")
  const [impactScope, setImpactScope] = useState(initial?.impactScope ?? "")
  const [implementationPlan, setImplementationPlan] = useState(initial?.implementationPlan ?? "")
  const [testingPlan, setTestingPlan] = useState(initial?.testingPlan ?? "")
  const [backoutPlan, setBackoutPlan] = useState(initial?.backoutPlan ?? "")
  // Requester-nominated approvers, and the candidate list they are chosen from.
  const [approverIds, setApproverIds] = useState<string[]>(initialApproverIds)
  const [approversCleared, setApproversCleared] = useState(false)
  const [approverReload, setApproverReload] = useState(0)
  // Result of the last completed load, tagged with the scope it was for; `rows: null` = it failed.
  // Load state is derived from this rather than stored, so the effect never setStates synchronously.
  const [loadedApprovers, setLoadedApprovers] = useState<{
    scope: string
    rows: { id: string; name: string | null; email: string }[] | null
  }>({ scope: "", rows: null })
  // Which action is in flight, so we can spinner the right button and disable both.
  const [savingAction, setSavingAction] = useState<"draft" | "submit" | null>(null)
  const isSaving = savingAction !== null

  // The change id, once persisted. Set on first save so retries update rather than re-create.
  const [persistedId, setPersistedId] = useState<string | null>(initial?.id ?? null)
  // Files chosen this session but not yet uploaded (uploaded on save).
  const [stagedFiles, setStagedFiles] = useState<Partial<Record<AttachmentKind, File>>>({})
  // Filenames already uploaded for each slot (seeded from props, updated after each upload).
  const [uploadedByKind, setUploadedByKind] = useState<Partial<Record<AttachmentKind, string>>>(
    () => Object.fromEntries(attachments.map((a) => [a.kind, a.filename]))
  )
  // Links entered this session but not yet saved (saved on submit).
  const [stagedLinks, setStagedLinks] = useState<Partial<Record<AttachmentKind, string>>>({})
  // Links already saved for each slot (seeded from props, updated after each save).
  const [linkedByKind, setLinkedByKind] = useState<Partial<Record<AttachmentKind, string>>>(
    () => Object.fromEntries(
      attachments.filter((a) => a.externalUrl).map((a) => [a.kind, a.externalUrl as string])
    )
  )

  const DOC_LABEL_KEY: Record<AttachmentKind, string> = {
    impact_scope: "requests.impactScope",
    implementation_plan: "requests.implementationPlan",
    testing_plan: "requests.testingPlan",
    backout_plan: "requests.backoutPlan",
    solution_document: "requests.solutionDocument",
  }
  // Per-kind optional summary binding; solution_document has no summary.
  const summaryFor: Partial<Record<AttachmentKind, { value: string; set: (v: string) => void; placeholder?: string }>> = {
    impact_scope: { value: impactScope, set: setImpactScope, placeholder: t(language, "requests.impactPlaceholder") },
    implementation_plan: { value: implementationPlan, set: setImplementationPlan },
    testing_plan: { value: testingPlan, set: setTestingPlan },
    backout_plan: { value: backoutPlan, set: setBackoutPlan },
  }

  // Candidates depend on OpCo + infra type, so they load client-side once both are known.
  // The reload counter is part of the scope so Retry re-runs the query.
  const approverScope = infrastructureType && opcoSlug
    ? `${opcoSlug}|${infrastructureType}|${approverReload}`
    : ""
  const approverLoad: "idle" | "loading" | "error" | "ready" = !approverScope
    ? "idle"
    : loadedApprovers.scope !== approverScope
      ? "loading"
      : loadedApprovers.rows
        ? "ready"
        : "error"
  const eligible = approverLoad === "ready" ? loadedApprovers.rows ?? [] : []

  // Changing infra type re-queries and drops any selection that no longer applies.
  useEffect(() => {
    if (!approverScope) return
    let cancelled = false
    listEligibleApproversAction(opcoSlug, infrastructureType)
      .then((rows) => {
        if (cancelled) return
        setLoadedApprovers({ scope: approverScope, rows })
        setApproverIds((prev) => {
          const allowed = new Set(rows.map((r) => r.id))
          const kept = prev.filter((id) => allowed.has(id))
          setApproversCleared(kept.length < prev.length)
          return kept
        })
      })
      .catch(() => {
        if (cancelled) return
        setLoadedApprovers({ scope: approverScope, rows: null })
      })
    return () => { cancelled = true }
  }, [approverScope, opcoSlug, infrastructureType])

  const isEmergency = riskLevel === "emergency"

  async function save({ submit }: { submit: boolean }) {
    if (isSaving) return // guard against double-submit / button spam
    if (!title || !description || !email || !infrastructureType || !opcoSlug) {
      toast({
        title: t(language, "requests.toast.missing"),
        description: t(language, "requests.toast.missingDesc"),
        variant: "error",
      })
      return
    }
    if (submit) {
      const missingDocs = documentsRequiredForRisk(riskLevel)
        ? REQUIRED_DOC_KINDS.filter(
            (k) => !stagedFiles[k] && !uploadedByKind[k] && !stagedLinks[k] && !linkedByKind[k]
          )
        : []
      if (missingDocs.length > 0 || !plannedStart || !plannedEnd) {
        toast({
          title: t(language, "requests.toast.docMissing"),
          description: t(language, "requests.toast.docMissingDesc"),
          variant: "error",
        })
        return
      }
      if (approverIds.length === 0) {
        toast({
          title: t(language, "requests.toast.approverMissing"),
          description: t(language, "requests.toast.approverMissingDesc"),
          variant: "error",
        })
        return
      }
    }
    setSavingAction(submit ? "submit" : "draft")
    const payload = {
      title,
      description,
      category,
      riskLevel,
      contactEmail: email,
      infrastructureType,
      impactScope: impactScope || undefined,
      implementationPlan: implementationPlan || undefined,
      testingPlan: testingPlan || undefined,
      backoutPlan: backoutPlan || undefined,
      plannedStart: plannedStart ? new Date(plannedStart) : undefined,
      plannedEnd: plannedEnd ? new Date(plannedEnd) : undefined,
      isEmergency,
    }
    try {
      // Persist the change first so uploads have an id to attach to.
      let id = persistedId
      if (id) {
        await updateChange(id, payload)
        // updateChange writes the payload straight to the row, so approvers go through
        // setChangeApprovers — setChangeAssignees would drop the implementers.
        await setChangeApprovers(id, approverIds)
      } else {
        const created = await createChange(opcoSlug, { ...payload, approverIds })
        id = created.id
        setPersistedId(id)
      }

      // Upload any staged files; clear each from staging as it succeeds (idempotent on retry).
      for (const [kind, file] of Object.entries(stagedFiles) as [AttachmentKind, File][]) {
        const form = new FormData()
        form.set("kind", kind)
        form.set("file", file)
        const res = await fetch(`/api/changes/${id}/documents`, { method: "POST", body: form })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error ?? "Upload failed")
        }
        const att = await res.json()
        setUploadedByKind((prev) => ({ ...prev, [kind]: att.filename }))
        setStagedFiles((prev) => {
          const next = { ...prev }
          delete next[kind]
          return next
        })
      }

      // Save any staged links; clear each from staging as it succeeds (idempotent on retry).
      for (const [kind, url] of Object.entries(stagedLinks) as [AttachmentKind, string][]) {
        const res = await fetch(`/api/changes/${id}/documents`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind, url }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error ?? "Link failed")
        }
        const att = await res.json()
        setLinkedByKind((prev) => ({ ...prev, [kind]: att.externalUrl }))
        setStagedLinks((prev) => {
          const next = { ...prev }
          delete next[kind]
          return next
        })
      }

      if (submit) await submitChange(id)
      toast({
        title: submit ? t(language, "requests.toast.submitted") : t(language, "requests.toast.savedDraft"),
        variant: "success",
      })
      // Navigate to the detail page. No router.refresh() here — it would supersede the
      // push to a different route, and the destination fetches fresh data on its own.
      router.push(`/changes/${id}`)
    } catch (err) {
      toast({
        title: t(language, "requests.toast.failed"),
        description: err instanceof Error ? err.message : "Error",
        variant: "error",
      })
    } finally {
      setSavingAction(null)
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="min-w-0 space-y-5">
        <Card className="border-border/80 bg-card/95">
          <CardHeader>
            <CardTitle className="text-2xl sm:text-xl">{t(language, "requests.title")}</CardTitle>
            <CardDescription>
              <span className="text-rose-600">*</span> {t(language, "requests.required")}
            </CardDescription>
          </CardHeader>
        </Card>

        <Card className="border-border/80 bg-card/95">
          <CardHeader>
            <CardTitle className="text-base">
              {t(language, "requests.email")} <span className="text-rose-600">*</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Input placeholder="name@csquared.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </CardContent>
        </Card>

        <Card className="border-border/80 bg-card/95">
          <CardHeader>
            <CardTitle className="text-base">
              {t(language, "requests.opco")} <span className="text-rose-600">*</span>
            </CardTitle>
            <CardDescription>{t(language, "requests.oneOption")}</CardDescription>
          </CardHeader>
          <CardContent>
            <select
              className="h-10 sm:h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground"
              value={opcoSlug}
              onChange={(e) => setOpcoSlug(e.target.value)}
              disabled={mode === "edit"}
            >
              {opcoOptions.map((slug) => (
                <option key={slug} value={slug}>
                  {OPCO_NAMES[slug as OpCoSlug] ?? slug}
                </option>
              ))}
            </select>
          </CardContent>
        </Card>

        <Card className="border-border/80 bg-card/95">
          <CardHeader>
            <CardTitle className="text-base">
              {t(language, "requests.infraType")} <span className="text-rose-600">*</span>
            </CardTitle>
            <CardDescription>{t(language, "requests.oneOption")}</CardDescription>
          </CardHeader>
          <CardContent>
            <select
              className="h-10 sm:h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground"
              value={infrastructureType}
              onChange={(e) => setInfrastructureType(e.target.value as (typeof infraTypes)[number])}
            >
              <option value="" disabled>
                {t(language, "requests.oneOption")}
              </option>
              {infraTypes.map((infra) => (
                <option key={infra} value={infra}>
                  {infra}
                </option>
              ))}
            </select>
          </CardContent>
        </Card>

        {infrastructureType && (
          <Card className="border-emerald-300/70 bg-emerald-50/60 dark:border-emerald-800/50 dark:bg-emerald-950/40">
            <CardHeader>
              <CardTitle className="text-base">
                {t(language, "requests.selectApprovers")} <span className="text-rose-600">*</span>
              </CardTitle>
              <CardDescription>{t(language, "requests.selectApproversHint")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {approverLoad === "loading" && <p className="text-muted-foreground">…</p>}

              {approverLoad === "error" && (
                <div className="space-y-2">
                  <p className="text-rose-600">{t(language, "requests.approversLoadFailed")}</p>
                  <Button variant="outline" onClick={() => setApproverReload((n) => n + 1)}>
                    {t(language, "requests.approversRetry")}
                  </Button>
                </div>
              )}

              {approverLoad === "ready" && eligible.length === 0 && (
                <p className="text-rose-600">
                  {isGroupLevelInfra(infrastructureType)
                    ? t(language, "requests.approversNoneGroup")
                    : t(language, "requests.approversNone")}
                </p>
              )}

              {approverLoad === "ready" && eligible.length > 0 && (
                <>
                  {approversCleared && (
                    <p className="text-amber-700 dark:text-amber-400">
                      {t(language, "requests.approversCleared")}
                    </p>
                  )}
                  {eligible.map((a) => (
                    <label key={a.id} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        aria-label={a.email}
                        checked={approverIds.includes(a.id)}
                        onChange={(e) =>
                          setApproverIds((prev) =>
                            e.target.checked ? [...prev, a.id] : prev.filter((id) => id !== a.id)
                          )
                        }
                      />
                      <span>{a.name ?? a.email}</span>
                      <span className="text-muted-foreground">{a.email}</span>
                    </label>
                  ))}
                </>
              )}
            </CardContent>
          </Card>
        )}

        <Card className="border-border/80 bg-card/95">
          <CardHeader>
            <CardTitle className="text-base">
              {t(language, "requests.changeTitle")} <span className="text-rose-600">*</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Input
              placeholder={t(language, "requests.titlePlaceholder")}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </CardContent>
        </Card>

        <Card className="border-border/80 bg-card/95">
          <CardHeader>
            <CardTitle className="text-base">
              {t(language, "requests.changeDescription")} <span className="text-rose-600">*</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              placeholder={t(language, "requests.descriptionPlaceholder")}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-2 sm:grid-cols-1">
          <Card className="border-border/80 bg-card/95">
            <CardHeader>
              <CardTitle className="text-base">{t(language, "requests.category")}</CardTitle>
            </CardHeader>
            <CardContent>
              <select
                className="h-10 sm:h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground"
                value={category}
                onChange={(e) => setCategory(e.target.value as typeof category)}
              >
                <option value="config">{t(language, "requests.category.config")}</option>
                <option value="infrastructure">{t(language, "requests.category.infrastructure")}</option>
                <option value="software">{t(language, "requests.category.software")}</option>
                <option value="process">{t(language, "requests.category.process")}</option>
              </select>
            </CardContent>
          </Card>
          <Card className="border-border/80 bg-card/95">
            <CardHeader>
              <CardTitle className="text-base">{t(language, "requests.riskLevel")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm text-foreground">
              {(["low", "medium", "high", "emergency"] as const).map((level) => (
                <label key={level} className="flex items-center gap-3 capitalize">
                  <input type="radio" name="risk" checked={riskLevel === level} onChange={() => setRiskLevel(level)} />
                  {t(language, `requests.risk.${level}`)}
                </label>
              ))}
              {isEmergency && (
                <p className="mt-1 text-xs text-amber-600">{t(language, "requests.emergencyWarn")}</p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 md:grid-cols-2 sm:grid-cols-1">
          <Card className="border-border/80 bg-card/95">
            <CardHeader>
              <CardTitle className="text-base">{t(language, "requests.plannedStart")}</CardTitle>
            </CardHeader>
            <CardContent>
              <Input type="datetime-local" value={plannedStart ?? ""} onChange={(e) => setPlannedStart(e.target.value)} />
            </CardContent>
          </Card>
          <Card className="border-border/80 bg-card/95">
            <CardHeader>
              <CardTitle className="text-base">{t(language, "requests.plannedEnd")}</CardTitle>
            </CardHeader>
            <CardContent>
              <Input type="datetime-local" value={plannedEnd ?? ""} onChange={(e) => setPlannedEnd(e.target.value)} />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          {REQUIRED_DOC_KINDS.map((kind) => {
            const summary = summaryFor[kind]
            return (
              <DocumentSection
                key={kind}
                kind={kind}
                label={t(language, DOC_LABEL_KEY[kind])}
                required={documentsRequiredForRisk(riskLevel)}
                hasSummary={Boolean(summary)}
                summaryValue={summary?.value}
                summaryPlaceholder={summary?.placeholder}
                onSummaryChange={summary?.set}
                existingFilename={uploadedByKind[kind]}
                existingLink={linkedByKind[kind]}
                stagedFile={stagedFiles[kind] ?? null}
                stagedLink={stagedLinks[kind] ?? null}
                onFileChange={(file) =>
                  setStagedFiles((prev) => {
                    const next = { ...prev }
                    if (file) next[kind] = file
                    else delete next[kind]
                    return next
                  })
                }
                onLinkChange={(url) =>
                  setStagedLinks((prev) => {
                    const next = { ...prev }
                    if (url) next[kind] = url
                    else delete next[kind]
                    return next
                  })
                }
              />
            )
          })}
        </div>

        <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              variant="outline"
              onClick={() => void save({ submit: false })}
              disabled={isSaving}
              className="w-full sm:w-auto"
            >
              {savingAction === "draft" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t(language, savingAction === "draft" ? "requests.savingDraft" : "requests.saveDraft")}
            </Button>
            <Button
              onClick={() => void save({ submit: true })}
              disabled={isSaving || approverIds.length === 0}
              className="w-full sm:w-auto"
            >
              {savingAction === "submit" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t(language, savingAction === "submit" ? "requests.submitting" : "requests.submitForApproval")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground sm:max-w-[16rem] sm:text-right">{t(language, "requests.submitHint")}</p>
        </div>
      </div>
    </div>
  )
}
