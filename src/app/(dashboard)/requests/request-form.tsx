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
import DocumentUpload from "@/components/document-upload"
import type { AttachmentKind } from "@prisma/client"

const infraTypes = [
  "Equiano Optics",
  "Backbone Transport Network",
  "Metro Transport Network",
  "Wifi",
  "Internal IT Infrastructure",
  "Equiano IP",
  "Backbone IP Network",
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

export default function RequestForm({ opcoOptions, myRequests, mode = "create", initial, defaultEmail, attachments = [] }: Props) {
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

  const changeId = mode === "edit" && initial ? initial.id : null
  const slotByKind = new Map(attachments.map((a) => [a.kind, a]))
  const DOC_SLOTS: { kind: AttachmentKind; labelKey: string }[] = [
    { kind: "impact_scope", labelKey: "requests.impactScope" },
    { kind: "implementation_plan", labelKey: "requests.implementationPlan" },
    { kind: "testing_plan", labelKey: "requests.testingPlan" },
    { kind: "backout_plan", labelKey: "requests.backoutPlan" },
    { kind: "solution_document", labelKey: "requests.solutionDocument" },
  ]
  // Live set of uploaded kinds — seeded from props, updated as widgets upload in-session
  // so the Submit gate doesn't go stale against the static `attachments` prop.
  const [uploadedKinds, setUploadedKinds] = useState<Set<string>>(
    () => new Set(attachments.map((a) => a.kind))
  )

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
      let id: string
      if (mode === "edit" && initial) {
        await updateChange(initial.id, payload)
        id = initial.id
      } else {
        const created = await createChange(opcoSlug, payload)
        id = created.id
      }
      if (submit) await submitChange(id)
      toast({
        title: submit ? t(language, "requests.toast.submitted") : t(language, "requests.toast.savedDraft"),
        variant: "success",
      })
      if (!submit && mode === "create") {
        router.push(`/changes/${id}/edit`)
      } else {
        router.push(`/changes/${id}`)
      }
      router.refresh()
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

        <Card className="border-border/80 bg-card/95">
          <CardHeader>
            <CardTitle className="text-base">{t(language, "requests.impactScope")} — {t(language, "requests.summaryOptional")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              placeholder={t(language, "requests.impactPlaceholder")}
              value={impactScope}
              onChange={(e) => setImpactScope(e.target.value)}
            />
          </CardContent>
        </Card>

        <Card className="border-border/80 bg-card/95">
          <CardHeader>
            <CardTitle className="text-base">{t(language, "requests.implementationPlan")} — {t(language, "requests.summaryOptional")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea value={implementationPlan} onChange={(e) => setImplementationPlan(e.target.value)} />
          </CardContent>
        </Card>

        <Card className="border-border/80 bg-card/95">
          <CardHeader>
            <CardTitle className="text-base">{t(language, "requests.testingPlan")} — {t(language, "requests.summaryOptional")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea value={testingPlan} onChange={(e) => setTestingPlan(e.target.value)} />
          </CardContent>
        </Card>

        <Card className="border-border/80 bg-card/95">
          <CardHeader>
            <CardTitle className="text-base">{t(language, "requests.backoutPlan")} — {t(language, "requests.summaryOptional")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea value={backoutPlan} onChange={(e) => setBackoutPlan(e.target.value)} />
          </CardContent>
        </Card>

        <Card className="border-border/80 bg-card/95">
          <CardHeader>
            <CardTitle className="text-base">{t(language, "detail.field.documents")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5">
            {DOC_SLOTS.map((slot) => {
              const cur = slotByKind.get(slot.kind)
              return (
                <DocumentUpload
                  key={slot.kind}
                  changeId={changeId}
                  kind={slot.kind}
                  label={t(language, slot.labelKey)}
                  current={cur ? { id: cur.id, filename: cur.filename } : undefined}
                  onUploaded={() => setUploadedKinds((prev) => new Set(prev).add(slot.kind))}
                />
              )
            })}
          </CardContent>
        </Card>

        <div className="flex flex-col sm:flex-row items-center gap-3">
          <Button
            variant="outline"
            onClick={() => save({ submit: false })}
            disabled={isSaving}
            className="w-full sm:w-auto"
          >
            {mode === "create" ? t(language, "requests.saveAndContinue") : t(language, "requests.saveDraft")}
          </Button>
          {mode === "edit" && (
            <Button
              onClick={() => {
                const allDocs = ["impact_scope", "implementation_plan", "testing_plan", "backout_plan", "solution_document"]
                  .every((k) => uploadedKinds.has(k))
                if (!allDocs) {
                  toast({
                    title: t(language, "requests.toast.docMissing"),
                    description: t(language, "requests.toast.docMissingDesc"),
                    variant: "error",
                  })
                  return
                }
                void save({ submit: true })
              }}
              disabled={isSaving}
              className="w-full sm:w-auto"
            >
              {t(language, "requests.submitForApproval")}
            </Button>
          )}
          <p className="text-xs text-muted-foreground sm:text-center sm:ml-2">{t(language, "requests.submitHint")}</p>
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
