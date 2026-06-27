"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { t, type Language } from "@/lib/i18n"
import type { DbUser } from "./types"

type Filter = "active" | "inactive" | "all"
const filters: Filter[] = ["active", "inactive", "all"]
const filterKey: Record<Filter, string> = {
  active: "users.list.filterActive",
  inactive: "users.list.filterInactive",
  all: "users.list.filterAll",
}

// Maps a zero-assignment user's latest request to a tag. `approved` can't reach the
// no-access section (approval creates an assignment), so it falls back with null.
const accessTag: Record<"pending" | "denied" | "none", { key: string; className: string }> = {
  pending: { key: "users.status.pending", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  denied: { key: "users.status.denied", className: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" },
  none: { key: "users.status.noRequest", className: "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300" },
}

interface UserListProps {
  users: DbUser[]
  isAdmin: boolean
  language: Language
  onEdit: (user: DbUser) => void
  onDeactivate: (user: DbUser) => void
  onReactivate: (user: DbUser) => void
}

interface UserRowProps {
  user: DbUser
  isAdmin: boolean
  language: Language
  onEdit: (user: DbUser) => void
  onDeactivate: (user: DbUser) => void
  onReactivate: (user: DbUser) => void
  // When set, render the access-request status tag instead of the active/inactive badge.
  accessSection?: boolean
}

function UserRow({ user, isAdmin, language, onEdit, onDeactivate, onReactivate, accessSection }: UserRowProps) {
  const tag = accessSection
    ? accessTag[user.accessStatus === "pending" ? "pending" : user.accessStatus === "denied" ? "denied" : "none"]
    : null

  return (
    <div className="rounded-xl border border-border/70 bg-muted px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium">{user.name ?? user.email}</div>
          <div className="text-xs text-muted-foreground">{user.email}</div>
        </div>
        {tag ? (
          <span className={`rounded-full px-2 py-0.5 text-xs ${tag.className}`}>{t(language, tag.key)}</span>
        ) : (
          <span
            className={`rounded-full px-2 py-0.5 text-xs ${
              user.isActive
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
            }`}
          >
            {user.isActive ? t(language, "users.list.active") : t(language, "users.list.inactive")}
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {user.isGroupAdmin && (
            <span className="rounded-full bg-indigo-100 px-2 py-0.5 font-medium text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
              {t(language, "users.groupAdmin")}
            </span>
          )}
          {user.opcoAssignments.map((a) => (
            <span key={a.opco.slug} className={a.isActive ? "" : "line-through opacity-50"}>
              {a.opco.slug} ({a.role})
            </span>
          ))}
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onEdit(user)}>
              {t(language, "users.list.edit")}
            </Button>
            {user.isActive ? (
              <Button variant="outline" onClick={() => onDeactivate(user)}>
                {t(language, "users.list.deactivate")}
              </Button>
            ) : (
              <Button variant="outline" onClick={() => onReactivate(user)}>
                {t(language, "users.list.reactivate")}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function UserList({
  users,
  isAdmin,
  language,
  onEdit,
  onDeactivate,
  onReactivate,
}: UserListProps) {
  const [filter, setFilter] = useState<Filter>("active")
  const filtered = users.filter((u) =>
    filter === "all" ? true : filter === "active" ? u.isActive : !u.isActive
  )
  // Group admins have authority via the Keycloak group_admin role, not OpCo
  // assignments, so a zero-assignment group admin still has access — keep them
  // out of the "No access" section.
  const hasAccess = (u: DbUser) => u.opcoAssignments.length > 0 || u.isGroupAdmin
  const withAccess = filtered.filter(hasAccess)
  const noAccess = filtered.filter((u) => !hasAccess(u))

  const rowProps = { isAdmin, language, onEdit, onDeactivate, onReactivate }

  return (
    <div className="space-y-6">
      <Card className="border-border/80 bg-card/95">
        <CardHeader>
          <CardTitle className="text-base">{t(language, "users.active")}</CardTitle>
          <CardDescription>
            {users.length} {t(language, "users.total")}
          </CardDescription>
          <div className="mt-2 flex gap-2">
            {filters.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-full px-3 py-1 text-xs ${
                  filter === f ? "bg-slate-900 text-white" : "bg-muted text-muted-foreground"
                }`}
              >
                {t(language, filterKey[f])}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {withAccess.length === 0 && (
            <p className="text-sm text-muted-foreground">{t(language, "users.none")}</p>
          )}
          {withAccess.map((user) => (
            <UserRow key={user.id} user={user} {...rowProps} />
          ))}
        </CardContent>
      </Card>

      {noAccess.length > 0 && (
        <Card className="border-border/80 bg-card/95">
          <CardHeader>
            <CardTitle className="text-base">{t(language, "users.noAccess.title")}</CardTitle>
            <CardDescription>{t(language, "users.noAccess.desc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {noAccess.map((user) => (
              <UserRow key={user.id} user={user} {...rowProps} accessSection />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
