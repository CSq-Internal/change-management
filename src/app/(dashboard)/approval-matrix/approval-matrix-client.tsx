"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toaster"
import { addApproverAssignment, removeApproverAssignment } from "@/server/actions/approval-matrix"

type OverrideRow = { id: string; infrastructureType: string; opcoSlug: string | null; opcoName: string | null; userLabel: string }

export default function ApprovalMatrixClient({
  canManage, infraTypes, scopes, candidates, rows,
}: {
  canManage: boolean
  infraTypes: string[]
  scopes: { slug: string; name: string }[]
  candidates: { id: string; label: string }[]
  rows: OverrideRow[]
}) {
  const { language } = useStore()
  const router = useRouter()
  const { toast } = useToast()
  const [, startTransition] = useTransition()
  const [infra, setInfra] = useState(infraTypes[0] ?? "")
  const [scope, setScope] = useState(scopes[0]?.slug ?? "")
  const [userId, setUserId] = useState(candidates[0]?.id ?? "")

  if (!canManage) return null

  const run = (fn: () => Promise<unknown>, okKey: string) =>
    startTransition(async () => {
      try { await fn(); toast({ title: t(language, okKey), variant: "success" }); router.refresh() }
      catch (err) { toast({ title: t(language, "matrix.failed"), description: err instanceof Error ? err.message : "", variant: "error" }) }
    })

  return (
    <Card className="border-border/80 bg-card/95">
      <CardHeader>
        <CardTitle className="text-base">{t(language, "matrix.overrides.title")}</CardTitle>
        <CardDescription>{t(language, "matrix.overrides.desc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs">{t(language, "matrix.infra")}
            <select className="mt-1 block w-48 rounded-md border border-border bg-background px-2 py-1.5 text-sm" value={infra} onChange={(e) => setInfra(e.target.value)}>
              {infraTypes.map((i) => (<option key={i} value={i}>{i}</option>))}
            </select>
          </label>
          <label className="text-xs">{t(language, "matrix.scope")}
            <select className="mt-1 block w-36 rounded-md border border-border bg-background px-2 py-1.5 text-sm" value={scope} onChange={(e) => setScope(e.target.value)}>
              {scopes.map((s) => (<option key={s.slug} value={s.slug}>{s.name}</option>))}
            </select>
          </label>
          <label className="text-xs">{t(language, "matrix.approver")}
            <select className="mt-1 block w-48 rounded-md border border-border bg-background px-2 py-1.5 text-sm" value={userId} onChange={(e) => setUserId(e.target.value)}>
              {candidates.map((c) => (<option key={c.id} value={c.id}>{c.label}</option>))}
            </select>
          </label>
          <Button disabled={!infra || !userId} onClick={() => run(() => addApproverAssignment({ infrastructureType: infra, opcoSlug: scope || null, userId }), "matrix.added")}>
            {t(language, "matrix.add")}
          </Button>
        </div>

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t(language, "matrix.none")}</p>
        ) : (
          <ul className="divide-y divide-border/50 text-sm">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center justify-between py-2">
                <span>{r.infrastructureType} · {r.opcoName ?? t(language, "matrix.group")} · <span className="font-medium">{r.userLabel}</span></span>
                <button className="text-xs text-rose-600 hover:underline" onClick={() => run(() => removeApproverAssignment(r.id), "matrix.removed")}>{t(language, "matrix.remove")}</button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
