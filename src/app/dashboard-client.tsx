"use client"

import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import { ArrowUpRight, BellDot, CalendarClock, ClipboardList, FileClock, ShieldCheck } from "lucide-react"

interface RecentChange {
  id: string
  title: string
  status: string
  updatedAt: Date
}

export interface DashboardProps {
  myRequests: number
  pendingApprovals: number
  activeChanges: number
  auditReady: number
  recent: RecentChange[]
  welcomeName: string
  isApprover: boolean
}

export default function DashboardClient({
  myRequests,
  pendingApprovals,
  activeChanges,
  auditReady,
  recent,
  welcomeName,
  isApprover,
}: DashboardProps) {
  const { language } = useStore()

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] sm:grid-cols-1">
      <section className="space-y-6">
        <Card className="border-border/80 bg-card/90">
          <CardHeader className="gap-2">
            <CardTitle className="text-2xl sm:text-xl">
              {t(language, "dashboard.welcome")} {welcomeName}.
            </CardTitle>
            <CardDescription className="text-sm sm:text-xs">{t(language, "dashboard.subtitle")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            <Link
              href="/requests"
              className="inline-flex h-11 sm:h-10 items-center justify-center rounded-md bg-blue-600 px-5 sm:px-4 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              {t(language, "dashboard.newRequest")}
            </Link>
            <Link
              href="/approvals"
              className="inline-flex h-11 sm:h-10 items-center justify-center rounded-md border border-border px-5 sm:px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              {t(language, "dashboard.reviewApprovals")}
            </Link>
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-2 sm:grid-cols-1">
          <Card className="border-border/80 bg-card/90">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">{t(language, "dashboard.myRequests")}</CardTitle>
              <ClipboardList className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl sm:text-2xl font-semibold">{myRequests}</div>
              <p className="mt-2 text-sm text-muted-foreground">{t(language, "dashboard.myRequestsDesc")}</p>
            </CardContent>
          </Card>
          <Card className="border-border/80 bg-card/90">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">{t(language, "dashboard.pendingApprovals")}</CardTitle>
              <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl sm:text-2xl font-semibold">{pendingApprovals}</div>
              <p className="mt-2 text-sm text-muted-foreground">
                {isApprover
                  ? t(language, "dashboard.pendingApprovalsDesc")
                  : t(language, "dashboard.pendingApprovalsHint")}
              </p>
            </CardContent>
          </Card>
          <Card className="border-border/80 bg-card/90">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">{t(language, "dashboard.activeChanges")}</CardTitle>
              <CalendarClock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl sm:text-2xl font-semibold">{activeChanges}</div>
              <p className="mt-2 text-sm text-muted-foreground">{t(language, "dashboard.activeChangesDesc")}</p>
            </CardContent>
          </Card>
          <Card className="border-border/80 bg-card/90">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">{t(language, "dashboard.auditReady")}</CardTitle>
              <FileClock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl sm:text-2xl font-semibold">{auditReady}</div>
              <p className="mt-2 text-sm text-muted-foreground">{t(language, "dashboard.auditReadyDesc")}</p>
            </CardContent>
          </Card>
        </div>

        <Card className="border-border/80 bg-card/90">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">{t(language, "dashboard.liveActivity")}</CardTitle>
              <CardDescription className="text-sm sm:text-xs">{t(language, "dashboard.liveActivityDesc")}</CardDescription>
            </div>
            <BellDot className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {recent.length === 0 && <p className="text-sm text-muted-foreground">{t(language, "dashboard.noRequests")}</p>}
            <div className="space-y-3">
              {recent.map((change) => (
                <div key={change.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between rounded-xl border border-border/70 bg-muted px-3 sm:px-4 py-3 gap-2">
                  <div>
                    <div className="text-sm font-medium line-clamp-2 sm:line-clamp-1">{change.title}</div>
                    <div className="text-xs text-muted-foreground">{new Date(change.updatedAt).toLocaleString()}</div>
                  </div>
                  <span className="self-start sm:self-auto rounded-full bg-white px-3 py-1 text-xs capitalize text-muted-foreground">
                    {change.status}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      <aside className="space-y-6">
        <Card className="border-border/80 bg-card/90">
          <CardHeader>
            <CardTitle className="text-base">{t(language, "dashboard.queue")}</CardTitle>
            <CardDescription className="text-sm sm:text-xs">{t(language, "dashboard.queueDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <div className="flex items-center justify-between rounded-lg border border-border/70 bg-muted px-3 py-2">
              <span>{t(language, "dashboard.awaitingApproval")}</span>
              <span className="font-semibold text-foreground">{pendingApprovals}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border/70 bg-muted px-3 py-2">
              <span>{t(language, "dashboard.inProgress")}</span>
              <span className="font-semibold text-foreground">{activeChanges}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border/70 bg-muted px-3 py-2">
              <span>{t(language, "dashboard.requestsRaised")}</span>
              <span className="font-semibold text-foreground">{myRequests}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/80 bg-card/90">
          <CardHeader>
            <CardTitle className="text-base">{t(language, "dashboard.quickActions")}</CardTitle>
            <CardDescription className="text-sm sm:text-xs">{t(language, "dashboard.quickActionsDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Link href="/requests" className="flex items-center justify-between rounded-xl border border-border/70 bg-muted px-3 sm:px-4 py-3 text-sm text-foreground transition hover:border-border">
              {t(language, "dashboard.startRequest")}
              <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
            </Link>
            <Link href="/approvals" className="flex items-center justify-between rounded-xl border border-border/70 bg-muted px-3 sm:px-4 py-3 text-sm text-foreground transition hover:border-border">
              {t(language, "dashboard.reviewApprovalsLink")}
              <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
            </Link>
          </CardContent>
        </Card>
      </aside>
    </div>
  )
}
