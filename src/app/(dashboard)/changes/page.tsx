"use client"
import { useStore } from "@/lib/store"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toaster"
import { t } from "@/lib/i18n"

export default function Changes(){
  const { changes, update, language } = useStore()
  const { toast } = useToast()
  return (
    <div className="grid gap-4">
      {changes.map(c => (
        <Card key={c.id} className="border-border/80 bg-card/95">
          <CardHeader className="pb-2"><CardTitle className="text-base">{c.title}</CardTitle></CardHeader>
          <CardContent>
            <div className="text-xs text-muted-foreground">{c.status} • {new Date(c.updatedAt).toLocaleString()}</div>
            <div className="mt-3 flex flex-wrap gap-2 text-sm">
              <Button
                variant="outline"
                onClick={() => {
                  update(c.id, { status: "implemented" })
                  toast({
                    title: t(language, "changes.toast.implemented"),
                    description: t(language, "changes.toast.implementedDesc"),
                  })
                }}
              >
                {t(language, "changes.implemented")}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  update(c.id, { status: "verified" })
                  toast({
                    title: t(language, "changes.toast.verified"),
                    description: t(language, "changes.toast.verifiedDesc"),
                  })
                }}
              >
                {t(language, "changes.verified")}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  update(c.id, { status: "closed" })
                  toast({
                    title: t(language, "changes.toast.closed"),
                    description: t(language, "changes.toast.closedDesc"),
                  })
                }}
              >
                {t(language, "changes.close")}
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
      {changes.length === 0 && <p className="text-sm text-muted-foreground">{t(language, "changes.none")}</p>}
    </div>
  )
}
