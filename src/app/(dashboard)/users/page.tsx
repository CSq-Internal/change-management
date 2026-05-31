"use client"

import { useMemo, useState } from "react"
import { useSession } from "next-auth/react"
import { useStore } from "@/lib/store"
import { canManageUsers } from "@/lib/permissions"
import type { AppUser, Country, Permission, Role, Team } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/toaster"
import { t } from "@/lib/i18n"

const countries: Country[] = ["Ghana", "Uganda", "Mauritius", "Liberia", "Togo"]
const roles: Role[] = ["requester", "approver", "auditor", "admin"]
const permissions: Permission[] = ["admin", "read", "write", "approve", "audit"]

export default function UsersPage() {
  const { language } = useStore()
  const { data: session } = useSession()
  // TODO: wire to server data (Phase 4)
  const users: AppUser[] = []
  const teams: Team[] = []
  const addUser = (_user: Omit<AppUser, "id" | "createdAt">) => {}
  const isAdmin = session
    ? canManageUsers(
        session.user.organizations,
        session.user.realmRoles,
        session.user.organizations[0]?.alias ?? ""
      )
    : false
  const { toast } = useToast()
  const [wizardOpen, setWizardOpen] = useState(false)
  const [step, setStep] = useState(0)
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [country, setCountry] = useState<Country>("Ghana")
  const [role, setRole] = useState<Role>("requester")
  const [selectedPermissions, setSelectedPermissions] = useState<Permission[]>(["read"])
  const [selectedTeams, setSelectedTeams] = useState<string[]>([])
  const [defaultPassword, setDefaultPassword] = useState("")

  const steps = useMemo(
    () => [
      { titleKey: "users.wizard.stepProfile", descKey: "users.wizard.profileDesc" },
      { titleKey: "users.wizard.stepAccess", descKey: "users.wizard.accessDesc" },
      { titleKey: "users.wizard.stepTeams", descKey: "users.wizard.teamsDesc" },
    ],
    []
  )

  const resetWizard = () => {
    setStep(0)
    setName("")
    setEmail("")
    setCountry("Ghana")
    setRole("requester")
    setSelectedPermissions(["read"])
    setSelectedTeams([])
    setDefaultPassword("")
  }

  const closeWizard = () => {
    setWizardOpen(false)
    resetWizard()
  }

  const nextStep = () => setStep((prev) => Math.min(prev + 1, steps.length - 1))
  const prevStep = () => setStep((prev) => Math.max(prev - 1, 0))

  const submit = () => {
    if (!isAdmin) {
      toast({
        title: t(language, "users.adminOnly"),
        description: t(language, "users.adminOnlyDesc"),
        variant: "error",
      })
      return
    }
    if (!name || !email) {
      toast({
        title: t(language, "users.toast.missing"),
        description: t(language, "users.toast.missingDesc"),
        variant: "error",
      })
      return
    }
    addUser({
      name,
      email,
      role,
      permissions: selectedPermissions,
      country,
      teamIds: selectedTeams,
      password: defaultPassword || "ChangeMe123!",
    })
    toast({
      title: t(language, "users.toast.created"),
      description: `${name} - ${country}`,
      variant: "success",
    })
    closeWizard()
  }

  return (
    <div className="space-y-6">
      {!isAdmin && (
        <Card className="border-border/80 bg-card/95">
          <CardHeader>
            <CardTitle className="text-base">{t(language, "users.adminOnly")}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{t(language, "users.adminOnlyDesc")}</p>
          </CardContent>
        </Card>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t(language, "users.title")}</h1>
          <p className="text-sm text-muted-foreground">{t(language, "users.desc")}</p>
        </div>
        <Button onClick={() => setWizardOpen(true)} disabled={!isAdmin}>
          {t(language, "users.onboard")}
        </Button>
      </div>

      <Card className="border-border/80 bg-card/95">
        <CardHeader>
          <CardTitle className="text-base">{t(language, "users.active")}</CardTitle>
          <CardDescription>
            {users.length} {t(language, "users.total")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {users.length === 0 && <p className="text-sm text-muted-foreground">{t(language, "users.none")}</p>}
          {users.map((user) => (
            <div key={user.id} className="rounded-xl border border-border/70 bg-muted px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium">{user.name}</div>
                  <div className="text-xs text-muted-foreground">{user.email}</div>
                </div>
                <div className="text-xs text-muted-foreground">
                  {user.country} • {user.role}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                {user.permissions.map((permission) => (
                  <span key={permission} className="rounded-full bg-white px-2 py-1">
                    {permission}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {wizardOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 px-4 py-10">
          <Card className="w-full max-w-2xl border-border/80 bg-card/95">
            <CardHeader className="space-y-1">
              <CardTitle className="text-xl">{t(language, "users.wizard.title")}</CardTitle>
              <CardDescription>{t(language, steps[step].descKey)}</CardDescription>
              <div className="mt-2 flex gap-2 text-xs text-muted-foreground">
                {steps.map((item, index) => (
                  <span
                    key={item.titleKey}
                    className={`rounded-full px-3 py-1 ${
                      index === step ? "bg-slate-900 text-white" : "bg-slate-100 text-muted-foreground"
                    }`}
                  >
                    {index + 1}. {t(language, item.titleKey)}
                  </span>
                ))}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {step === 0 && (
                <div className="grid gap-4">
                  <Input placeholder={t(language, "users.wizard.name")} value={name} onChange={(e) => setName(e.target.value)} />
                  <Input placeholder={t(language, "users.wizard.email")} value={email} onChange={(e) => setEmail(e.target.value)} />
                  <div>
                    <label className="text-sm font-medium">{t(language, "users.wizard.country")}</label>
                    <select
                      className="mt-2 h-9 w-full rounded-md border border-border bg-white px-3 text-sm"
                      value={country}
                      onChange={(e) => setCountry(e.target.value as Country)}
                    >
                      {countries.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {step === 1 && (
                <div className="grid gap-4">
                  <div>
                    <label className="text-sm font-medium">{t(language, "users.wizard.role")}</label>
                    <select
                      className="mt-2 h-9 w-full rounded-md border border-border bg-white px-3 text-sm"
                      value={role}
                      onChange={(e) => setRole(e.target.value as Role)}
                    >
                      {roles.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-medium">{t(language, "users.wizard.permissions")}</label>
                    <div className="mt-2 grid gap-2 text-sm text-foreground md:grid-cols-2">
                      {permissions.map((permission) => (
                        <label key={permission} className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={selectedPermissions.includes(permission)}
                            onChange={(e) => {
                              setSelectedPermissions((prev) =>
                                e.target.checked
                                  ? [...prev, permission]
                                  : prev.filter((item) => item !== permission)
                              )
                            }}
                          />
                          {permission}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium">{t(language, "users.wizard.password")}</label>
                    <Input
                      type="password"
                      placeholder={t(language, "users.wizard.passwordPlaceholder")}
                      value={defaultPassword}
                      onChange={(e) => setDefaultPassword(e.target.value)}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t(language, "users.wizard.passwordHint")}
                    </p>
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="grid gap-4">
                  {teams.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t(language, "users.wizard.noTeams")}</p>
                  ) : (
                    <div>
                      <label className="text-sm font-medium">{t(language, "users.wizard.teams")}</label>
                      <div className="mt-2 grid gap-2 text-sm text-foreground">
                        {teams.map((team) => (
                          <label key={team.id} className="flex items-center gap-3">
                            <input
                              type="checkbox"
                              checked={selectedTeams.includes(team.id)}
                              onChange={(e) => {
                                setSelectedTeams((prev) =>
                                  e.target.checked
                                    ? [...prev, team.id]
                                    : prev.filter((id) => id !== team.id)
                                )
                              }}
                            />
                            {team.name}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                <Button variant="outline" onClick={closeWizard}>
                  {t(language, "users.wizard.cancel")}
                </Button>
                <div className="flex gap-2">
                  {step > 0 && (
                    <Button variant="outline" onClick={prevStep}>
                      {t(language, "users.wizard.back")}
                    </Button>
                  )}
                  {step < steps.length - 1 ? (
                    <Button onClick={nextStep}>{t(language, "users.wizard.next")}</Button>
                  ) : (
                    <Button onClick={submit}>{t(language, "users.wizard.finish")}</Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
