import type { ChangeStatusName, NamedCount, RiskLevelName } from "@/lib/dashboard-metrics"
import { RISK_ORDER } from "@/lib/dashboard-metrics"

// SVG fills must be concrete colors; keep all chart hex isolated here.
const RISK_HEX: Record<RiskLevelName, string> = {
  low: "#10b981", medium: "#f59e0b", high: "#f97316", emergency: "#f43f5e",
}
const STATUS_HEX: Record<ChangeStatusName, string> = {
  draft: "#a1a1aa", pending: "#f59e0b", approved: "#10b981", rejected: "#f43f5e",
  implemented: "#3b82f6", verified: "#8b5cf6", closed: "#64748b",
}

export function RiskDonut({ riskOpen }: { riskOpen: Record<RiskLevelName, number> }) {
  const segs = RISK_ORDER.map((r) => ({ r, v: riskOpen[r] })).filter((s) => s.v > 0)
  const total = segs.reduce((a, s) => a + s.v, 0)
  const size = 120, R = 46, cx = size / 2, C = 2 * Math.PI * R
  const segsWithOffset = segs.map((s, i) => {
    const len = (s.v / total) * C
    const offset = segs.slice(0, i).reduce((a, x) => a + (x.v / total) * C, 0)
    return { ...s, len, offset }
  })
  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {segsWithOffset.map((s) => (
          <circle key={s.r} cx={cx} cy={cx} r={R} fill="none" stroke={RISK_HEX[s.r]} strokeWidth={15}
            strokeDasharray={`${s.len.toFixed(2)} ${(C - s.len).toFixed(2)}`} strokeDashoffset={-s.offset}
            transform={`rotate(-90 ${cx} ${cx})`} />
        ))}
        <text x={cx} y={cx - 2} textAnchor="middle" className="fill-foreground text-xl font-semibold tabular-nums">{total}</text>
        <text x={cx} y={cx + 14} textAnchor="middle" className="fill-muted-foreground text-[11px]">open</text>
      </svg>
      <ul className="flex-1 space-y-1">
        {segs.map((s) => (
          <li key={s.r} className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5 capitalize">
              <i className="h-2.5 w-2.5 rounded-sm" style={{ background: RISK_HEX[s.r] }} />{s.r}
            </span>
            <b className="font-semibold tabular-nums text-foreground">{s.v}</b>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function OpcoBars({ data }: { data: NamedCount[] }) {
  const max = Math.max(1, ...data.map((d) => d.count))
  return (
    <div className="space-y-1.5">
      {data.map((d) => (
        <div key={d.name} className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="w-16 shrink-0 truncate font-medium text-foreground">{d.name}</span>
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <i className="block h-full rounded-full bg-primary" style={{ width: `${(d.count / max) * 100}%` }} />
          </span>
          <span className="w-4 text-right tabular-nums">{d.count}</span>
        </div>
      ))}
    </div>
  )
}

export function StatusDistribution({ counts }: { counts: Record<ChangeStatusName, number> }) {
  const order: ChangeStatusName[] = ["pending", "approved", "implemented", "verified", "draft", "rejected", "closed"]
  const segs = order.map((s) => ({ s, n: counts[s] })).filter((x) => x.n > 0)
  const total = segs.reduce((a, x) => a + x.n, 0)
  return (
    <div>
      <div className="mb-2 flex h-3.5 overflow-hidden rounded-md bg-muted">
        {segs.map((x) => <i key={x.s} style={{ flex: x.n, background: STATUS_HEX[x.s] }} />)}
      </div>
      <div className="flex flex-wrap gap-2.5 text-[11px] text-muted-foreground">
        {segs.map((x) => (
          <span key={x.s} className="flex items-center gap-1.5 capitalize">
            <i className="h-2 w-2 rounded-sm" style={{ background: STATUS_HEX[x.s] }} />{x.s}{" "}
            <b className="font-semibold text-foreground tabular-nums">{x.n}</b>
          </span>
        ))}
      </div>
      <span className="sr-only">{total} total</span>
    </div>
  )
}
