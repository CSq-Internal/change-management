"use client"

import { useState } from "react"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/toaster"

const countries = ["Uganda", "DRC", "Ghana", "Togo", "Liberia", "Mauritius"] as const
const infraTypes = [
  "Equiano Optics",
  "Backbone Transport Network",
  "Metro Transport Network",
  "Wifi",
  "Internal IT Infrastructure",
  "Equiano IP",
  "Backbone IP Network",
] as const

export default function Requests() {
  const { changes, add, currentUser, language } = useStore()
  const { toast } = useToast()
  const [email, setEmail] = useState("")
  const [country, setCountry] = useState<(typeof countries)[number] | "">("")
  const [infrastructureType, setInfrastructureType] = useState<(typeof infraTypes)[number] | "">("")
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [riskLevel, setRiskLevel] = useState<"low" | "medium" | "high">("medium")
  const [category, setCategory] = useState<"config" | "infrastructure" | "software" | "process">("software")
  const [plannedStart, setPlannedStart] = useState("")
  const [plannedEnd, setPlannedEnd] = useState("")
  const [impactScope, setImpactScope] = useState("")
  const [implementationPlan, setImplementationPlan] = useState("")
  const [testingPlan, setTestingPlan] = useState("")
  const [backoutPlan, setBackoutPlan] = useState("")
  const [approvers, setApprovers] = useState("")

  const myRequests = currentUser ? changes.filter((c) => c.requester === currentUser.id) : []

  const submit = () => {
    if (!title || !description || !email || !country || !infrastructureType) {
      toast({
        title: t(language, "requests.toast.missing"),
        description: t(language, "requests.toast.missingDesc"),
        variant: "error",
      })
      return
    }
    if (!currentUser) {
      toast({
        title: t(language, "requests.toast.signIn"),
        description: t(language, "requests.toast.signInDesc"),
        variant: "error",
      })
      return
    }
    add({
      title,
      description,
      requester: currentUser.id,
      assignees: approvers
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean),
      riskLevel,
      status: "pending",
      category,
      plannedStart: plannedStart || undefined,
      plannedEnd: plannedEnd || undefined,
      backoutPlan: backoutPlan || undefined,
      details: {
        email,
        country,
        infrastructureType,
        impactScope,
        implementationPlan,
        testingPlan,
      },
    })
    toast({
      title: t(language, "requests.toast.submitted"),
      description: t(language, "requests.toast.submittedDesc"),
      variant: "success",
    })
    setTitle("")
    setDescription("")
    setEmail("")
    setCountry("")
    setInfrastructureType("")
    setPlannedStart("")
    setPlannedEnd("")
    setImpactScope("")
    setImplementationPlan("")
    setTestingPlan("")
    setBackoutPlan("")
    setApprovers("")
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
              {t(language, "requests.country")} <span className="text-rose-600">*</span>
            </CardTitle>
            <CardDescription>{t(language, "requests.oneOption")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {countries.map((c) => (
              <label key={c} className="flex items-center gap-3 text-sm text-foreground">
                <input type="radio" name="country" checked={country === c} onChange={() => setCountry(c)} />
                {c}
              </label>
            ))}
          </CardContent>
        </Card>

        <Card className="border-border/80 bg-card/95">
          <CardHeader>
            <CardTitle className="text-base">
              {t(language, "requests.infraType")} <span className="text-rose-600">*</span>
            </CardTitle>
            <CardDescription>{t(language, "requests.oneOption")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {infraTypes.map((infra) => (
              <label key={infra} className="flex items-center gap-3 text-sm text-foreground">
                <input
                  type="radio"
                  name="infra"
                  checked={infrastructureType === infra}
                  onChange={() => setInfrastructureType(infra)}
                />
                {infra}
              </label>
            ))}
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
              {( ["low", "medium", "high"] as const).map((level) => (
                <label key={level} className="flex items-center gap-3 capitalize">
                  <input type="radio" name="risk" checked={riskLevel === level} onChange={() => setRiskLevel(level)} />
                  {t(language, `requests.risk.${level}`)}
                </label>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 md:grid-cols-2 sm:grid-cols-1">
          <Card className="border-border/80 bg-card/95">
            <CardHeader>
              <CardTitle className="text-base">{t(language, "requests.plannedStart")}</CardTitle>
            </CardHeader>
            <CardContent>
              <Input type="datetime-local" value={plannedStart} onChange={(e) => setPlannedStart(e.target.value)} />
            </CardContent>
          </Card>
          <Card className="border-border/80 bg-card/95">
            <CardHeader>
              <CardTitle className="text-base">{t(language, "requests.plannedEnd")}</CardTitle>
            </CardHeader>
            <CardContent>
              <Input type="datetime-local" value={plannedEnd} onChange={(e) => setPlannedEnd(e.target.value)} />
            </CardContent>
          </Card>
        </div>

        <Card className="border-border/80 bg-card/95">
          <CardHeader>
            <CardTitle className="text-base">{t(language, "requests.impactScope")}</CardTitle>
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
            <CardTitle className="text-base">{t(language, "requests.implementationPlan")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea value={implementationPlan} onChange={(e) => setImplementationPlan(e.target.value)} />
          </CardContent>
        </Card>

        <Card className="border-border/80 bg-card/95">
          <CardHeader>
            <CardTitle className="text-base">{t(language, "requests.testingPlan")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea value={testingPlan} onChange={(e) => setTestingPlan(e.target.value)} />
          </CardContent>
        </Card>

        <Card className="border-border/80 bg-card/95">
          <CardHeader>
            <CardTitle className="text-base">{t(language, "requests.backoutPlan")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea value={backoutPlan} onChange={(e) => setBackoutPlan(e.target.value)} />
          </CardContent>
        </Card>

        <Card className="border-border/80 bg-card/95">
          <CardHeader>
            <CardTitle className="text-base">{t(language, "requests.approvers")}</CardTitle>
            <CardDescription>{t(language, "requests.approversHint")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Input
              value={approvers}
              onChange={(e) => setApprovers(e.target.value)}
              placeholder={t(language, "requests.approversPlaceholder")}
            />
          </CardContent>
        </Card>

        <div className="flex flex-col sm:flex-row items-center gap-3">
          <Button onClick={submit} className="w-full sm:w-auto">{t(language, "requests.submit")}</Button>
          <p className="text-xs text-muted-foreground sm:text-center sm:ml-2">{t(language, "requests.submitHint")}</p>
        </div>
      </div>

      <aside className="space-y-6">
        <Card className="border-border/80 bg-card/95">
          <CardHeader>
            <CardTitle className="text-base">{t(language, "requests.myRequests")}</CardTitle>
            <CardDescription>
              {myRequests.length} {t(language, "requests.totalSubmitted")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {myRequests.length === 0 && <p className="text-sm text-muted-foreground">{t(language, "requests.none")}</p>}
            {myRequests.map((c) => (
              <div key={c.id} className="rounded-xl border border-border/70 bg-muted px-3 sm:px-4 py-3">
                <div className="text-sm font-medium line-clamp-2 sm:line-clamp-1">{c.title}</div>
                <div className="text-xs text-muted-foreground">
                  {c.status} • {new Date(c.createdAt).toLocaleString()}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </aside>
    </div>
  )
}
