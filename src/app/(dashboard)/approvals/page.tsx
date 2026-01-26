"use client"

import { useStore } from "@/lib/store"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toaster"

export default function Approvals() {
  const { changes, update, currentUser, role } = useStore()
  const { toast } = useToast()
  const pending = currentUser
    ? changes.filter(
        (c) =>
          c.status === "pending" &&
          (c.assignees.length === 0 || c.assignees.includes(currentUser.id))
      )
    : []
  const canApprove = role === "approver" || role === "admin"

  if (!currentUser) {
    return (
      <Card className="border-slate-200/80 bg-white/95">
        <CardHeader>
          <CardTitle className="text-base">Sign In Required</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-600">Log in to access approval queues.</p>
        </CardContent>
      </Card>
    )
  }

  if (!canApprove) {
    return (
      <Card className="border-slate-200/80 bg-white/95">
        <CardHeader>
          <CardTitle className="text-base">Approver Access Required</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-600">
            Switch to approver or admin role to view requests awaiting your decision.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="grid gap-4">
      {pending.map((c) => (
        <Card key={c.id} className="border-slate-200/80 bg-white/95">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{c.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-600">{c.description}</p>
            <div className="mt-2 text-xs text-slate-500">
              Requested by {c.requester} • {new Date(c.createdAt).toLocaleString()}
            </div>
            <div className="mt-3 flex gap-2">
              <Button
                onClick={() => {
                  update(c.id, { status: "approved" })
                  toast({ title: "Approved", description: "The request moved to active changes.", variant: "success" })
                }}
                variant="default"
              >
                Approve
              </Button>
              <Button
                onClick={() => {
                  update(c.id, { status: "rejected" })
                  toast({ title: "Rejected", description: "The request was rejected.", variant: "error" })
                }}
                variant="destructive"
              >
                Reject
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
      {pending.length === 0 && <p className="text-sm text-slate-500">No pending approvals.</p>}
    </div>
  )
}
