"use client"

import { useState } from "react"
import { useStore } from "@/lib/store"
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
  const { changes, add, currentUser } = useStore()
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
        title: "Missing required fields",
        description: "Email, country, infrastructure type, title, and description are required.",
        variant: "error",
      })
      return
    }
    if (!currentUser) {
      toast({
        title: "Sign in required",
        description: "Please log in to submit a change request.",
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
      title: "Request submitted",
      description: "Your change request is now pending approval.",
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
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="space-y-5">
        <Card className="border-slate-200/80 bg-white/95">
          <CardHeader>
            <CardTitle className="text-2xl">CSquared Technical Change Request</CardTitle>
            <CardDescription>
              <span className="text-rose-600">*</span> indicates required question
            </CardDescription>
          </CardHeader>
        </Card>

        <Card className="border-slate-200/80 bg-white/95">
          <CardHeader>
            <CardTitle className="text-base">
              Email <span className="text-rose-600">*</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Input placeholder="name@csquared.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 bg-white/95">
          <CardHeader>
            <CardTitle className="text-base">
              Country <span className="text-rose-600">*</span>
            </CardTitle>
            <CardDescription>Mark only one oval.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {countries.map((c) => (
              <label key={c} className="flex items-center gap-3 text-sm text-slate-700">
                <input type="radio" name="country" checked={country === c} onChange={() => setCountry(c)} />
                {c}
              </label>
            ))}
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 bg-white/95">
          <CardHeader>
            <CardTitle className="text-base">
              Infrastructure Type <span className="text-rose-600">*</span>
            </CardTitle>
            <CardDescription>Mark only one oval.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {infraTypes.map((infra) => (
              <label key={infra} className="flex items-center gap-3 text-sm text-slate-700">
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

        <Card className="border-slate-200/80 bg-white/95">
          <CardHeader>
            <CardTitle className="text-base">
              Change Title <span className="text-rose-600">*</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Input placeholder="Describe the change at a glance" value={title} onChange={(e) => setTitle(e.target.value)} />
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 bg-white/95">
          <CardHeader>
            <CardTitle className="text-base">
              Change Description <span className="text-rose-600">*</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              placeholder="Provide background, scope, and justification."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-2">
          <Card className="border-slate-200/80 bg-white/95">
            <CardHeader>
              <CardTitle className="text-base">Category</CardTitle>
            </CardHeader>
            <CardContent>
              <select
                className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
                value={category}
                onChange={(e) => setCategory(e.target.value as typeof category)}
              >
                <option value="config">Configuration</option>
                <option value="infrastructure">Infrastructure</option>
                <option value="software">Software</option>
                <option value="process">Process</option>
              </select>
            </CardContent>
          </Card>
          <Card className="border-slate-200/80 bg-white/95">
            <CardHeader>
              <CardTitle className="text-base">Risk Level</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm text-slate-700">
              {(["low", "medium", "high"] as const).map((level) => (
                <label key={level} className="flex items-center gap-3 capitalize">
                  <input type="radio" name="risk" checked={riskLevel === level} onChange={() => setRiskLevel(level)} />
                  {level}
                </label>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card className="border-slate-200/80 bg-white/95">
            <CardHeader>
              <CardTitle className="text-base">Planned Start</CardTitle>
            </CardHeader>
            <CardContent>
              <Input type="datetime-local" value={plannedStart} onChange={(e) => setPlannedStart(e.target.value)} />
            </CardContent>
          </Card>
          <Card className="border-slate-200/80 bg-white/95">
            <CardHeader>
              <CardTitle className="text-base">Planned End</CardTitle>
            </CardHeader>
            <CardContent>
              <Input type="datetime-local" value={plannedEnd} onChange={(e) => setPlannedEnd(e.target.value)} />
            </CardContent>
          </Card>
        </div>

        <Card className="border-slate-200/80 bg-white/95">
          <CardHeader>
            <CardTitle className="text-base">Impact & Scope</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              placeholder="Systems, customers, or services impacted."
              value={impactScope}
              onChange={(e) => setImpactScope(e.target.value)}
            />
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 bg-white/95">
          <CardHeader>
            <CardTitle className="text-base">Implementation Plan</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea value={implementationPlan} onChange={(e) => setImplementationPlan(e.target.value)} />
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 bg-white/95">
          <CardHeader>
            <CardTitle className="text-base">Testing & Validation Plan</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea value={testingPlan} onChange={(e) => setTestingPlan(e.target.value)} />
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 bg-white/95">
          <CardHeader>
            <CardTitle className="text-base">Backout Plan</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea value={backoutPlan} onChange={(e) => setBackoutPlan(e.target.value)} />
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 bg-white/95">
          <CardHeader>
            <CardTitle className="text-base">Approvers</CardTitle>
            <CardDescription>Comma separated identifiers (e.g. jane, ossie).</CardDescription>
          </CardHeader>
          <CardContent>
            <Input value={approvers} onChange={(e) => setApprovers(e.target.value)} placeholder="approver1, approver2" />
          </CardContent>
        </Card>

        <div className="flex items-center gap-3">
          <Button onClick={submit}>Submit Request</Button>
          <p className="text-xs text-slate-500">Requests are routed for approval immediately.</p>
        </div>
      </div>

      <aside className="space-y-6">
        <Card className="border-slate-200/80 bg-white/95">
          <CardHeader>
            <CardTitle className="text-base">My Requests</CardTitle>
            <CardDescription>{myRequests.length} total submitted</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {myRequests.length === 0 && <p className="text-sm text-slate-500">No requests yet.</p>}
            {myRequests.map((c) => (
              <div key={c.id} className="rounded-xl border border-slate-200/70 bg-slate-50 px-4 py-3">
                <div className="text-sm font-medium">{c.title}</div>
                <div className="text-xs text-slate-500">
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
