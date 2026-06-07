"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/toaster"
import { riskScore, riskBand } from "@/lib/risk-score"
import { createRisk, updateRisk, type RiskInput } from "@/server/actions/risk-register"

export type RiskRow = {
  id: string; title: string; description: string; category: string
  likelihood: number; impact: number; owner: string; mitigationPlan: string | null
  status: string; reviewDate: string | null; opcoSlug: string | null; opcoName: string | null
}

const BAND_COLOR: Record<string, string> = {
  low: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  high: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  critical: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
}
const CATEGORIES = ["operational", "security", "compliance", "technical"] as const
const STATUSES = ["open", "mitigating", "closed"] as const

function ScoreBadge({ likelihood, impact }: { likelihood: number; impact: number }) {
  const score = riskScore(likelihood, impact)
  const band = riskBand(score)
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${BAND_COLOR[band]}`}>
      {score} · {band}
    </span>
  )
}

const emptyForm = (opcoSlug: string | null): RiskInput => ({
  title: "", description: "", category: "operational", likelihood: 3, impact: 3,
  owner: "", mitigationPlan: "", status: "open", reviewDate: null, opcoSlug,
})

export default function RiskRegisterClient({
  rows, canManage, canManageGroup, manageableOpcos,
}: {
  rows: RiskRow[]; canManage: boolean; canManageGroup: boolean
  manageableOpcos: { slug: string; name: string }[]
}) {
  const { language } = useStore()
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()
  const [editing, setEditing] = useState<{ id: string | null; form: RiskInput } | null>(null)

  const scopeOptions: { value: string; label: string }[] = [
    ...(canManageGroup ? [{ value: "", label: t(language, "risk.scope.group") }] : []),
    ...manageableOpcos.map((o) => ({ value: o.slug, label: o.name })),
  ]

  const openNew = () => setEditing({ id: null, form: emptyForm(scopeOptions[0]?.value || null) })
  const openEdit = (r: RiskRow) => setEditing({
    id: r.id,
    form: {
      title: r.title, description: r.description, category: r.category as RiskInput["category"],
      likelihood: r.likelihood, impact: r.impact, owner: r.owner,
      mitigationPlan: r.mitigationPlan, status: r.status as RiskInput["status"],
      reviewDate: r.reviewDate ? r.reviewDate.slice(0, 10) : null, opcoSlug: r.opcoSlug,
    },
  })

  const save = () => {
    if (!editing) return
    const { id, form } = editing
    startTransition(async () => {
      try {
        if (id) await updateRisk(id, form)
        else await createRisk(form)
        toast({ title: t(language, "risk.saved"), variant: "success" })
        setEditing(null)
        router.refresh()
      } catch (err) {
        toast({ title: t(language, "risk.failed"), description: err instanceof Error ? err.message : "Unknown error", variant: "error" })
      }
    })
  }

  const set = (patch: Partial<RiskInput>) => setEditing((e) => (e ? { ...e, form: { ...e.form, ...patch } } : e))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t(language, "nav.riskRegister")}</h1>
          <p className="text-sm text-muted-foreground">{t(language, "risk.subtitle")}</p>
        </div>
        {canManage && scopeOptions.length > 0 && <Button onClick={openNew}>{t(language, "risk.new")}</Button>}
      </div>

      <Card className="border-border/80 bg-card/95">
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">{t(language, "risk.empty")}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/70 text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium">{t(language, "risk.col.title")}</th>
                  <th className="px-4 py-2 font-medium">{t(language, "risk.col.category")}</th>
                  <th className="px-4 py-2 font-medium">{t(language, "risk.col.score")}</th>
                  <th className="px-4 py-2 font-medium">{t(language, "risk.col.owner")}</th>
                  <th className="px-4 py-2 font-medium">{t(language, "risk.col.status")}</th>
                  <th className="px-4 py-2 font-medium">{t(language, "risk.col.review")}</th>
                  <th className="px-4 py-2 font-medium">{t(language, "risk.col.scope")}</th>
                  {canManage && <th className="px-4 py-2" />}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-border/40 align-top">
                    <td className="px-4 py-2">
                      <div className="font-medium">{r.title}</div>
                      <div className="text-xs text-muted-foreground line-clamp-2">{r.description}</div>
                    </td>
                    <td className="px-4 py-2 capitalize">{r.category}</td>
                    <td className="px-4 py-2"><ScoreBadge likelihood={r.likelihood} impact={r.impact} /></td>
                    <td className="px-4 py-2">{r.owner}</td>
                    <td className="px-4 py-2 capitalize">{r.status}</td>
                    <td className="px-4 py-2">{r.reviewDate ? r.reviewDate.slice(0, 10) : "—"}</td>
                    <td className="px-4 py-2">{r.opcoName ?? t(language, "risk.scope.group")}</td>
                    {canManage && (
                      <td className="px-4 py-2 text-right">
                        <button onClick={() => openEdit(r)} className="text-xs text-primary hover:underline">{t(language, "risk.edit")}</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !isPending && setEditing(null)}>
          <Card className="w-full max-w-lg border-border bg-card" onClick={(e) => e.stopPropagation()}>
            <CardHeader><CardTitle className="text-base">{editing.id ? t(language, "risk.edit") : t(language, "risk.new")}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Input placeholder={t(language, "risk.col.title")} value={editing.form.title} onChange={(e) => set({ title: e.target.value })} />
              <Textarea placeholder="Description" value={editing.form.description} onChange={(e) => set({ description: e.target.value })} />
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs">{t(language, "risk.col.category")}
                  <select className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm capitalize" value={editing.form.category} onChange={(e) => set({ category: e.target.value as RiskInput["category"] })}>
                    {CATEGORIES.map((c) => (<option key={c} value={c}>{c}</option>))}
                  </select>
                </label>
                <label className="text-xs">{t(language, "risk.col.status")}
                  <select className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm capitalize" value={editing.form.status} onChange={(e) => set({ status: e.target.value as RiskInput["status"] })}>
                    {STATUSES.map((s) => (<option key={s} value={s}>{s}</option>))}
                  </select>
                </label>
                <label className="text-xs">{t(language, "risk.field.likelihood")}
                  <Input type="number" min={1} max={5} value={editing.form.likelihood} onChange={(e) => set({ likelihood: Number(e.target.value) })} />
                </label>
                <label className="text-xs">{t(language, "risk.field.impact")}
                  <Input type="number" min={1} max={5} value={editing.form.impact} onChange={(e) => set({ impact: Number(e.target.value) })} />
                </label>
              </div>
              <Input placeholder={t(language, "risk.col.owner")} value={editing.form.owner} onChange={(e) => set({ owner: e.target.value })} />
              <Textarea placeholder={t(language, "risk.field.mitigation")} value={editing.form.mitigationPlan ?? ""} onChange={(e) => set({ mitigationPlan: e.target.value || null })} />
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs">{t(language, "risk.field.reviewDate")}
                  <Input type="date" value={editing.form.reviewDate ?? ""} onChange={(e) => set({ reviewDate: e.target.value || null })} />
                </label>
                <label className="text-xs">{t(language, "risk.col.scope")}
                  <select className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm" value={editing.form.opcoSlug ?? ""} onChange={(e) => set({ opcoSlug: e.target.value || null })}>
                    {scopeOptions.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
                  </select>
                </label>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setEditing(null)} disabled={isPending}>{t(language, "risk.cancel")}</Button>
                <Button onClick={save} disabled={isPending}>{t(language, "risk.save")}</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
