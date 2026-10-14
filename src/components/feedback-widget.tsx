"use client"

import { useState, type FormEvent } from "react"
import { Flag } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import { changeIdFromPath } from "@/lib/feedback-context"
import { submitFeedback } from "@/server/actions/feedback"

// The writer reports what happened, not where they were: route, change id, viewport and
// locale ride along automatically. Author, roles and OpCos are taken server-side from the
// session, so they are never sent from here.

type Category = "bug" | "confusing" | "missing" | "praise"
type Severity = "blocker" | "major" | "minor"
type Status = "idle" | "pending" | "sent" | "failed"

const CATEGORIES: Category[] = ["bug", "confusing", "missing", "praise"]
const SEVERITIES: Severity[] = ["blocker", "major", "minor"]

const selectClass = "mt-2 h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
const labelClass = "text-xs uppercase tracking-[0.2em] text-slate-400"

export function FeedbackWidget({ route }: { route: string }) {
  const { language } = useStore()
  const translate = (key: string) => t(language, key)
  const [open, setOpen] = useState(false)
  // No default category: a report nobody classified must not be silently filed as a bug.
  const [category, setCategory] = useState<Category | "">("")
  const [severity, setSeverity] = useState<Severity>("major")
  const [body, setBody] = useState("")
  const [status, setStatus] = useState<Status>("idle")

  const close = () => {
    setOpen(false)
    setCategory("")
    setSeverity("major")
    setBody("")
    setStatus("idle")
  }

  const trimmed = body.trim()
  const canSubmit = category !== "" && trimmed.length > 0 && status !== "pending"

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (category === "" || !canSubmit) return
    setStatus("pending")
    submitFeedback({
      category,
      severity: category === "bug" ? severity : null,
      body: trimmed,
      route,
      changeId: changeIdFromPath(route),
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      locale: language,
    })
      .then(() => setStatus("sent"))
      .catch(() => setStatus("failed"))
  }

  return (
    <>
      <button
        className="inline-flex items-center gap-2 rounded-full bg-card px-3 py-2 text-xs text-muted-foreground transition hover:bg-muted"
        onClick={() => setOpen(true)}
        aria-label={translate("feedback.trigger")}
      >
        <Flag className="h-4 w-4" />
        <span className="hidden sm:inline">{translate("feedback.trigger")}</span>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="feedback-title"
            className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h3 id="feedback-title" className="text-lg font-semibold">{translate("feedback.title")}</h3>
              <button className="text-sm text-muted-foreground hover:text-foreground" onClick={close}>
                {translate("feedback.close")}
              </button>
            </div>
            {status === "sent" ? (
              <p className="mt-4 text-sm">{translate("feedback.sent")}</p>
            ) : (
              <form onSubmit={submit} className="mt-4 space-y-4">
                <div>
                  <label htmlFor="feedback-category" className={labelClass}>{translate("feedback.category")}</label>
                  <select
                    id="feedback-category"
                    value={category}
                    onChange={(e) => setCategory(e.target.value as Category)}
                    className={selectClass}
                  >
                    <option value="" disabled>{translate("feedback.categoryPlaceholder")}</option>
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>{translate(`feedback.category.${c}`)}</option>
                    ))}
                  </select>
                </div>
                {category === "bug" && (
                  <div>
                    <label htmlFor="feedback-severity" className={labelClass}>{translate("feedback.severity")}</label>
                    <select
                      id="feedback-severity"
                      value={severity}
                      onChange={(e) => setSeverity(e.target.value as Severity)}
                      className={selectClass}
                    >
                      {SEVERITIES.map((s) => (
                        <option key={s} value={s}>{translate(`feedback.severity.${s}`)}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label htmlFor="feedback-body" className={labelClass}>{translate("feedback.body")}</label>
                  <Textarea
                    id="feedback-body"
                    rows={4}
                    maxLength={4000}
                    value={body}
                    placeholder={translate("feedback.bodyPlaceholder")}
                    onChange={(e) => setBody(e.target.value)}
                    className="mt-2"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">{translate("feedback.hint")}</p>
                </div>
                {status === "failed" && (
                  <p className="text-sm text-rose-600">{translate("feedback.failed")}</p>
                )}
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={close}>{translate("feedback.cancel")}</Button>
                  <Button type="submit" disabled={!canSubmit}>{translate("feedback.submit")}</Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  )
}
