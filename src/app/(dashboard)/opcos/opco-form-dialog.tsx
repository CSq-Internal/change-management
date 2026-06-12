"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/toaster"
import { t, type Language } from "@/lib/i18n"
import { createOpCo, renameOpCo } from "@/server/actions/opcos"
import type { DbOpCo } from "./types"

interface OpcoFormDialogProps {
  language: Language
  opco: DbOpCo | null // null = create
  onClose: () => void
  onSaved: () => void
}

export default function OpcoFormDialog({ language, opco, onClose, onSaved }: OpcoFormDialogProps) {
  const { toast } = useToast()
  const [name, setName] = useState(opco?.name ?? "")
  const [slug, setSlug] = useState("")
  const [locale, setLocale] = useState("en")
  const [pending, setPending] = useState(false)

  const canSubmit = opco ? name.trim() : name.trim() && slug.trim()

  const save = async () => {
    if (!canSubmit) return
    setPending(true)
    try {
      if (opco) {
        await renameOpCo(opco.id, name)
      } else {
        await createOpCo({ slug: slug.trim(), name: name.trim(), locale })
      }
      toast({ title: t(language, "opcosAdmin.saved"), description: name, variant: "success" })
      onSaved()
    } catch (err) {
      toast({ title: t(language, "opcosAdmin.failed"), description: err instanceof Error ? err.message : "Unknown error", variant: "error" })
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
      <Card className="w-full max-w-md border-border/80 bg-card/95">
        <CardHeader>
          <CardTitle className="text-base">
            {t(language, opco ? "opcosAdmin.renameTitle" : "opcosAdmin.createTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder={t(language, "opcosAdmin.fieldName")} value={name} onChange={(e) => setName(e.target.value)} />
          {!opco && (
            <>
              <Input placeholder={t(language, "opcosAdmin.fieldSlug")} value={slug} onChange={(e) => setSlug(e.target.value)} />
              <select
                aria-label={t(language, "opcosAdmin.fieldLocale")}
                className="w-full rounded border bg-background px-2 py-2 text-sm"
                value={locale}
                onChange={(e) => setLocale(e.target.value)}
              >
                <option value="en">en</option>
                <option value="fr">fr</option>
              </select>
            </>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={pending}>{t(language, "opcosAdmin.cancel")}</Button>
            <Button onClick={save} disabled={pending || !canSubmit}>{t(language, "opcosAdmin.save")}</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
