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

interface UserListProps {
  users: DbUser[]
  isAdmin: boolean
  language: Language
  onEdit: (user: DbUser) => void
  onDeactivate: (user: DbUser) => void
  onReactivate: (user: DbUser) => void
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

  return (
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
                filter === f ? "bg-slate-900 text-white" : "bg-slate-100 text-muted-foreground"
              }`}
            >
              {t(language, filterKey[f])}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {filtered.length === 0 && (
          <p className="text-sm text-muted-foreground">{t(language, "users.none")}</p>
        )}
        {filtered.map((user) => (
          <div key={user.id} className="rounded-xl border border-border/70 bg-muted px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-medium">{user.name ?? user.email}</div>
                <div className="text-xs text-muted-foreground">{user.email}</div>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-xs ${
                  user.isActive ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"
                }`}
              >
                {user.isActive ? t(language, "users.list.active") : t(language, "users.list.inactive")}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
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
        ))}
      </CardContent>
    </Card>
  )
}
