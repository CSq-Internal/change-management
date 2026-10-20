"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import { DateTime } from "@/components/date-time"
import { FEEDBACK_OUTCOMES, isFeedbackOutcome, requiresNote } from "@/lib/feedback-outcome"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { triageFeedback } from "@/server/actions/feedback"
import type { FeedbackRow } from "./types"
import { errorMessage } from "@/lib/user-error"

const CATEGORIES = ["bug", "confusing", "missing", "praise"] as const
const splitSlugs = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean)

export default function FeedbackClient({ rows: initialRows }: { rows: FeedbackRow[] }) {
  const { language } = useStore()
  const tr = (k: string) => t(language, k)
  const [rows, setRows] = useState<FeedbackRow[]>(initialRows)
  const [category, setCategory] = useState("")
  const [opco, setOpco] = useState("")
  const [untriagedOnly, setUntriagedOnly] = useState(true)
  // One draft per row: the triager works down a list, so no per-item dialog.
  const [draft, setDraft] = useState<Map<string, { outcome: string; note: string }>>(new Map())
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [pending, setPending] = useState<Record<string, boolean>>({})

  const opcoOptions = useMemo(
    () => [...new Set(rows.flatMap((r) => splitSlugs(r.opcoSlugs)))].sort(),
    [rows]
  )
  const visible = rows.filter(
    (r) =>
      (category === "" || r.category === category) &&
      (opco === "" || splitSlugs(r.opcoSlugs).includes(opco)) &&
      (!untriagedOnly || r.triagedAt === null)
  )

  const setRowDraft = (id: string, patch: Partial<{ outcome: string; note: string }>) =>
    setDraft((prev) => new Map(prev).set(id, { outcome: "", note: "", ...prev.get(id), ...patch }))

  async function markTriaged(id: string) {
    const d = draft.get(id)
    if (!d?.outcome) return
    setPending((p) => ({ ...p, [id]: true }))
    setErrors((e) => ({ ...e, [id]: "" }))
    try {
      const res = await triageFeedback(id, d.outcome, d.note)
      setRows((prev) =>
        prev.map((r) => (r.id === id ? { ...r, triagedAt: res.triagedAt, outcome: res.outcome, triageNote: res.triageNote } : r))
      )
    } catch (err) {
      // The server's own message ("deferred needs a note saying why") is actionable.
      setErrors((e) => ({ ...e, [id]: errorMessage(err, tr("feedback.triage.failed")) }))
    } finally {
      setPending((p) => ({ ...p, [id]: false }))
    }
  }

  const headers = [
    "when", "filterCategory", "severity", "comment", "screen", "change", "from", "roles", "opcos", "outcome",
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{tr("feedback.triage.title")}</h1>
        <p className="text-sm text-muted-foreground">{tr("feedback.triage.desc")}</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-muted-foreground">
          {tr("feedback.triage.filterCategory")}
          <select
            className="mt-1 block rounded border bg-background px-2 py-2 text-sm"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">{tr("feedback.triage.all")}</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{tr(`feedback.categoryShort.${c}`)}</option>)}
          </select>
        </label>
        <label className="text-xs text-muted-foreground">
          {tr("feedback.triage.filterOpco")}
          <select
            className="mt-1 block rounded border bg-background px-2 py-2 text-sm"
            value={opco}
            onChange={(e) => setOpco(e.target.value)}
          >
            <option value="">{tr("feedback.triage.all")}</option>
            {opcoOptions.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" checked={untriagedOnly} onChange={(e) => setUntriagedOnly(e.target.checked)} />
          {tr("feedback.triage.untriagedOnly")}
        </label>
      </div>

      <Card className="border-border/80 bg-card/95">
        {visible.length === 0 ? (
          <CardContent className="py-6">
            <p className="text-sm text-muted-foreground">{tr("feedback.triage.empty")}</p>
          </CardContent>
        ) : (
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="responsive-table w-full text-sm">
                <thead>
                  <tr className="border-b border-border/70 text-left text-xs text-muted-foreground">
                    {headers.map((h) => <th key={h} className="px-4 py-2">{tr(`feedback.triage.${h}`)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => {
                    const d = draft.get(r.id)
                    const label = (h: string) => tr(`feedback.triage.${h}`)
                    return (
                      <tr key={r.id} className="border-b border-border/40 align-top">
                        <td className="px-4 py-2 whitespace-nowrap text-xs text-muted-foreground" data-label={label("when")}>
                          <DateTime value={r.createdAt} />
                        </td>
                        <td className="px-4 py-2 font-medium" data-label={label("filterCategory")}>
                          {tr(`feedback.categoryShort.${r.category}`)}
                        </td>
                        <td className="px-4 py-2" data-label={label("severity")}>
                          {r.severity ? tr(`feedback.severity.${r.severity}`) : "—"}
                        </td>
                        <td className="px-4 py-2 max-w-xs whitespace-pre-wrap" data-label={label("comment")}>{r.body}</td>
                        <td className="px-4 py-2 font-mono text-xs text-muted-foreground" data-label={label("screen")}>{r.route}</td>
                        <td className="px-4 py-2 font-mono text-xs" data-label={label("change")}>
                          {r.changeId ? <Link href={`/changes/${r.changeId}`} className="underline">{r.changeId}</Link> : "—"}
                        </td>
                        <td className="px-4 py-2" data-label={label("from")}>{r.authorName}</td>
                        <td className="px-4 py-2 text-xs" data-label={label("roles")}>{r.roles || "—"}</td>
                        <td className="px-4 py-2 text-xs" data-label={label("opcos")}>{r.opcoSlugs || "—"}</td>
                        <td className="px-4 py-2" data-label={label("outcome")}>
                          {r.triagedAt ? (
                            <div className="flex flex-col gap-1">
                              <span className="text-xs font-semibold text-emerald-600">
                                {r.outcome ? tr(`feedback.outcome.${r.outcome}`) : "—"}
                              </span>
                              {r.triageNote && <span className="text-xs text-muted-foreground">{r.triageNote}</span>}
                            </div>
                          ) : (
                            <div className="flex min-w-48 flex-col gap-2">
                              <select
                                aria-label={tr("feedback.triage.outcome")}
                                className="rounded border bg-background px-2 py-2 text-sm"
                                value={d?.outcome ?? ""}
                                onChange={(e) => setRowDraft(r.id, { outcome: e.target.value })}
                              >
                                <option value="" disabled>{tr("feedback.triage.chooseOutcome")}</option>
                                {FEEDBACK_OUTCOMES.map((o) => <option key={o} value={o}>{tr(`feedback.outcome.${o}`)}</option>)}
                              </select>
                              {isFeedbackOutcome(d?.outcome) && requiresNote(d.outcome) && (
                                <Input
                                  aria-label={tr("feedback.triage.note")}
                                  placeholder={tr("feedback.triage.notePlaceholder")}
                                  value={d.note}
                                  onChange={(e) => setRowDraft(r.id, { note: e.target.value })}
                                />
                              )}
                              <Button
                                variant="outline"
                                disabled={!d?.outcome || pending[r.id]}
                                onClick={() => void markTriaged(r.id)}
                              >
                                {tr("feedback.triage.mark")}
                              </Button>
                              {errors[r.id] && <span className="text-xs text-rose-600">{errors[r.id]}</span>}
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  )
}
