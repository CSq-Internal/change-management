"use client"

import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useStore } from "@/lib/store"
import { ArrowUpRight, BellDot, CalendarClock, ClipboardList, FileClock, ShieldCheck } from "lucide-react"

export default function Home() {
  const { changes, currentUser, role } = useStore()
  const myRequests = currentUser ? changes.filter((c) => c.requester === currentUser.id) : []
  const pendingApprovals = currentUser
    ? changes.filter(
        (c) =>
          c.status === "pending" &&
          (c.assignees.length === 0 || c.assignees.includes(currentUser.id))
      )
    : []
  const activeChanges = changes.filter((c) => ["approved", "implemented", "verified"].includes(c.status))
  const recent = [...changes].slice(0, 4)

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <section className="space-y-6">
        <Card className="border-slate-200/80 bg-white/90">
          <CardHeader className="gap-2">
            <CardTitle className="text-2xl">Welcome back, {currentUser?.name ?? "there"}.</CardTitle>
            <CardDescription>
              Track the full technical change lifecycle from request to audit, with live counts tied to your role.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            <Link
              href="/requests"
              className="inline-flex h-9 items-center justify-center rounded-md bg-blue-600 px-4 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              New Change Request
            </Link>
            <Link
              href="/approvals"
              className="inline-flex h-9 items-center justify-center rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              Review Approvals
            </Link>
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-2">
          <Card className="border-slate-200/80 bg-white/90">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">My Requests</CardTitle>
              <ClipboardList className="h-4 w-4 text-slate-500" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold">{myRequests.length}</div>
              <p className="mt-2 text-sm text-slate-500">Submitted by you across all environments.</p>
            </CardContent>
          </Card>
          <Card className="border-slate-200/80 bg-white/90">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Pending Approvals</CardTitle>
              <ShieldCheck className="h-4 w-4 text-slate-500" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold">{pendingApprovals.length}</div>
              <p className="mt-2 text-sm text-slate-500">
                {role === "approver" || role === "admin"
                  ? "Requests waiting for your decision."
                  : "Switch to approver to view your queue."}
              </p>
            </CardContent>
          </Card>
          <Card className="border-slate-200/80 bg-white/90">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Active Changes</CardTitle>
              <CalendarClock className="h-4 w-4 text-slate-500" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold">{activeChanges.length}</div>
              <p className="mt-2 text-sm text-slate-500">Approved or being implemented.</p>
            </CardContent>
          </Card>
          <Card className="border-slate-200/80 bg-white/90">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Audit Ready</CardTitle>
              <FileClock className="h-4 w-4 text-slate-500" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold">{changes.filter((c) => c.status === "closed").length}</div>
              <p className="mt-2 text-sm text-slate-500">Closed changes with full trail.</p>
            </CardContent>
          </Card>
        </div>

        <Card className="border-slate-200/80 bg-white/90">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">Live Activity</CardTitle>
              <CardDescription>Most recent updates across requests and approvals.</CardDescription>
            </div>
            <BellDot className="h-4 w-4 text-slate-500" />
          </CardHeader>
          <CardContent>
            {recent.length === 0 && <p className="text-sm text-slate-500">No requests yet.</p>}
            <div className="space-y-3">
              {recent.map((change) => (
                <div key={change.id} className="flex items-center justify-between rounded-xl border border-slate-200/70 bg-slate-50 px-4 py-3">
                  <div>
                    <div className="text-sm font-medium">{change.title}</div>
                    <div className="text-xs text-slate-500">{new Date(change.updatedAt).toLocaleString()}</div>
                  </div>
                  <span className="rounded-full bg-white px-3 py-1 text-xs capitalize text-slate-600">
                    {change.status}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      <aside className="space-y-6">
        <Card className="border-slate-200/80 bg-white/90">
          <CardHeader>
            <CardTitle className="text-base">Your Queue</CardTitle>
            <CardDescription>Focus on what needs action now.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-600">
            <div className="flex items-center justify-between rounded-lg border border-slate-200/70 bg-slate-50 px-3 py-2">
              <span>Awaiting approval</span>
              <span className="font-semibold text-slate-900">{pendingApprovals.length}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-slate-200/70 bg-slate-50 px-3 py-2">
              <span>In progress</span>
              <span className="font-semibold text-slate-900">{activeChanges.length}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-slate-200/70 bg-slate-50 px-3 py-2">
              <span>Requests raised</span>
              <span className="font-semibold text-slate-900">{myRequests.length}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 bg-white/90">
          <CardHeader>
            <CardTitle className="text-base">Quick Actions</CardTitle>
            <CardDescription>Jump straight into the workflow.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Link href="/requests" className="flex items-center justify-between rounded-xl border border-slate-200/70 bg-slate-50 px-4 py-3 text-sm text-slate-700 transition hover:border-slate-300">
              Start a new request
              <ArrowUpRight className="h-4 w-4 text-slate-500" />
            </Link>
            <Link href="/approvals" className="flex items-center justify-between rounded-xl border border-slate-200/70 bg-slate-50 px-4 py-3 text-sm text-slate-700 transition hover:border-slate-300">
              Review approvals
              <ArrowUpRight className="h-4 w-4 text-slate-500" />
            </Link>
          </CardContent>
        </Card>
      </aside>
    </div>
  )
}
