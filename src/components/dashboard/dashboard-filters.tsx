"use client"

import { t, type Language } from "@/lib/i18n"
import { MultiSelect } from "./multi-select"
import {
  ALL_RISKS, ALL_STATUSES, EMPTY_FILTERS, isActive,
  type DateField, type FilterState,
} from "@/lib/dashboard-filters"

export function DashboardFilters({
  filters, onChange, infraOptions, opcoOptions, total, matched, language,
}: {
  filters: FilterState
  onChange: (f: FilterState) => void
  infraOptions: string[]
  opcoOptions: { slug: string; name: string }[]
  total: number
  matched: number
  language: Language
}) {
  const set = (patch: Partial<FilterState>) => onChange({ ...filters, ...patch })
  const showOpco = opcoOptions.length > 1

  return (
    <div className="mb-3.5 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2">
      <MultiSelect
        label={t(language, "dashboard.filters.infra")}
        options={infraOptions.map((v) => ({ value: v, label: v }))}
        selected={filters.infraTypes}
        onChange={(v) => set({ infraTypes: v })}
      />
      {showOpco && (
        <MultiSelect
          label={t(language, "dashboard.filters.opco")}
          options={opcoOptions.map((o) => ({ value: o.slug, label: o.name }))}
          selected={filters.opcoSlugs}
          onChange={(v) => set({ opcoSlugs: v })}
        />
      )}
      <MultiSelect
        label={t(language, "dashboard.filters.status")}
        options={ALL_STATUSES.map((v) => ({ value: v, label: v }))}
        selected={filters.statuses}
        onChange={(v) => set({ statuses: v as FilterState["statuses"] })}
      />
      <MultiSelect
        label={t(language, "dashboard.filters.risk")}
        options={ALL_RISKS.map((v) => ({ value: v, label: v }))}
        selected={filters.risks}
        onChange={(v) => set({ risks: v as FilterState["risks"] })}
      />

      <select
        aria-label={t(language, "dashboard.filters.date")}
        value={filters.dateField}
        onChange={(e) => set({ dateField: e.target.value as DateField })}
        className="h-9 rounded-md border border-border bg-card px-2 text-sm"
      >
        <option value="planned">{t(language, "dashboard.filters.planned")}</option>
        <option value="created">{t(language, "dashboard.filters.created")}</option>
        <option value="sla">{t(language, "dashboard.filters.sla")}</option>
      </select>
      <input
        type="date"
        aria-label={t(language, "dashboard.filters.from")}
        value={filters.dateFrom ?? ""}
        onChange={(e) => set({ dateFrom: e.target.value || null })}
        className="h-9 rounded-md border border-border bg-card px-2 text-sm"
      />
      <input
        type="date"
        aria-label={t(language, "dashboard.filters.to")}
        value={filters.dateTo ?? ""}
        onChange={(e) => set({ dateTo: e.target.value || null })}
        className="h-9 rounded-md border border-border bg-card px-2 text-sm"
      />

      <span className="ml-auto text-xs text-muted-foreground tabular-nums">
        {matched} {t(language, "dashboard.filters.of")} {total}
      </span>
      {isActive(filters) && (
        <button
          onClick={() => onChange(EMPTY_FILTERS)}
          className="h-9 rounded-md px-3 text-sm font-medium text-primary hover:bg-muted"
        >
          {t(language, "dashboard.filters.clear")}
        </button>
      )}
    </div>
  )
}
