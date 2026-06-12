import { Activity, Lock, Globe, TriangleAlert } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { t, type Language } from "@/lib/i18n"
import { RISK_ORDER, type DashboardData } from "@/lib/dashboard-metrics"
import { OpcoBars } from "./charts"
import { RISK_HEX } from "./chart-colors"
const STATUS_DOT: Record<string, string> = {
  draft: "bg-zinc-400", pending: "bg-amber-500", approved: "bg-emerald-500",
  implemented: "bg-blue-500", verified: "bg-violet-500", closed: "bg-slate-500",
}

export interface FeedEvent { id: string; changeId: string; label: string; actor: string; ago: string; tone: string }

export function MonitorView({
  data, blackouts, feed, language,
}: {
  data: DashboardData
  blackouts: { id: string; label: string; scope: string; endsIn: string; amber: boolean }[]
  feed: FeedEvent[]
  language: Language
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-rose-200 bg-rose-50/70 px-4 py-3 dark:border-rose-900/50 dark:bg-rose-950/30">
        <span className="text-2xl font-semibold tabular-nums text-rose-600 dark:text-rose-400">{data.counts.breached}</span>
        <span className="text-sm font-medium text-rose-800 dark:text-rose-300">{t(language, "dashboard.status.breached")}</span>
        <span className="mx-1 h-6 w-px bg-rose-200 dark:bg-rose-900/50" />
        <span className="text-2xl font-semibold tabular-nums text-amber-600 dark:text-amber-400">{data.counts.atRisk}</span>
        <span className="text-sm font-medium text-amber-700 dark:text-amber-300">{t(language, "dashboard.status.atRisk")}</span>
        <span className="ml-auto flex items-center gap-2 text-xs text-rose-700/80 dark:text-rose-300/70">
          <TriangleAlert className="h-4 w-4" /> Both overdue items are high-risk network work
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        {data.monitor.tiles.map((tile) => {
          const total = RISK_ORDER.reduce((a, r) => a + tile.risk[r], 0)
          return (
            <Card key={tile.status} className="border-border/80 bg-card/90">
              <CardContent className="p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold capitalize text-muted-foreground">{tile.status}</span>
                  <span className={`h-2 w-2 rounded-full ${STATUS_DOT[tile.status]}`} />
                </div>
                <div className="my-2 text-3xl font-semibold tabular-nums">{tile.count}</div>
                <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">
                  {total === 0
                    ? <i className="flex-1 bg-border" />
                    : RISK_ORDER.map((r) => tile.risk[r] > 0
                        ? <i key={r} style={{ flex: tile.risk[r], background: RISK_HEX[r] }} /> : null)}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.6fr_1fr]">
        <Card className="border-border/80 bg-card/90">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-sm"><Activity className="h-4 w-4 text-primary" /> {t(language, "dashboard.monitor.liveActivity")}</CardTitle>
          </CardHeader>
          <CardContent className="max-h-64 space-y-0 overflow-auto">
            {feed.length === 0 && <p className="text-sm text-muted-foreground">{t(language, "dashboard.empty")}</p>}
            {feed.map((e) => (
              <div key={e.id} className="flex gap-2.5 border-t border-border/60 py-2 first:border-t-0">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${e.tone}`} />
                <div className="min-w-0">
                  <div className="text-[12.5px] text-foreground"><span className="font-semibold text-primary">{e.changeId}</span> {e.label}</div>
                  <div className="text-[11px] text-muted-foreground">{e.actor} · {e.ago}</div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-border/80 bg-card/90">
          <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Lock className="h-4 w-4 text-primary" /> {t(language, "dashboard.monitor.blackouts")}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              {blackouts.map((b) => (
                <div key={b.id} className="flex items-start gap-2 text-xs">
                  <Lock className={`mt-0.5 h-3.5 w-3.5 ${b.amber ? "text-amber-500" : "text-rose-500"}`} />
                  <div><div className="text-foreground">{b.label}</div><div className="text-muted-foreground">{b.scope} · ends in {b.endsIn}</div></div>
                </div>
              ))}
            </div>
            <div className="border-t border-border/60 pt-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><Globe className="h-4 w-4 text-primary" /> {t(language, "dashboard.monitor.openByOpco")}</div>
              <OpcoBars data={data.report.opcoOpen} />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
