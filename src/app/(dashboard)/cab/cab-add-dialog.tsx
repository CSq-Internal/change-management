"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useToast } from "@/components/ui/toaster"
import { t, type Language } from "@/lib/i18n"
import { addCabMember } from "@/server/actions/cab"
import { listCabEligible } from "@/server/actions/users"

type Eligible = { id: string; name: string | null; email: string }

interface CabAddDialogProps {
  language: Language
  opcos: { slug: string; name: string }[] | null // null = group CAB
  existing: { userId: string; opcoSlug: string | null }[]
  onClose: () => void
  onAdded: () => void
}

export default function CabAddDialog({ language, opcos, existing, onClose, onAdded }: CabAddDialogProps) {
  const { toast } = useToast()
  const [selectedSlug, setSelectedSlug] = useState<string | null>(opcos && opcos.length ? opcos[0].slug : null)
  const [eligible, setEligible] = useState<Eligible[]>([])
  const [pending, setPending] = useState(false)

  useEffect(() => {
    listCabEligible(selectedSlug).then(setEligible).catch(() => setEligible([]))
  }, [selectedSlug])

  const taken = new Set(existing.filter((e) => e.opcoSlug === selectedSlug).map((e) => e.userId))
  const addable = eligible.filter((a) => !taken.has(a.id))

  const add = async (userId: string) => {
    setPending(true)
    try {
      await addCabMember(userId, selectedSlug)
      toast({ title: t(language, "cabAdmin.added"), variant: "success" })
      onAdded()
    } catch (err) {
      toast({ title: t(language, "cabAdmin.failed"), description: err instanceof Error ? err.message : "Unknown error", variant: "error" })
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
      <Card className="w-full max-w-md border-border/80 bg-card/95">
        <CardHeader>
          <CardTitle className="text-base">{t(language, "cabAdmin.addTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {opcos && (
            <select
              aria-label={t(language, "cabAdmin.opcoLabel")}
              className="w-full rounded border bg-background px-2 py-2 text-sm"
              value={selectedSlug ?? ""}
              onChange={(e) => setSelectedSlug(e.target.value)}
              disabled={pending}
            >
              {opcos.map((o) => (
                <option key={o.slug} value={o.slug}>{o.name}</option>
              ))}
            </select>
          )}
          <div className="text-xs text-muted-foreground">{t(language, "cabAdmin.pick")}</div>
          <div className="space-y-1">
            {addable.map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded border border-border/40 px-3 py-1.5 text-sm">
                <span>{a.email}</span>
                <Button variant="outline" onClick={() => add(a.id)} disabled={pending}>
                  {t(language, "cabAdmin.add")}
                </Button>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{t(language, "cabAdmin.pickHint")}</p>
          <div className="flex justify-end">
            <Button variant="outline" onClick={onClose} disabled={pending}>
              {t(language, "cabAdmin.cancel")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
