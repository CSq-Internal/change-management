"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toaster"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import { updateChangeStatus } from "@/server/actions/changes"

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
  const { toast } = useToast()
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  async function handleTransition(changeId: string, toStatus: "implemented" | "verified" | "closed") {
    const toastKeys = {
      implemented: { title: "changes.toast.implemented", desc: "changes.toast.implementedDesc" },
      verified: { title: "changes.toast.verified", desc: "changes.toast.verifiedDesc" },
      closed: { title: "changes.toast.closed", desc: "changes.toast.closedDesc" },
    }
    try {
      await updateChangeStatus(changeId, toStatus)
      toast({
        title: t(language, toastKeys[toStatus].title),
        description: t(language, toastKeys[toStatus].desc),
      })
      startTransition(() => router.refresh())
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "An error occurred",
        variant: "error",
      })
    }
  }

  return (
    <div className="grid gap-4">
      {changes.map((c) => (
        <Card key={c.id} className="border-border/80 bg-card/95">
          <CardHeader className="pb-2">
            <CardTitle className="text-base line-clamp-2 sm:line-clamp-1">{c.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-muted-foreground">
              {c.status} • {new Date(c.updatedAt).toLocaleString()}
            </div>
            <div className="mt-3 flex flex-col sm:flex-row flex-wrap gap-2 text-sm">
              <Button
                variant="outline"
                className="w-full sm:w-auto"
                disabled={isPending || c.status !== "approved"}
                onClick={() => handleTransition(c.id, "implemented")}
              >
                {t(language, "changes.implemented")}
              </Button>
              <Button
                variant="outline"
                className="w-full sm:w-auto"
                disabled={isPending || c.status !== "implemented"}
                onClick={() => handleTransition(c.id, "verified")}
              >
                {t(language, "changes.verified")}
              </Button>
              <Button
                variant="outline"
                className="w-full sm:w-auto"
                disabled={isPending || c.status !== "verified"}
                onClick={() => handleTransition(c.id, "closed")}
              >
                {t(language, "changes.close")}
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
      {changes.length === 0 && (
        <p className="text-sm text-muted-foreground">{t(language, "changes.none")}</p>
      )}
    </div>
  )
}
