"use client"

import { useEffect, useRef } from "react"

export interface MultiSelectOption { value: string; label: string }

export function MultiSelect({
  label, options, selected, onChange,
}: {
  label: string
  options: MultiSelectOption[]
  selected: string[]
  onChange: (next: string[]) => void
}) {
  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v])

  // A native <details> only closes from its own summary; close it on a click elsewhere
  // or on Escape, like any other dropdown.
  const ref = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const close = (e: Event) => {
      const el = ref.current
      if (!el?.open) return
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !el.contains(e.target as Node)) el.open = false
    }
    document.addEventListener("pointerdown", close)
    document.addEventListener("keydown", close)
    return () => {
      document.removeEventListener("pointerdown", close)
      document.removeEventListener("keydown", close)
    }
  }, [])

  return (
    <details ref={ref} className="relative">
      <summary className="flex h-9 cursor-pointer list-none items-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm font-medium">
        {label}
        {selected.length > 0 && (
          <span className="rounded-full bg-primary/10 px-1.5 text-xs text-primary tabular-nums">{selected.length}</span>
        )}
      </summary>
      <div className="absolute z-20 mt-1 max-h-64 w-56 overflow-auto rounded-md border border-border bg-card p-1 shadow-md">
        {options.map((o) => (
          <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
            <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
            {o.label}
          </label>
        ))}
      </div>
    </details>
  )
}
