"use client"

import { useMemo, useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useToast } from "@/components/ui/toaster"
import { t, type Language } from "@/lib/i18n"
import type { Role } from "@/lib/types"
import { OPCO_SLUGS, OPCO_NAMES, type OpCoSlug } from "@/lib/opco"
import { setUserAssignments } from "@/server/actions/users"
import type { DbUser } from "./types"

const roles: Role[] = ["requester", "approver", "auditor", "admin"]
type Row = { opcoSlug: string; role: Role }

interface EditUserDialogProps {
  user: DbUser
  language: Language
  manageable: string[] | "all"
  onClose: () => void
  onSaved: () => void
}

export default function EditUserDialog({ user, language, manageable, onClose, onSaved }: EditUserDialogProps) {
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()
  const availableSlugs = (manageable === "all" ? [...OPCO_SLUGS] : manageable) as string[]
  const canManageSlug = (slug: string) => availableSlugs.includes(slug)

  const activeAssignments = useMemo(() => user.opcoAssignments.filter((a) => a.isActive), [user])
  const readOnly = useMemo(
    () => activeAssignments.filter((a) => !canManageSlug(a.opco.slug)),
    [activeAssignments] // eslint-disable-line react-hooks/exhaustive-deps
  )
  const [rows, setRows] = useState<Row[]>(() =>
    activeAssignments
      .filter((a) => canManageSlug(a.opco.slug))
      .map((a) => ({ opcoSlug: a.opco.slug, role: a.role as Role }))
  )

  const usedSlugs = new Set([...rows.map((r) => r.opcoSlug), ...readOnly.map((a) => a.opco.slug)])
  const addableSlugs = availableSlugs.filter((s) => !usedSlugs.has(s))

  const addRow = () => {
    if (addableSlugs.length === 0) return
    setRows((prev) => [...prev, { opcoSlug: addableSlugs[0], role: "requester" }])
  }
  const removeRow = (slug: string) => setRows((prev) => prev.filter((r) => r.opcoSlug !== slug))
  const setRole = (slug: string, role: Role) =>
    setRows((prev) => prev.map((r) => (r.opcoSlug === slug ? { ...r, role } : r)))

  const save = () => {
    const desired: Row[] = [
      ...rows,
      ...readOnly.map((a) => ({ opcoSlug: a.opco.slug, role: a.role as Role })),
    ]
    if (desired.length === 0) {
      toast({
        title: t(language, "users.toast.noAssignment"),
        description: t(language, "users.toast.noAssignmentDesc"),
        variant: "error",
      })
      return
    }
    startTransition(async () => {
      try {
        await setUserAssignments(user.id, desired)
        toast({ title: t(language, "users.toast.updated"), description: user.email, variant: "success" })
        onSaved()
      } catch (err) {
        toast({
          title: "Failed",
          description: err instanceof Error ? err.message : "Unknown error",
          variant: "error",
        })
      }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4 py-10">
      <Card className="w-full max-w-2xl border-border/80 bg-card/95">
        <CardHeader>
          <CardTitle className="text-xl">{t(language, "users.edit.title")}</CardTitle>
          <CardDescription>
            {user.name ?? user.email} — {t(language, "users.edit.desc")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {readOnly.length > 0 && (
            <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
              {readOnly.map((a) => (
                <span
                  key={a.opco.slug}
                  className="rounded-full bg-slate-100 px-2 py-0.5"
                  title={t(language, "users.edit.readOnly")}
                >
                  {a.opco.slug} ({a.role})
                </span>
              ))}
            </div>
          )}
          {rows.map((row) => (
            <div key={row.opcoSlug} className="flex items-center gap-2">
              <span className="w-40 text-sm">{OPCO_NAMES[row.opcoSlug as OpCoSlug] ?? row.opcoSlug}</span>
              <select
                className="h-9 flex-1 rounded-md border border-border bg-white px-3 text-sm"
                value={row.role}
                onChange={(e) => setRole(row.opcoSlug, e.target.value as Role)}
              >
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <Button variant="outline" onClick={() => removeRow(row.opcoSlug)}>
                {t(language, "users.wizard.removeAssignment")}
              </Button>
            </div>
          ))}
          {addableSlugs.length > 0 && (
            <Button variant="outline" onClick={addRow}>
              {t(language, "users.edit.addAssignment")}
            </Button>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose} disabled={isPending}>
              {t(language, "users.confirm.cancel")}
            </Button>
            <Button onClick={save} disabled={isPending}>
              {isPending ? t(language, "users.edit.saving") : t(language, "users.edit.save")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
