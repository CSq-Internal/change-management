"use client"

import { useMemo, useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/toaster"
import { t, type Language } from "@/lib/i18n"
import type { Role } from "@/lib/types"
import { OPCO_SLUGS, OPCO_NAMES, type OpCoSlug } from "@/lib/opco"
import { createUser } from "@/server/actions/users"

const roles: Role[] = ["requester", "approver", "auditor", "admin"]
type Assignment = { opcoSlug: string; role: Role }

interface OnboardWizardProps {
  language: Language
  manageable: string[] | "all"
  onClose: () => void
  onCreated: () => void
}

export default function OnboardWizard({ language, manageable, onClose, onCreated }: OnboardWizardProps) {
  const { toast } = useToast()
  const availableSlugs = (manageable === "all" ? [...OPCO_SLUGS] : manageable) as string[]
  const [step, setStep] = useState(0)
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [assignments, setAssignments] = useState<Assignment[]>(() => [
    { opcoSlug: availableSlugs[0] ?? "ghana", role: "requester" },
  ])
  const [isPending, startTransition] = useTransition()

  const steps = useMemo(
    () => [
      { titleKey: "users.wizard.stepProfile", descKey: "users.wizard.profileDesc" },
      { titleKey: "users.wizard.stepAccess", descKey: "users.wizard.accessDesc" },
      { titleKey: "users.wizard.stepReview", descKey: "users.wizard.reviewDesc" },
    ],
    []
  )

  const usedSlugs = new Set(assignments.map((a) => a.opcoSlug))
  const addableSlugs = availableSlugs.filter((s) => !usedSlugs.has(s))

  const addAssignment = () => {
    if (addableSlugs.length === 0) return
    setAssignments((prev) => [...prev, { opcoSlug: addableSlugs[0], role: "requester" }])
  }
  const removeAssignment = (slug: string) =>
    setAssignments((prev) => prev.filter((a) => a.opcoSlug !== slug))
  const setSlug = (oldSlug: string, newSlug: string) =>
    setAssignments((prev) => prev.map((a) => (a.opcoSlug === oldSlug ? { ...a, opcoSlug: newSlug } : a)))
  const setRole = (slug: string, role: Role) =>
    setAssignments((prev) => prev.map((a) => (a.opcoSlug === slug ? { ...a, role } : a)))

  const next = () => setStep((s) => Math.min(s + 1, steps.length - 1))
  const prev = () => setStep((s) => Math.max(s - 1, 0))

  const submit = () => {
    if (!name || !email) {
      toast({
        title: t(language, "users.toast.missing"),
        description: t(language, "users.toast.missingDesc"),
        variant: "error",
      })
      return
    }
    const slugs = assignments.map((a) => a.opcoSlug)
    if (new Set(slugs).size !== slugs.length) {
      toast({
        title: t(language, "users.toast.duplicateOpco"),
        description: t(language, "users.toast.duplicateOpcoDesc"),
        variant: "error",
      })
      return
    }
    if (assignments.length === 0) {
      toast({
        title: t(language, "users.toast.noAssignment"),
        description: t(language, "users.toast.noAssignmentDesc"),
        variant: "error",
      })
      return
    }
    startTransition(async () => {
      try {
        await createUser({ name, email, tempPassword: password || "ChangeMe123!", assignments })
        toast({
          title: t(language, "users.toast.created"),
          description: `${name} — ${assignments.length} OpCo(s)`,
          variant: "success",
        })
        onCreated()
      } catch (err) {
        toast({
          title: "Failed to create user",
          description: err instanceof Error ? err.message : "Unknown error",
          variant: "error",
        })
      }
    })
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 px-4 py-10">
      <Card className="w-full max-w-2xl border-border/80 bg-card/95">
        <CardHeader className="space-y-1">
          <CardTitle className="text-xl">{t(language, "users.wizard.title")}</CardTitle>
          <CardDescription>{t(language, steps[step].descKey)}</CardDescription>
          <div className="mt-2 flex gap-2 text-xs text-muted-foreground">
            {steps.map((item, index) => (
              <span
                key={item.titleKey}
                className={`rounded-full px-3 py-1 ${
                  index === step ? "bg-slate-900 text-white" : "bg-slate-100 text-muted-foreground"
                }`}
              >
                {index + 1}. {t(language, item.titleKey)}
              </span>
            ))}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === 0 && (
            <div className="grid gap-4">
              <Input
                placeholder={t(language, "users.wizard.name")}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <Input
                placeholder={t(language, "users.wizard.email")}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          )}

          {step === 1 && (
            <div className="grid gap-4">
              <label className="text-sm font-medium">{t(language, "users.wizard.assignmentsLabel")}</label>
              {assignments.map((a) => (
                <div key={a.opcoSlug} className="flex items-center gap-2">
                  <select
                    className="h-9 flex-1 rounded-md border border-border bg-white px-3 text-sm"
                    value={a.opcoSlug}
                    onChange={(e) => setSlug(a.opcoSlug, e.target.value)}
                  >
                    {availableSlugs.map((slug) => (
                      <option key={slug} value={slug} disabled={slug !== a.opcoSlug && usedSlugs.has(slug)}>
                        {OPCO_NAMES[slug as OpCoSlug] ?? slug}
                      </option>
                    ))}
                  </select>
                  <select
                    className="h-9 w-40 rounded-md border border-border bg-white px-3 text-sm"
                    value={a.role}
                    onChange={(e) => setRole(a.opcoSlug, e.target.value as Role)}
                  >
                    {roles.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                  {assignments.length > 1 && (
                    <Button variant="outline" onClick={() => removeAssignment(a.opcoSlug)}>
                      {t(language, "users.wizard.removeAssignment")}
                    </Button>
                  )}
                </div>
              ))}
              {addableSlugs.length > 0 && (
                <Button variant="outline" onClick={addAssignment}>
                  {t(language, "users.wizard.addAssignment")}
                </Button>
              )}
              <div>
                <label className="text-sm font-medium">{t(language, "users.wizard.password")}</label>
                <Input
                  type="password"
                  placeholder={t(language, "users.wizard.passwordPlaceholder")}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <p className="mt-1 text-xs text-muted-foreground">{t(language, "users.wizard.passwordHint")}</p>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="grid gap-2 text-sm text-muted-foreground">
              <p>
                <strong>{name}</strong> ({email})
              </p>
              <ul className="list-disc pl-5">
                {assignments.map((a) => (
                  <li key={a.opcoSlug}>
                    {OPCO_NAMES[a.opcoSlug as OpCoSlug] ?? a.opcoSlug} — {a.role}
                  </li>
                ))}
              </ul>
              <p>{t(language, "users.wizard.passwordHint")}</p>
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <Button variant="outline" onClick={onClose}>
              {t(language, "users.wizard.cancel")}
            </Button>
            <div className="flex gap-2">
              {step > 0 && (
                <Button variant="outline" onClick={prev}>
                  {t(language, "users.wizard.back")}
                </Button>
              )}
              {step < steps.length - 1 ? (
                <Button onClick={next}>{t(language, "users.wizard.next")}</Button>
              ) : (
                <Button onClick={submit} disabled={isPending}>
                  {isPending ? "Creating…" : t(language, "users.wizard.finish")}
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
