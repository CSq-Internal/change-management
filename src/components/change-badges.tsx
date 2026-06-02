const STATUS_COLORS: Record<string, string> = {
  draft: "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200",
  pending: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  approved: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  rejected: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
  implemented: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  verified: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
  closed: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
}
const RISK_COLORS: Record<string, string> = {
  low: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  high: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  emergency: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
}
const PILL = "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize"

export function StatusPill({ status }: { status: string }) {
  return <span className={`${PILL} ${STATUS_COLORS[status] ?? "bg-muted text-muted-foreground"}`}>{status}</span>
}
export function RiskPill({ risk }: { risk: string }) {
  return <span className={`${PILL} ${RISK_COLORS[risk] ?? "bg-muted text-muted-foreground"}`}>{risk}</span>
}
