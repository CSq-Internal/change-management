"use client"

import { useMemo, useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useToast } from "@/components/ui/toaster"
import { t, type Language } from "@/lib/i18n"
import type { Role } from "@/lib/types"
import { setGroupRole, setUserAssignments, type GroupRole } from "@/server/actions/users"
import type { DbUser } from "./types"
import { errorMessage } from "@/lib/user-error"

const roles: Role[] = ["requester", "approver", "auditor", "admin"]
type Row = { opcoSlug: string; role: Role }

interface EditUserDialogProps {
  user: DbUser
  language: Language
  opcos: { slug: string; name: string }[]
  canSetGroupRole: boolean
  onClose: () => void
  onSaved: () => void
}

export default function EditUserDialog({ user, language, opcos, canSetGroupRole, onClose, onSaved }: EditUserDialogProps) {
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()
  const availableSlugs = opcos.map((o) => o.slug)
  const opcoName = (slug: string) => opcos.find((o) => o.slug === slug)?.name ?? slug
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

  const currentGroupRole: GroupRole | "" = user.isGroupAdmin ? "group_admin" : user.isGroupAuditor ? "group_auditor" : ""
  const [groupRole, setGroupRoleValue] = useState<GroupRole | "">(currentGroupRole)

  const saveGroupRole = () => {
    startTransition(async () => {
      try {
        await setGroupRole(user.id, groupRole || null)
        toast({ title: t(language, "users.groupRole.saved"), description: user.email, variant: "success" })
        onSaved()
      } catch (err) {
        toast({
          title: t(language, "common.failed"),
          description: errorMessage(err, t(language, "common.unknownError")),
          variant: "error",
        })
      }
    })
  }

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
          title: t(language, "common.failed"),
          description: errorMessage(err, t(language, "common.unknownError")),
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
          {canSetGroupRole && (
            <div className="flex items-center gap-2 border-b border-border pb-4">
              <label htmlFor="group-role" className="w-40 text-sm">{t(language, "users.groupRole.label")}</label>
              <select
                id="group-role"
                className="h-9 flex-1 rounded-md border border-border bg-background px-3 text-sm text-foreground"
                value={groupRole}
                onChange={(e) => setGroupRoleValue(e.target.value as GroupRole | "")}
              >
                <option value="">{t(language, "users.groupRole.none")}</option>
                <option value="group_admin">{t(language, "users.groupAdmin")}</option>
                <option value="group_auditor">{t(language, "users.groupAuditor")}</option>
              </select>
              <Button variant="outline" onClick={saveGroupRole} disabled={isPending || groupRole === currentGroupRole}>
                {t(language, "users.groupRole.save")}
              </Button>
            </div>
          )}
          {readOnly.length > 0 && (
            <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
              {readOnly.map((a) => (
                <span
                  key={a.opco.slug}
                  className="rounded-full bg-muted px-2 py-0.5 text-foreground"
                  title={t(language, "users.edit.readOnly")}
                >
                  {a.opco.slug} ({a.role})
                </span>
              ))}
            </div>
          )}
          {rows.map((row) => (
            <div key={row.opcoSlug} className="flex items-center gap-2">
              <span className="w-40 text-sm">{opcoName(row.opcoSlug)}</span>
              <select
                className="h-9 flex-1 rounded-md border border-border bg-background px-3 text-sm text-foreground"
                value={row.role}
                onChange={(e) => setRole(row.opcoSlug, e.target.value as Role)}
              >
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {t(language, `roles.${r}`)}
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
