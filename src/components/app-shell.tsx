"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import Image from "next/image"
import { useState } from "react"
import { useStore } from "@/lib/store"
import type { Role } from "@/lib/types"
import { cn } from "@/lib/utils"
import { ArrowLeft, BarChart3, ClipboardList, FileClock, GitCompare, Home, ShieldCheck, UserCircle2 } from "lucide-react"
import { Toaster } from "@/components/ui/toaster"

const navItems = [
  { href: "/", label: "Dashboard", icon: BarChart3 },
  { href: "/requests", label: "Requests", icon: ClipboardList },
  { href: "/approvals", label: "Approvals", icon: ShieldCheck },
  { href: "/changes", label: "Changes", icon: GitCompare },
  { href: "/audits", label: "Audits", icon: FileClock },
]

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const { changes, currentUser, role, setRole } = useStore()
  const myRequests = changes.filter((c) => c.requester === currentUser.id)
  const pendingApprovals = changes.filter(
    (c) =>
      c.status === "pending" &&
      (c.assignees.length === 0 || c.assignees.includes(currentUser.id))
  )
  const currentNav = navItems.find((item) => item.href === pathname)
  const breadcrumbs = currentNav
    ? [{ href: "/", label: "Dashboard" }, ...(currentNav.href === "/" ? [] : [currentNav])]
    : [{ href: "/", label: "Dashboard" }]

  return (
    <div className="min-h-screen bg-[#f6f3ef] text-slate-900">
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle_at_center,_rgba(59,130,246,0.14)_0,_rgba(56,189,248,0.08)_45%,_transparent_70%)]" />
        <div className="absolute -bottom-52 right-[-10%] h-[480px] w-[640px] rounded-full bg-[radial-gradient(circle_at_center,_rgba(16,185,129,0.12)_0,_rgba(234,179,8,0.08)_50%,_transparent_70%)]" />
      </div>

      <div className="flex min-h-screen">
        <aside className="hidden lg:flex lg:w-72 lg:flex-col lg:border-r lg:border-slate-200 lg:bg-white/70 lg:backdrop-blur">
          <div className="px-6 py-6">
            <div className="flex items-center gap-3">
              <Image src="/csquared-icon.png" alt="CSquared logo" width={36} height={36} className="rounded-full" />
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">CSquared</div>
                <div className="mt-1 text-lg font-semibold">Change Management</div>
              </div>
            </div>
          </div>
          <nav className="flex-1 px-3">
            {navItems.map((item) => {
              const active = pathname === item.href
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "mb-1 flex items-center gap-3 rounded-xl px-4 py-3 text-sm transition",
                    active ? "bg-slate-900 text-white shadow-sm" : "text-slate-700 hover:bg-slate-100"
                  )}
                >
                  <item.icon className={cn("h-4 w-4", active ? "text-white" : "text-slate-500")} />
                  <span className="flex-1">{item.label}</span>
                  {item.href === "/requests" && (
                    <span className={cn("rounded-full px-2 py-0.5 text-xs", active ? "bg-white/20" : "bg-slate-200")}>
                      {myRequests.length}
                    </span>
                  )}
                  {item.href === "/approvals" && (
                    <span className={cn("rounded-full px-2 py-0.5 text-xs", active ? "bg-white/20" : "bg-slate-200")}>
                      {pendingApprovals.length}
                    </span>
                  )}
                </Link>
              )
            })}
          </nav>
          <div className="px-6 py-6 text-xs text-slate-500">
            Live updates based on your activity.
          </div>
        </aside>

        <div className="flex flex-1 flex-col">
          <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/80 backdrop-blur">
            <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
              <div className="flex items-center gap-3">
                <Image src="/csquared-icon.png" alt="CSquared logo" width={32} height={32} className="rounded-full" />
                <div>
                  <div className="text-xs uppercase tracking-[0.3em] text-slate-500">Control Center</div>
                  <div className="text-lg font-semibold">Technical Change Request</div>
                </div>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <button
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white text-slate-700 transition hover:bg-slate-50"
                  onClick={() => router.back()}
                  aria-label="Go back"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <Link
                  href="/"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white text-slate-700 transition hover:bg-slate-50"
                  aria-label="Go home"
                >
                  <Home className="h-4 w-4" />
                </Link>
                <label className="flex cursor-pointer items-center gap-2 rounded-full bg-white px-2 py-1">
                  <span className="relative h-8 w-8 overflow-hidden rounded-full bg-slate-100">
                    {avatarUrl ? (
                      <Image src={avatarUrl} alt="Profile" fill className="object-cover" />
                    ) : (
                      <UserCircle2 className="h-8 w-8 text-slate-400" />
                    )}
                  </span>
                  <span className="text-sm">{currentUser.name}</span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      if (!file) return
                      const url = URL.createObjectURL(file)
                      setAvatarUrl(url)
                    }}
                  />
                </label>
                <select
                  value={role}
                  onChange={(event) => setRole(event.target.value as Role)}
                  className="h-10 rounded-full bg-white px-4 text-sm"
                >
                  <option value="requester">Requester</option>
                  <option value="approver">Approver</option>
                  <option value="auditor">Auditor</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>
            <div className="border-t border-slate-100 lg:hidden">
              <nav className="flex gap-2 overflow-x-auto px-4 py-3 text-sm">
                {navItems.map((item) => {
                  const active = pathname === item.href
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "flex items-center gap-2 rounded-full px-4 py-2 text-sm",
                        active ? "bg-slate-900 text-white" : "bg-white text-slate-700"
                      )}
                    >
                      <item.icon className="h-4 w-4" />
                      {item.label}
                    </Link>
                  )
                })}
              </nav>
            </div>
            <div className="border-t border-slate-100">
              <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-3 text-xs text-slate-500">
                {breadcrumbs.map((crumb, index) => (
                  <span key={crumb.href} className="flex items-center gap-2">
                    <Link
                      href={crumb.href}
                      className={cn(
                        "transition hover:text-slate-800",
                        index === breadcrumbs.length - 1 && "font-semibold text-slate-800"
                      )}
                    >
                      {crumb.label}
                    </Link>
                    {index < breadcrumbs.length - 1 && <span className="text-slate-300">/</span>}
                  </span>
                ))}
              </div>
            </div>
          </header>

          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
            {children}
          </main>
        </div>
      </div>
      <Toaster />
    </div>
  )
}
