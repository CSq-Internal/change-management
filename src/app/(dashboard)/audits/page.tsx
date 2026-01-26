"use client"
import { useStore } from "@/lib/store"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { t } from "@/lib/i18n"

export default function Audits(){
  const { changes, language } = useStore()
  return (
    <Card className="border-border/80 bg-card/95">
      <CardHeader><CardTitle>{t(language, "audits.title")}</CardTitle></CardHeader>
      <CardContent>
        <p className="text-muted-foreground text-sm">{t(language, "audits.desc")}</p>
        <pre className="mt-4 rounded bg-muted p-3 text-xs text-foreground/80 overflow-auto">
          {JSON.stringify(changes, null, 2)}
        </pre>
      </CardContent>
    </Card>
  )
}
