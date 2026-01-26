"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import Image from "next/image"
import { useEffect, useMemo, useState } from "react"
import { useStore } from "@/lib/store"
import { cn } from "@/lib/utils"
import { t } from "@/lib/i18n"
import {
  ArrowLeft,
  BarChart3,
  ClipboardList,
  FileClock,
  GitCompare,
  Home,
  KeyRound,
  LogOut,
  Settings,
  ShieldCheck,
  UserCircle2,
  UsersRound,
  Users,
  Bell,
  Lock,
  Plug,
  SlidersHorizontal,
} from "lucide-react"
import { Toaster } from "@/components/ui/toaster"

const navGroups = [
  {
    labelKey: "nav.core",
    items: [
      { href: "/", labelKey: "nav.dashboard", icon: BarChart3 },
      { href: "/requests", labelKey: "nav.requests", icon: ClipboardList },
      { href: "/approvals", labelKey: "nav.approvals", icon: ShieldCheck },
      { href: "/changes", labelKey: "nav.changes", icon: GitCompare },
      { href: "/audits", labelKey: "nav.audits", icon: FileClock },
    ],
  },
  {
    labelKey: "nav.userManagement",
    items: [
      { href: "/users", labelKey: "nav.users", icon: Users },
      { href: "/teams", labelKey: "nav.teams", icon: UsersRound },
    ],
  },
  {
    labelKey: "nav.settings",
    items: [
      { href: "/settings/profile", labelKey: "nav.settingsProfile", icon: UserCircle2 },
      { href: "/settings/preferences", labelKey: "nav.settingsPreferences", icon: SlidersHorizontal },
      { href: "/settings/notifications", labelKey: "nav.settingsNotifications", icon: Bell },
      { href: "/settings/security", labelKey: "nav.settingsSecurity", icon: Lock },
      { href: "/settings/integrations", labelKey: "nav.settingsIntegrations", icon: Plug },
    ],
  },
]

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [newPassword, setNewPassword] = useState("")
  const [preferencesOpen, setPreferencesOpen] = useState(false)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const { changes, currentUser, logout, updatePassword, theme, language, fontScale, setTheme, setLanguage, setFontScale } =
    useStore()
  const translate = (key: string) => t(language, key)
  const myRequests = currentUser ? changes.filter((c) => c.requester === currentUser.id) : []
  const pendingApprovals = currentUser
    ? changes.filter(
        (c) =>
          c.status === "pending" &&
          (c.assignees.length === 0 || c.assignees.includes(currentUser.id))
      )
    : []
  const canManageUsers = currentUser?.permissions.includes("admin")
  const effectiveNavGroups = useMemo(
    () => navGroups.filter((group) => group.labelKey !== "nav.userManagement" || canManageUsers),
    [canManageUsers]
  )
  const flatNavItems = effectiveNavGroups.flatMap((group) => group.items)
  const currentNav = flatNavItems.find((item) => item.href === pathname)
  const breadcrumbs = currentNav
    ? [
        { href: "/", labelKey: "nav.dashboard" },
        ...(currentNav.href === "/" ? [] : [currentNav]),
      ]
    : [{ href: "/", labelKey: "nav.dashboard" }]

  useEffect(() => {
    if (typeof window === "undefined") return
    const savedTheme = window.localStorage.getItem("csq-theme") as
      | "system"
      | "light"
      | "dark"
      | null
    const savedLang = window.localStorage.getItem("csq-lang") as "en" | "fr" | "sw" | null
    const savedScale = window.localStorage.getItem("csq-font-scale")
    if (savedTheme) setTheme(savedTheme)
    if (savedLang) setLanguage(savedLang)
    if (savedScale) setFontScale(Number(savedScale))
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return
    window.localStorage.setItem("csq-theme", theme)
    const root = document.documentElement
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const applyTheme = () => {
      const shouldDark = theme === "dark" || (theme === "system" && media.matches)
      root.classList.toggle("dark", shouldDark)
    }
    applyTheme()
    if (theme === "system") {
      media.addEventListener("change", applyTheme)
      return () => media.removeEventListener("change", applyTheme)
    }
    return undefined
  }, [theme])

  useEffect(() => {
    if (typeof window === "undefined") return
    window.localStorage.setItem("csq-lang", language)
    document.documentElement.lang = language
  }, [language])

  useEffect(() => {
    if (typeof window === "undefined") return
    const value = Number.isFinite(fontScale) ? fontScale : 1
    window.localStorage.setItem("csq-font-scale", String(value))
    document.documentElement.style.setProperty("--app-font-scale", String(value))
  }, [fontScale])

  if (pathname === "/login") {
    return (
      <div className="min-h-screen bg-background text-foreground">
        {children}
        <Toaster />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AuthGuard pathname={pathname} />
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle_at_center,_rgba(59,130,246,0.14)_0,_rgba(56,189,248,0.08)_45%,_transparent_70%)]" />
        <div className="absolute -bottom-52 right-[-10%] h-[480px] w-[640px] rounded-full bg-[radial-gradient(circle_at_center,_rgba(16,185,129,0.12)_0,_rgba(234,179,8,0.08)_50%,_transparent_70%)]" />
      </div>

      <div className="flex min-h-screen">
        <aside className="hidden lg:flex lg:w-72 lg:flex-col lg:border-r lg:border-border lg:bg-card/80 lg:backdrop-blur">
          <div className="px-6 py-6">
            <div className="flex items-center gap-3">
              <Image src="/csquared-icon.png" alt="CSquared logo" width={36} height={36} className="rounded-full" />
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">CSquared</div>
                <div className="mt-1 text-lg font-semibold">Change Management</div>
              </div>
            </div>
          </div>
          <nav className="flex-1 px-3">
            {effectiveNavGroups.map((group) => (
              <div key={group.labelKey} className="mb-4">
                <div className="px-4 pb-2 text-xs uppercase tracking-[0.2em] text-slate-400">
                  {translate(group.labelKey)}
                </div>
                {group.items.map((item) => {
                  const active = pathname === item.href
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "mb-1 flex items-center gap-3 rounded-xl px-4 py-3 text-sm transition",
                        active ? "bg-slate-900 text-white shadow-sm" : "text-foreground hover:bg-slate-100"
                      )}
                    >
                      <item.icon className={cn("h-4 w-4", active ? "text-white" : "text-muted-foreground")} />
                      <span className="flex-1">{translate(item.labelKey)}</span>
                      {item.href === "/requests" && (
                        <span className={cn("rounded-full px-2 py-0.5 text-xs", active ? "bg-white/20" : "bg-muted")}>
                          {myRequests.length}
                        </span>
                      )}
                      {item.href === "/approvals" && (
                        <span className={cn("rounded-full px-2 py-0.5 text-xs", active ? "bg-white/20" : "bg-muted")}>
                          {pendingApprovals.length}
                        </span>
                      )}
                    </Link>
                  )
                })}
              </div>
            ))}
          </nav>
          <div className="px-6 py-6 text-xs text-muted-foreground">{translate("sidebar.live")}</div>
        </aside>

        <div className="flex flex-1 flex-col">
          <header className="sticky top-0 z-20 border-b border-border bg-card/80 backdrop-blur">
            <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
              <div className="flex items-center gap-3">
                <Image src="/csquared-icon.png" alt="CSquared logo" width={32} height={32} className="rounded-full" />
                <div>
                  <div className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
                    {translate("header.control")}
                  </div>
                  <div className="text-lg font-semibold">{translate("header.title")}</div>
                </div>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <button
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-card text-foreground transition hover:bg-muted"
                  onClick={() => router.back()}
                  aria-label="Go back"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <Link
                  href="/"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-card text-foreground transition hover:bg-muted"
                  aria-label="Go home"
                >
                  <Home className="h-4 w-4" />
                </Link>
                <label className="flex cursor-pointer items-center gap-2 rounded-full bg-card px-2 py-1">
                  <span className="relative h-8 w-8 overflow-hidden rounded-full bg-slate-100">
                    {avatarUrl ? (
                      <Image src={avatarUrl} alt="Profile" fill className="object-cover" />
                    ) : (
                      <UserCircle2 className="h-8 w-8 text-slate-400" />
                    )}
                  </span>
                  <span className="text-sm">{currentUser?.name ?? "Guest"}</span>
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
                <div className="relative">
                  <button
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-card text-foreground transition hover:bg-muted"
                    aria-label="Profile menu"
                    onClick={() => setProfileMenuOpen((prev) => !prev)}
                  >
                    <UserCircle2 className="h-4 w-4" />
                  </button>
                  {profileMenuOpen && (
                    <div className="absolute right-0 top-11 w-44 rounded-xl border border-border bg-card p-2 text-sm shadow-lg">
                      <button
                        className="w-full rounded-lg px-3 py-2 text-left text-foreground hover:bg-muted"
                        onClick={() => {
                          setPreferencesOpen(true)
                          setProfileMenuOpen(false)
                        }}
                      >
                        {translate("prefs.user")}
                      </button>
                      <button
                        className="w-full rounded-lg px-3 py-2 text-left text-foreground hover:bg-muted"
                        onClick={() => setProfileMenuOpen(false)}
                      >
                        {translate("prefs.settings")}
                      </button>
                    </div>
                  )}
                </div>
                {currentUser && (
                  <>
                    <button
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-card text-foreground transition hover:bg-muted"
                      onClick={() => setPasswordOpen(true)}
                      aria-label="Change password"
                    >
                      <KeyRound className="h-4 w-4" />
                    </button>
                    <button
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-card text-foreground transition hover:bg-muted"
                      onClick={() => {
                        logout()
                        router.push("/login")
                      }}
                      aria-label="Log out"
                    >
                      <LogOut className="h-4 w-4" />
                    </button>
                  </>
                )}
                <button
                  className="inline-flex items-center gap-2 rounded-full bg-card px-3 py-2 text-xs text-muted-foreground transition hover:bg-muted"
                  onClick={() => setPreferencesOpen(true)}
                  aria-label="Preferences"
                >
                  <Settings className="h-4 w-4" />
                  {translate("prefs.title")}
                </button>
              </div>
            </div>
            <div className="border-t border-slate-100 lg:hidden">
              <nav className="flex gap-2 overflow-x-auto px-4 py-3 text-sm">
                {flatNavItems.map((item) => {
                  const active = pathname === item.href
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "flex items-center gap-2 rounded-full px-4 py-2 text-sm",
                        active ? "bg-slate-900 text-white" : "bg-card text-foreground"
                      )}
                    >
                      <item.icon className="h-4 w-4" />
                      {translate(item.labelKey)}
                    </Link>
                  )
                })}
              </nav>
            </div>
            <div className="border-t border-slate-100">
              <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-3 text-xs text-muted-foreground">
                {breadcrumbs.map((crumb, index) => (
                  <span key={crumb.href} className="flex items-center gap-2">
                    <Link
                      href={crumb.href}
                      className={cn(
                        "transition hover:text-slate-800",
                        index === breadcrumbs.length - 1 && "font-semibold text-slate-800"
                      )}
                    >
                      {translate(crumb.labelKey)}
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
      {passwordOpen && currentUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl">
            <h3 className="text-lg font-semibold">Change Password</h3>
            <p className="mt-1 text-sm text-muted-foreground">Set a new password for your account.</p>
            <input
              type="password"
              placeholder="New password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              className="mt-4 h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-full px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setPasswordOpen(false)
                  setNewPassword("")
                }}
              >
                Cancel
              </button>
              <button
                className="rounded-full bg-slate-900 px-4 py-2 text-sm text-white"
                onClick={() => {
                  if (!newPassword) return
                  updatePassword(currentUser.id, newPassword)
                  setPasswordOpen(false)
                  setNewPassword("")
                }}
              >
                Update
              </button>
            </div>
          </div>
        </div>
      )}
      {preferencesOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">{translate("prefs.title")}</h3>
              <button
                className="text-sm text-muted-foreground hover:text-slate-800"
                onClick={() => setPreferencesOpen(false)}
              >
                {translate("prefs.close")}
              </button>
            </div>
            <div className="mt-4 space-y-4">
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-slate-400">
                  {translate("prefs.theme")}
                </div>
                <select
                  value={theme}
                  onChange={(event) => setTheme(event.target.value as "system" | "light" | "dark")}
                  className="mt-2 h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
                  aria-label="Theme"
                >
                  <option value="system">{translate("prefs.system")}</option>
                  <option value="light">{translate("prefs.light")}</option>
                  <option value="dark">{translate("prefs.dark")}</option>
                </select>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-slate-400">
                  {translate("prefs.language")}
                </div>
                <select
                  value={language}
                  onChange={(event) => setLanguage(event.target.value as "en" | "fr" | "sw")}
                  className="mt-2 h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
                  aria-label="Language"
                >
                  <option value="en">{translate("prefs.language.en")}</option>
                  <option value="fr">{translate("prefs.language.fr")}</option>
                  <option value="sw">{translate("prefs.language.sw")}</option>
                </select>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-slate-400">
                  {translate("prefs.text")}
                </div>
                <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
                  <span>85%</span>
                  <input
                    type="range"
                    min="0.85"
                    max="1.25"
                    step="0.05"
                    value={fontScale}
                    onChange={(event) => setFontScale(Number(event.target.value))}
                    className="flex-1"
                    aria-label="Text size"
                  />
                  <span>125%</span>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  {translate("prefs.text.current")}: {(fontScale * 100).toFixed(0)}%
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function AuthGuard({ pathname }: { pathname: string }) {
  const router = useRouter()
  const { currentUser } = useStore()

  useEffect(() => {
    if (!currentUser && pathname !== "/login") {
      router.push("/login")
    }
  }, [currentUser, pathname, router])

  return null
}
