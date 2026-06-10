"use client"

import { useEffect, useMemo, useState } from "react"
import { LayoutGrid, ListChecks, ChartBar } from "lucide-react"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import { buildDashboardData, type DashboardChange } from "@/lib/dashboard-metrics"
import { applyFilters, EMPTY_FILTERS, filterToQuery, isActive, queryToFilter, type FilterState } from "@/lib/dashboard-filters"
import { StatusBar } from "@/components/dashboard/status-bar"
import { DashboardFilters } from "@/components/dashboard/dashboard-filters"
import { MatchingChangesList } from "@/components/dashboard/matching-changes-list"
import { MonitorView, type FeedEvent } from "@/components/dashboard/monitor-view"
import { TriageView } from "@/components/dashboard/triage-view"
import { ReportView } from "@/components/dashboard/report-view"

type TabKey = "monitor" | "triage" | "report"

export interface DashboardProps {
  changes: DashboardChange[]
  now: number
  infraOptions: string[]
  opcoOptions: { slug: string; name: string }[]
  blackouts: { id: string; label: string; scope: string; endsIn: string; amber: boolean }[]
  feed: FeedEvent[]
  blackoutCount: number
}

const FILTERS_KEY = "csq-dashboard-filters"

export default function DashboardClient({ changes, now, infraOptions, opcoOptions, blackouts, feed, blackoutCount }: DashboardProps) {
  const { language } = useStore()
  const [tab, setTab] = useState<TabKey>("triage")
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS)

  // Restore tab + filters AFTER mount so SSR and first client render match (no hydration
  // mismatch). URL query wins over localStorage so shared links reproduce a filtered view.
  useEffect(() => {
    const savedTab = localStorage.getItem("csq-dashboard-tab")
    if (savedTab === "monitor" || savedTab === "triage" || savedTab === "report") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTab(savedTab)
    }
    const qs = window.location.search.replace(/^\?/, "")
    const fromUrl = qs ? queryToFilter(qs) : null
    if (fromUrl && isActive(fromUrl)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFilters(fromUrl)
      return
    }
    const savedFilters = localStorage.getItem(FILTERS_KEY)
    if (savedFilters) {
      try {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setFilters({ ...EMPTY_FILTERS, ...JSON.parse(savedFilters) })
      } catch { /* ignore malformed stored filters */ }
    }
  }, [])

  const select = (k: TabKey) => { setTab(k); localStorage.setItem("csq-dashboard-tab", k) }

  const changeFilters = (f: FilterState) => {
    setFilters(f)
    localStorage.setItem(FILTERS_KEY, JSON.stringify(f))
    const qs = filterToQuery(f)
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname)
  }

  const filtered = useMemo(() => applyFilters(changes, filters), [changes, filters])
  const data = useMemo(() => buildDashboardData(filtered, now), [filtered, now])

  const triageCount = data.triage.overdue.length + data.triage.awaiting.length + data.triage.advance.length

  return (
    <div>
      <StatusBar counts={data.counts} blackouts={blackoutCount} language={language} />

      <DashboardFilters
        filters={filters}
        onChange={changeFilters}
        infraOptions={infraOptions}
        opcoOptions={opcoOptions}
        total={changes.length}
        matched={filtered.length}
        language={language}
      />

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

      <MatchingChangesList rows={filtered} language={language} />
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
