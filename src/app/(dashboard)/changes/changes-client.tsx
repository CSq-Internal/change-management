"use client"

import Link from "next/link"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"

export type ChangeItem = {
  id: string
  title: string
  status: string
  updatedAt: Date
}

interface ChangesClientProps {
  changes: ChangeItem[]
}

export default function ChangesClient({ changes }: ChangesClientProps) {
  const { language } = useStore()

  return (
    <div className="grid gap-4">
      {changes.map((c) => (
        <Link key={c.id} href={`/changes/${c.id}`} className="block">
          <Card className="border-border/80 bg-card/95 transition-colors hover:bg-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-base line-clamp-2 sm:line-clamp-1">{c.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xs text-muted-foreground">
                {c.status} • {new Date(c.updatedAt).toLocaleString()}
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
      {changes.length === 0 && (
        <p className="text-sm text-muted-foreground">{t(language, "changes.none")}</p>
      )}
    </div>
  )
}
