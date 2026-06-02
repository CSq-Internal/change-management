"use client"

import { useState } from "react"
import { LayoutGrid, ListChecks, ChartBar } from "lucide-react"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import type { DashboardData } from "@/lib/dashboard-metrics"
import { StatusBar } from "@/components/dashboard/status-bar"
import { MonitorView, type FeedEvent } from "@/components/dashboard/monitor-view"
import { TriageView } from "@/components/dashboard/triage-view"
import { ReportView } from "@/components/dashboard/report-view"

type TabKey = "monitor" | "triage" | "report"

export interface DashboardProps {
  data: DashboardData
  blackouts: { id: string; label: string; scope: string; endsIn: string; amber: boolean }[]
  feed: FeedEvent[]
  blackoutCount: number
}

export default function DashboardClient({ data, blackouts, feed, blackoutCount }: DashboardProps) {
  const { language } = useStore()
  const [tab, setTab] = useState<TabKey>(() => {
    if (typeof window === "undefined") return "triage"
    const saved = localStorage.getItem("csq-dashboard-tab") as TabKey | null
    return saved === "monitor" || saved === "triage" || saved === "report" ? saved : "triage"
  })
  const select = (k: TabKey) => { setTab(k); localStorage.setItem("csq-dashboard-tab", k) }

  const triageCount = data.triage.overdue.length + data.triage.awaiting.length + data.triage.advance.length

  return (
    <div>
      <StatusBar counts={data.counts} blackouts={blackoutCount} language={language} />

      <div className="mb-3.5 flex gap-1.5 rounded-xl border border-border bg-muted p-1">
        <TabButton active={tab === "monitor"} onClick={() => select("monitor")}>
          <LayoutGrid className="h-4 w-4" /> {t(language, "dashboard.tab.monitor")}
          {data.counts.breached > 0 && <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />}
        </TabButton>
        <TabButton active={tab === "triage"} onClick={() => select("triage")}>
          <ListChecks className="h-4 w-4" /> {t(language, "dashboard.tab.triage")}
          <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[11px] font-mono text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 tabular-nums">{triageCount}</span>
        </TabButton>
        <TabButton active={tab === "report"} onClick={() => select("report")}>
          <ChartBar className="h-4 w-4" /> {t(language, "dashboard.tab.report")}
        </TabButton>
      </div>

      {tab === "monitor" && <MonitorView data={data} blackouts={blackouts} feed={feed} language={language} />}
      {tab === "triage" && <TriageView data={data} language={language} />}
      {tab === "report" && <ReportView data={data} language={language} />}
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-[13px] font-semibold transition-colors ${
        active ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  )
}
