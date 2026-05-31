"use client"
import { useStore } from "@/lib/store"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { t } from "@/lib/i18n"
import type { ChangeRequest } from "@/lib/types"

export default function Audits(){
  const { language } = useStore()
  // TODO: wire to server data (Phase 4)
  const changes: ChangeRequest[] = []
  return (
    <Card className="border-border/80 bg-card/95">
      <CardHeader><CardTitle className="text-xl sm:text-lg">{t(language, "audits.title")}</CardTitle></CardHeader>
      <CardContent>
        <p className="text-muted-foreground text-sm">{t(language, "audits.desc")}</p>
        <pre className="mt-4 rounded bg-muted p-3 text-xs text-foreground/80 overflow-auto max-h-[60vh] sm:max-h-[50vh]">
          {JSON.stringify(changes, null, 2)}
        </pre>
      </CardContent>
    </Card>
  )
}
