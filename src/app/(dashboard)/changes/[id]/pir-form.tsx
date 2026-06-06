"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { submitPostImplementationReview } from "@/server/actions/pir"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import type { PirOutcome } from "@prisma/client"

export default function PirForm({ changeId }: { changeId: string }) {
  const language = useStore((s) => s.language)
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [outcome, setOutcome] = useState<PirOutcome>("success")
  const [summary, setSummary] = useState("")
  const [backoutUsed, setBackoutUsed] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function submit() {
    setError(null)
    startTransition(async () => {
      try {
        await submitPostImplementationReview(changeId, { outcome, summary, backoutUsed })
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to submit PIR")
      }
    })
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
      <h4 className="text-sm font-semibold">{t(language, "pir.title")}</h4>
      <label className="block text-xs font-medium text-muted-foreground">
        {t(language, "pir.outcome")}
        <select
          className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          value={outcome}
          onChange={(e) => setOutcome(e.target.value as PirOutcome)}
        >
          <option value="success">{t(language, "pir.outcome.success")}</option>
          <option value="partial">{t(language, "pir.outcome.partial")}</option>
          <option value="failed">{t(language, "pir.outcome.failed")}</option>
        </select>
      </label>
      <label className="block text-xs font-medium text-muted-foreground">
        {t(language, "pir.summary")}
        <textarea
          className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          rows={3}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={backoutUsed} onChange={(e) => setBackoutUsed(e.target.checked)} />
        {t(language, "pir.backoutUsed")}
      </label>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <Button className="w-full" disabled={isPending || !summary.trim()} onClick={submit}>
        {t(language, "pir.submit")}
      </Button>
    </div>
  )
}
