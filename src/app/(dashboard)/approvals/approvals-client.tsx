"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toaster"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import { submitApproval } from "@/server/actions/approvals"

type Requester = { name: string | null; email: string }
type OpCo = { name: string; slug: string }
type Approval = { isCab: boolean; decision: string; approverId: string }

export type ApprovalChange = {
  id: string
  title: string
  description: string
  riskLevel: string
  createdAt: Date
  requester: Requester
  opco: OpCo
  approvals: Approval[]
}

interface ApprovalsClientProps {
  changes: ApprovalChange[]
  isCabMember: boolean
}

export default function ApprovalsClient({ changes, isCabMember }: ApprovalsClientProps) {
  const { language } = useStore()
  const { toast } = useToast()
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [comments, setComments] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function handleDecision(changeId: string, decision: "approve" | "reject") {
    const comment = comments[changeId]
    setError(null)
    setBusyId(changeId)
    try {
      await submitApproval(changeId, decision, comment, isCabMember)
      toast({
        title: decision === "approve"
          ? t(language, "approvals.toast.approved")
          : t(language, "approvals.toast.rejected"),
        description: decision === "approve"
          ? t(language, "approvals.toast.approvedDesc")
          : t(language, "approvals.toast.rejectedDesc"),
        variant: decision === "approve" ? "success" : "error",
      })
      startTransition(() => router.refresh())
    } catch (err) {
      const message = err instanceof Error ? err.message : "An error occurred"
      setError(message)
      toast({ title: "Error", description: message, variant: "error" })
    } finally {
      setBusyId(null)
    }
  }

  const needsCabQuorum = (riskLevel: string) =>
    riskLevel === "high" || riskLevel === "emergency"

  const cabApprovedCount = (approvals: Approval[]) =>
    new Set(
      approvals
        .filter((a) => a.isCab && a.decision === "approve")
        .map((a) => a.approverId)
    ).size

  return (
    <div className="grid gap-4">
      {error && (
        <div className="rounded-lg border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      {changes.map((c) => {
        const requesterLabel = c.requester.name ?? c.requester.email
        const isHigh = needsCabQuorum(c.riskLevel)
        const cabCount = cabApprovedCount(c.approvals)
        const isBusy = busyId === c.id || isPending

        return (
          <Card key={c.id} className="border-border/80 bg-card/95">
            <CardHeader className="pb-2">
              <CardTitle className="text-base line-clamp-2 sm:line-clamp-1">
                <Link href={`/changes/${c.id}`} className="hover:underline">
                  {c.title}
                </Link>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{c.description}</p>
              <div className="mt-2 text-xs text-muted-foreground">
                {t(language, "approvals.requestedBy")} {requesterLabel} •{" "}
                {new Date(c.createdAt).toLocaleString()}
              </div>
              {isHigh && (
                <div className="mt-2 text-xs text-muted-foreground">
                  CAB quorum: {cabCount}/2 approvals
                </div>
              )}
              <div className="mt-3">
                <textarea
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  rows={2}
                  placeholder="Comment (required for rejection)"
                  value={comments[c.id] ?? ""}
                  onChange={(e) =>
                    setComments((prev) => ({ ...prev, [c.id]: e.target.value }))
                  }
                />
              </div>
              <div className="mt-3 flex flex-col sm:flex-row gap-2">
                <Button
                  onClick={() => handleDecision(c.id, "approve")}
                  disabled={isBusy}
                  variant="default"
                  className="w-full sm:w-auto"
                >
                  {t(language, "approvals.approve")}
                </Button>
                <Button
                  onClick={() => handleDecision(c.id, "reject")}
                  disabled={isBusy}
                  variant="destructive"
                  className="w-full sm:w-auto"
                >
                  {t(language, "approvals.reject")}
                </Button>
              </div>
            </CardContent>
          </Card>
        )
      })}

      {changes.length === 0 && (
        <p className="text-sm text-muted-foreground">{t(language, "approvals.none")}</p>
      )}
    </div>
  )
}
