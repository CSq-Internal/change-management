"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toaster"
import { setChangeAssignees } from "@/server/actions/assignees"

type Entry = { userId: string; role: "approver" | "implementer" }

export default function AssigneesDialog({
  changeId, candidates, approverCandidates, current, onClose,
}: {
  changeId: string
  /** Implementer candidates: every active user in the change's OpCo. */
  candidates: { id: string; label: string }[]
  /** Approver candidates: the narrower eligibility rule setChangeAssignees enforces. */
  approverCandidates: { id: string; label: string }[]
  current: Entry[]
  onClose: () => void
}) {
  const { language } = useStore()
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()
  const [entries, setEntries] = useState<Entry[]>(current)
  const [pickUser, setPickUser] = useState(candidates[0]?.id ?? "")
  const [pickRole, setPickRole] = useState<"approver" | "implementer">("implementer")

  // The two roles draw from different pools, so the user list follows the chosen role.
  const roleCandidates = pickRole === "approver" ? approverCandidates : candidates
  const changeRole = (role: Entry["role"]) => {
    setPickRole(role)
    const next = role === "approver" ? approverCandidates : candidates
    if (!next.some((c) => c.id === pickUser)) setPickUser(next[0]?.id ?? "")
  }

  const add = () => {
    if (!pickUser || entries.some((e) => e.userId === pickUser)) return
    setEntries((e) => [...e, { userId: pickUser, role: pickRole }])
  }
  const remove = (userId: string) => setEntries((e) => e.filter((x) => x.userId !== userId))
  const labelOf = (id: string) =>
    [...candidates, ...approverCandidates].find((c) => c.id === id)?.label ?? id

  const save = () => startTransition(async () => {
    try {
      await setChangeAssignees(changeId, entries)
      toast({ title: t(language, "assignees.saved"), variant: "success" })
      onClose(); router.refresh()
    } catch (err) {
      toast({ title: t(language, "assignees.failed"), description: err instanceof Error ? err.message : "", variant: "error" })
    }
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !isPending && onClose()}>
      <Card className="w-full max-w-md border-border bg-card" onClick={(e) => e.stopPropagation()}>
        <CardHeader><CardTitle className="text-base">{t(language, "assignees.manage")}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-end gap-2">
            <select className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm" value={pickUser} onChange={(e) => setPickUser(e.target.value)}>
              {roleCandidates.map((c) => (<option key={c.id} value={c.id}>{c.label}</option>))}
            </select>
            <select className="rounded-md border border-border bg-background px-2 py-1.5 text-sm" value={pickRole} onChange={(e) => changeRole(e.target.value as Entry["role"])}>
              <option value="implementer">{t(language, "assignees.role.implementer")}</option>
              <option value="approver">{t(language, "assignees.role.approver")}</option>
            </select>
            <Button variant="outline" onClick={add}>{t(language, "assignees.add")}</Button>
          </div>
          <ul className="divide-y divide-border/50 text-sm">
            {entries.map((e) => (
              <li key={e.userId} className="flex items-center justify-between py-2">
                <span>{labelOf(e.userId)} · {t(language, `assignees.role.${e.role}`)}</span>
                <button className="text-xs text-rose-600 hover:underline" onClick={() => remove(e.userId)}>✕</button>
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={isPending}>{t(language, "assignees.cancel")}</Button>
            <Button onClick={save} disabled={isPending}>{t(language, "assignees.save")}</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
