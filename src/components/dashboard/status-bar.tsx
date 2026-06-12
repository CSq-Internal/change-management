import { Lock } from "lucide-react"
import { t } from "@/lib/i18n"
import type { Language } from "@/lib/i18n"
import type { DashboardData } from "@/lib/dashboard-metrics"

export function StatusBar({
  counts, blackouts, language,
}: { counts: DashboardData["counts"]; blackouts: number; language: Language }) {
  const severity = counts.breached > 0 ? "red" : counts.atRisk > 0 ? "amber" : "ok"
  const border =
    severity === "red" ? "border-l-rose-500" : severity === "amber" ? "border-l-amber-500" : "border-l-emerald-500"
  const dot =
    severity === "red" ? "bg-rose-500" : severity === "amber" ? "bg-amber-500" : "bg-emerald-500"

  return (
    <div className={`mb-3 flex flex-wrap items-center rounded-xl border border-l-[3px] ${border} border-border bg-card/90 px-4 py-2.5 shadow-sm`}>
      <span className="flex items-center gap-2 pr-4 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span className={`h-2 w-2 rounded-full ${dot}`} />{t(language, "dashboard.status.live")}
      </span>
      {counts.breached > 0 && (
        <Seg><b className="text-rose-600 dark:text-rose-400">{counts.breached}</b> {t(language, "dashboard.status.breached")}</Seg>
      )}
      {counts.atRisk > 0 && (
        <Seg><b className="text-amber-600 dark:text-amber-400">{counts.atRisk}</b> {t(language, "dashboard.status.atRisk")}</Seg>
      )}
      {counts.emergency > 0 && (
        <Seg><b className="text-cyan-700 dark:text-cyan-300">{counts.emergency}</b> {t(language, "dashboard.status.emergency")}</Seg>
      )}
      {counts.overdueRetro > 0 && (
        <Seg><b className="text-rose-600 dark:text-rose-400">{counts.overdueRetro}</b> {t(language, "dashboard.status.overdueRetro")}</Seg>
      )}
      <Seg><Lock className="h-3.5 w-3.5 text-rose-500" />{blackouts} {t(language, "dashboard.status.blackouts")}</Seg>
      {severity === "ok" && counts.breached === 0 && counts.atRisk === 0 && (
        <Seg><span className="font-semibold text-emerald-700 dark:text-emerald-400">✓ {t(language, "dashboard.status.allClear")}</span></Seg>
      )}
    </div>
  )
}

function Seg({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 border-l border-border px-4 text-[12.5px] text-muted-foreground first-of-type:border-l-0 [&_b]:font-mono [&_b]:text-[15px] [&_b]:font-semibold tabular-nums">
      {children}
    </span>
  )
}
