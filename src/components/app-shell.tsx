"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import Image from "next/image"
import { useEffect, useMemo, useState } from "react"
import { useSession, signOut as nextAuthSignOut } from "next-auth/react"
import { useStore } from "@/lib/store"
import { canManageAnyOpCo } from "@/lib/permissions"
import { OpCoSwitcher } from "@/components/opco-switcher"
import { cn } from "@/lib/utils"
import { t } from "@/lib/i18n"
import { resolveTheme, THEME_STORAGE_KEY, type ThemeMode } from "@/lib/theme"
import {
  ArrowLeft,
  BarChart3,
  ClipboardList,
  FileClock,
  GitCompare,
  Home,
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
  CalendarDays,
  FileText,
  LineChart,
  Shield,
  Sliders,
  FileStack,
  Map,
  BellRing,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
  X,
  Sun,
  Moon,
  Gavel,
  ArrowLeftRight,
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
      { href: "/cab", labelKey: "nav.cab", icon: Gavel },
      { href: "/delegations", labelKey: "nav.delegations", icon: ArrowLeftRight },
    ],
  },
  {
    labelKey: "nav.insights",
    items: [
      { href: "/change-details", labelKey: "nav.changeDetails", icon: FileText },
      { href: "/calendar", labelKey: "nav.calendar", icon: CalendarDays },
      { href: "/risk-register", labelKey: "nav.riskRegister", icon: Shield },
      { href: "/audit-exports", labelKey: "nav.auditExports", icon: FileStack },
      { href: "/approval-matrix", labelKey: "nav.approvalMatrix", icon: Sliders },
      { href: "/reports", labelKey: "nav.reports", icon: LineChart },
      { href: "/notifications/history", labelKey: "nav.notificationHistory", icon: BellRing },
      { href: "/automation", labelKey: "nav.automation", icon: Map },
    ],
  },
  {
    labelKey: "nav.settings",
    items: [
      { href: "/settings/profile", labelKey: "nav.settingsProfile", icon: UserCircle2 },
      { href: "/settings/preferences", labelKey: "nav.settingsPreferences", icon: SlidersHorizontal },
      { href: "/settings/approvers", labelKey: "nav.settingsApprovers", icon: ShieldCheck },
      { href: "/settings/notifications", labelKey: "nav.settingsNotifications", icon: Bell },
      { href: "/settings/alerts", labelKey: "nav.settingsAlerts", icon: Bell },
      { href: "/settings/security", labelKey: "nav.settingsSecurity", icon: Lock },
      { href: "/settings/integrations", labelKey: "nav.settingsIntegrations", icon: Plug },
    ],
  },
]

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [preferencesOpen, setPreferencesOpen] = useState(false)
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("light")
  const { data: session } = useSession()
  const currentUser = session?.user ?? null
  const {
    language,
    fontScale,
    theme,
    setLanguage,
    setFontScale,
    setTheme,
  } = useStore()
  const translate = (key: string) => t(language, key)
  // TODO: wire to server data (Phase 4)
  const myRequests: unknown[] = []
  // TODO: wire to server data (Phase 4)
  const pendingApprovals: unknown[] = []
  const showAdminNav = session
    ? canManageAnyOpCo(session.user.organizations, session.user.realmRoles)
    : false
  const effectiveNavGroups = useMemo(
    () => navGroups.filter((group) => group.labelKey !== "nav.userManagement" || showAdminNav),
    [showAdminNav]
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
    const savedLang = window.localStorage.getItem("csq-language") as "en" | "fr" | null
    const savedScale = window.localStorage.getItem("csq-font-scale")
    if (savedLang) setLanguage(savedLang)
    if (savedScale) setFontScale(Number(savedScale))
    const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null
    if (savedTheme) setTheme(savedTheme)
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return
    window.localStorage.setItem("csq-language", language)
    document.documentElement.lang = language
  }, [language])

  useEffect(() => {
    if (typeof window === "undefined") return
    const value = Number.isFinite(fontScale) ? fontScale : 1
    window.localStorage.setItem("csq-font-scale", String(value))
    document.documentElement.style.setProperty("--app-font-scale", String(value))
  }, [fontScale])

  useEffect(() => {
    if (typeof window === "undefined") return
    const mql = window.matchMedia("(prefers-color-scheme: dark)")
    const apply = () => {
      const resolved = resolveTheme(theme, mql.matches)
      document.documentElement.classList.toggle("dark", resolved === "dark")
      document.documentElement.style.colorScheme = resolved
      setResolvedTheme(resolved)
    }
    apply()
    if (theme === "system") {
      mql.addEventListener("change", apply)
      return () => mql.removeEventListener("change", apply)
    }
  }, [theme])

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
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle_at_center,_rgba(59,130,246,0.14)_0,_rgba(56,189,248,0.08)_45%,_transparent_70%)]" />
        <div className="absolute -bottom-52 right-[-10%] h-[480px] w-[640px] rounded-full bg-[radial-gradient(circle_at_center,_rgba(16,185,129,0.12)_0,_rgba(234,179,8,0.08)_50%,_transparent_70%)]" />
      </div>

      <div className="flex min-h-screen">
        <aside
          className={cn(
            "hidden lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:h-screen lg:flex-col lg:border-r lg:border-border lg:bg-card/80 lg:backdrop-blur lg:z-40",
            sidebarCollapsed ? "lg:w-20" : "lg:w-72"
          )}
        >
          <div className="sticky top-0 z-10 bg-card/90 px-6 py-6 backdrop-blur">
            <div className={cn("flex items-center gap-3", sidebarCollapsed ? "justify-center" : "justify-between")}>
              <div className={cn("flex items-center gap-3", sidebarCollapsed && "justify-center")}>
                <Image src="/csquared-icon.png" alt="CSquared logo" width={36} height={36} className="rounded-full" />
                {!sidebarCollapsed && (
                  <div>
                    <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">CSquared</div>
                    <div className="mt-1 text-lg font-semibold">Change Management</div>
                  </div>
                )}
              </div>
              <button
                className="hidden h-9 w-9 items-center justify-center rounded-full bg-card text-foreground transition hover:bg-muted lg:inline-flex"
                onClick={() => setSidebarCollapsed((prev) => !prev)}
                aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              >
                {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <nav className="flex-1 overflow-y-auto px-3 pb-6">
            {effectiveNavGroups.map((group) => (
              <div key={group.labelKey} className="mb-4">
                {!sidebarCollapsed && (
                  <button
                    className="flex w-full items-center justify-between px-4 pb-2 text-xs uppercase tracking-[0.2em] text-muted-foreground"
                    onClick={() =>
                      setCollapsedGroups((prev) => ({
                        ...prev,
                        [group.labelKey]: !prev[group.labelKey],
                      }))
                    }
                    aria-label={`Toggle ${translate(group.labelKey)}`}
                  >
                    <span>{translate(group.labelKey)}</span>
                    <span className="text-sm">{collapsedGroups[group.labelKey] ? "▸" : "▾"}</span>
                  </button>
                )}
                {!collapsedGroups[group.labelKey] &&
                  group.items.map((item) => {
                    const active = pathname === item.href
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={cn(
                          "mb-1 flex items-center gap-3 rounded-xl px-4 py-3 text-sm transition",
                          active ? "bg-slate-900 text-white shadow-sm" : "text-foreground hover:bg-muted"
                        )}
                      >
                        <item.icon className={cn("h-4 w-4", active ? "text-white" : "text-muted-foreground")} />
                        {!sidebarCollapsed && (
                          <>
                            <span className="flex-1">{translate(item.labelKey)}</span>
                            {item.href === "/requests" && (
                              <span
                                className={cn(
                                  "rounded-full px-2 py-0.5 text-xs",
                                  active ? "bg-white/20" : "bg-muted"
                                )}
                              >
                                {myRequests.length}
                              </span>
                            )}
                            {item.href === "/approvals" && (
                              <span
                                className={cn(
                                  "rounded-full px-2 py-0.5 text-xs",
                                  active ? "bg-white/20" : "bg-muted"
                                )}
                              >
                                {pendingApprovals.length}
                              </span>
                            )}
                          </>
                        )}
                      </Link>
                    )
                  })}
              </div>
            ))}
          </nav>
          {!sidebarCollapsed && (
            <div className="px-6 py-6 text-xs text-muted-foreground">{translate("sidebar.live")}</div>
          )}
        </aside>

        <div className="flex flex-1 flex-col">
          <header
            className={cn(
              "sticky top-0 z-20 border-b border-border bg-card/80 backdrop-blur",
              sidebarCollapsed ? "lg:pl-20" : "lg:pl-72"
            )}
          >
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
              <div className="flex items-center gap-3">
                <button
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-card text-foreground transition hover:bg-muted lg:hidden"
                  onClick={() => setMobileNavOpen(true)}
                  aria-label="Open navigation"
                >
                  <Menu className="h-4 w-4" />
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm sm:gap-3">
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
                <OpCoSwitcher />
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
                <button
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-card text-foreground transition hover:bg-muted"
                  onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
                  aria-label={translate("theme.toggle")}
                >
                  {resolvedTheme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                </button>
                <div className="relative">
                  <button
                    className="inline-flex items-center gap-2 rounded-full bg-card px-3 py-2 text-xs text-muted-foreground transition hover:bg-muted"
                    onClick={() => setSettingsMenuOpen((prev) => !prev)}
                    aria-label="Preferences"
                  >
                    <Settings className="h-4 w-4" />
                    <span className="hidden sm:inline">{translate("prefs.title")}</span>
                  </button>
                  {settingsMenuOpen && (
                    <div className="absolute right-0 top-11 w-44 rounded-xl border border-border bg-card p-2 text-sm shadow-lg">
                      <button
                        className="w-full rounded-lg px-3 py-2 text-left text-foreground hover:bg-muted"
                        onClick={() => {
                          setPreferencesOpen(true)
                          setSettingsMenuOpen(false)
                        }}
                      >
                        {translate("prefs.user")}
                      </button>
                      <Link
                        href="/settings/profile"
                        className="block w-full rounded-lg px-3 py-2 text-left text-foreground hover:bg-muted"
                        onClick={() => setSettingsMenuOpen(false)}
                      >
                        {translate("prefs.settings")}
                      </Link>
                    </div>
                  )}
                </div>
                {currentUser && (
                  <button
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-card text-foreground transition hover:bg-muted"
                    onClick={() => nextAuthSignOut({ callbackUrl: "/login" })}
                    aria-label="Log out"
                  >
                    <LogOut className="h-4 w-4" />
                  </button>
                )}
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

          {mobileNavOpen && (
            <div className="fixed inset-0 z-40 bg-black/40 lg:hidden">
              <div className="absolute left-0 top-0 h-full w-72 bg-card px-4 py-5 shadow-xl">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Image src="/csquared-icon.png" alt="CSquared logo" width={32} height={32} className="rounded-full" />
                    <div className="text-sm font-semibold">CSquared</div>
                  </div>
                  <button
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-card text-foreground transition hover:bg-muted"
                    onClick={() => setMobileNavOpen(false)}
                    aria-label="Close navigation"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <nav className="mt-6 space-y-4">
                  {effectiveNavGroups.map((group) => (
                    <div key={group.labelKey}>
                      <button
                        className="flex w-full items-center justify-between px-2 pb-2 text-xs uppercase tracking-[0.2em] text-muted-foreground"
                        onClick={() =>
                          setCollapsedGroups((prev) => ({
                            ...prev,
                            [group.labelKey]: !prev[group.labelKey],
                          }))
                        }
                      >
                        <span>{translate(group.labelKey)}</span>
                        <span className="text-sm">{collapsedGroups[group.labelKey] ? "▸" : "▾"}</span>
                      </button>
                      {!collapsedGroups[group.labelKey] &&
                        group.items.map((item) => {
                          const active = pathname === item.href
                          return (
                            <Link
                              key={item.href}
                              href={item.href}
                              className={cn(
                                "mb-1 flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition",
                                active ? "bg-slate-900 text-white shadow-sm" : "text-foreground hover:bg-muted"
                              )}
                              onClick={() => setMobileNavOpen(false)}
                            >
                              <item.icon className={cn("h-4 w-4", active ? "text-white" : "text-muted-foreground")} />
                              <span className="flex-1">{translate(item.labelKey)}</span>
                            </Link>
                          )
                        })}
                    </div>
                  ))}
                </nav>
              </div>
            </div>
          )}

          <main
            className={cn(
              "mx-auto w-full max-w-6xl flex-1 px-4 py-8",
              sidebarCollapsed ? "lg:pl-20" : "lg:pl-72"
            )}
          >
            {children}
          </main>
        </div>
      </div>
      <Toaster />
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
                  {translate("prefs.language")}
                </div>
                <select
                  value={language}
                  onChange={(event) => setLanguage(event.target.value as "en" | "fr")}
                  className="mt-2 h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
                  aria-label="Language"
                >
                  <option value="en">{translate("prefs.language.en")}</option>
                  <option value="fr">{translate("prefs.language.fr")}</option>
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
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-slate-400">
                  {translate("prefs.theme")}
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {(["light", "dark", "system"] as ThemeMode[]).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setTheme(mode)}
                      className={`h-9 rounded-md border text-sm ${
                        theme === mode
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border bg-background text-muted-foreground hover:bg-muted"
                      }`}
                      aria-pressed={theme === mode}
                    >
                      {translate(`prefs.theme.${mode}`)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
