"use client"

import { create } from "zustand"
import { useCallback } from "react"
import { cn } from "@/lib/utils"

type ToastVariant = "default" | "success" | "error"

interface ToastItem {
  id: string
  title: string
  description?: string
  variant?: ToastVariant
}

interface ToastState {
  toasts: ToastItem[]
  add: (toast: ToastItem) => void
  remove: (id: string) => void
}

const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  add: (toast) => set((state) => ({ toasts: [toast, ...state.toasts] })),
  remove: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}))

function randomId() {
  return Math.random().toString(36).slice(2, 10)
}

export function useToast() {
  const add = useToastStore((state) => state.add)
  const remove = useToastStore((state) => state.remove)

  const toast = useCallback(
    (input: Omit<ToastItem, "id">) => {
      const id = randomId()
      add({ id, ...input })
      setTimeout(() => remove(id), 4000)
    },
    [add, remove]
  )

  return { toast }
}

export function Toaster() {
  const toasts = useToastStore((state) => state.toasts)
  const remove = useToastStore((state) => state.remove)

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-50 flex w-full max-w-sm flex-col gap-3">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            "pointer-events-auto rounded-2xl border border-border bg-card/95 px-4 py-3 shadow-lg backdrop-blur",
            toast.variant === "success" && "border-emerald-400/40 bg-emerald-500/10",
            toast.variant === "error" && "border-rose-400/40 bg-rose-500/10"
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-foreground">{toast.title}</div>
              {toast.description && <div className="text-xs text-muted-foreground">{toast.description}</div>}
            </div>
            <button
              className="text-xs text-muted-foreground transition hover:text-foreground"
              onClick={() => remove(toast.id)}
            >
              Close
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
