"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import { OPCO_NAMES } from "@/lib/opco"
import type { OpCoSlug } from "@/lib/opco"
import { createChange, updateChange, submitChange } from "@/server/actions/changes"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/toaster"
import DocumentSection from "@/components/document-section"
import { REQUIRED_DOC_KINDS } from "@/lib/attachment-kinds"
import { isGroupLevelInfra } from "@/lib/approver-routing"
import type { AttachmentKind } from "@prisma/client"

type Approver = { name: string | null; email: string }

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

type MyRequest = { id: string; title: string; status: string; updatedAt: string }

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

type AttachmentSlot = { id: string; kind: string; filename: string }

interface Props {
  opcoOptions: string[]
  myRequests?: MyRequest[]
  mode?: "create" | "edit"
  initial?: Initial
  defaultEmail?: string
  attachments?: AttachmentSlot[]
  groupCtos?: Approver[]
  approversByOpco?: Record<string, Approver[]>
}

function formatRelativeDate(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays === 0) return "Today"
  if (diffDays === 1) return "Yesterday"
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-zinc-100 text-zinc-600",
  pending: "bg-amber-100 text-amber-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  implemented: "bg-blue-100 text-blue-700",
  verified: "bg-purple-100 text-purple-700",
  closed: "bg-gray-100 text-gray-500",
}

export default function RequestForm({ opcoOptions, myRequests, mode = "create", initial, defaultEmail, attachments = [], groupCtos = [], approversByOpco = {} }: Props) {
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
  const [isSaving, setIsSaving] = useState(false)

  // The change id, once persisted. Set on first save so retries update rather than re-create.
  const [persistedId, setPersistedId] = useState<string | null>(initial?.id ?? null)
  // Files chosen this session but not yet uploaded (uploaded on save).
  const [stagedFiles, setStagedFiles] = useState<Partial<Record<AttachmentKind, File>>>({})
  // Filenames already uploaded for each slot (seeded from props, updated after each upload).
  const [uploadedByKind, setUploadedByKind] = useState<Partial<Record<AttachmentKind, string>>>(
    () => Object.fromEntries(attachments.map((a) => [a.kind, a.filename]))
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

  // Live approver routing preview based on infra type + selected OpCo.
  const groupCtoNames = groupCtos.map((c) => c.name ?? c.email)
  const residentNames = (approversByOpco[opcoSlug] ?? []).map((a) => a.name ?? a.email)

  const isEmergency = riskLevel === "emergency"

  async function save({ submit }: { submit: boolean }) {
    if (!title || !description || !email || !infrastructureType || !opcoSlug) {
      toast({
        title: t(language, "requests.toast.missing"),
        description: t(language, "requests.toast.missingDesc"),
        variant: "error",
      })
      return
    }
    if (submit) {
      const missingDocs = REQUIRED_DOC_KINDS.filter((k) => !stagedFiles[k] && !uploadedByKind[k])
      if (missingDocs.length > 0 || !plannedStart || !plannedEnd) {
        toast({
          title: t(language, "requests.toast.docMissing"),
          description: t(language, "requests.toast.docMissingDesc"),
          variant: "error",
        })
        return
      }
    }
    setIsSaving(true)
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
      } else {
        const created = await createChange(opcoSlug, payload)
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
      setIsSaving(false)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] sm:grid-cols-1">
      <div className="space-y-5">
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
              className="h-10 sm:h-9 w-full rounded-md border border-border bg-white px-3 text-sm"
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
              className="h-10 sm:h-9 w-full rounded-md border border-border bg-white px-3 text-sm"
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
          <Card className="border-emerald-300/70 bg-emerald-50/60">
            <CardHeader>
              <CardTitle className="text-base">{t(language, "requests.approverRouting")}</CardTitle>
              <CardDescription>{t(language, "requests.approverRoutingHint")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              {isGroupLevelInfra(infrastructureType) ? (
                <p>
                  <span className="font-medium">{t(language, "requests.groupCto")}:</span>{" "}
                  {groupCtoNames.length > 0 ? groupCtoNames.join(", ") : t(language, "requests.noApprover")}
                </p>
              ) : (
                <>
                  <p>
                    <span className="font-medium">{t(language, "requests.residentApprovers")}:</span>{" "}
                    {residentNames.length > 0 ? residentNames.join(", ") : t(language, "requests.noApprover")}
                  </p>
                  <p className="text-muted-foreground">
                    <span className="font-medium">{t(language, "requests.secondee")}:</span>{" "}
                    {groupCtoNames.length > 0 ? groupCtoNames.join(", ") : "—"}
                  </p>
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
                className="h-10 sm:h-9 w-full rounded-md border border-border bg-white px-3 text-sm"
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
                hasSummary={Boolean(summary)}
                summaryValue={summary?.value}
                summaryPlaceholder={summary?.placeholder}
                onSummaryChange={summary?.set}
                existingFilename={uploadedByKind[kind]}
                stagedFile={stagedFiles[kind] ?? null}
                onFileChange={(file) =>
                  setStagedFiles((prev) => {
                    const next = { ...prev }
                    if (file) next[kind] = file
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
              onClick={() => save({ submit: false })}
              disabled={isSaving}
              className="w-full sm:w-auto"
            >
              {t(language, "requests.saveDraft")}
            </Button>
            <Button
              onClick={() => void save({ submit: true })}
              disabled={isSaving}
              className="w-full sm:w-auto"
            >
              {t(language, "requests.submitForApproval")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground sm:max-w-[16rem] sm:text-right">{t(language, "requests.submitHint")}</p>
        </div>
      </div>

      <aside className="space-y-6">
        <Card className="border-border/80 bg-card/95">
          <CardHeader>
            <CardTitle className="text-base">{t(language, "requests.myRequests")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {myRequests && myRequests.length > 0 ? (
              myRequests.map((r) => (
                <Link
                  key={r.id}
                  href={`/changes/${r.id}`}
                  className="flex items-start justify-between gap-2 rounded-md p-2 hover:bg-muted/50 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium leading-tight">{r.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{formatRelativeDate(r.updatedAt)}</p>
                  </div>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium capitalize ${STATUS_COLORS[r.status] ?? "bg-zinc-100 text-zinc-600"}`}
                  >
                    {r.status}
                  </span>
                </Link>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">{t(language, "requests.none")}</p>
            )}
          </CardContent>
        </Card>
      </aside>
    </div>
  )
}
