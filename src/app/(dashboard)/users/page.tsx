"use client"

import { useMemo, useState } from "react"
import { useStore } from "@/lib/store"
import type { Country, Permission, Role } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/toaster"

const countries: Country[] = ["Ghana", "Uganda", "Mauritius", "Liberia", "Togo", "DRC"]
const roles: Role[] = ["requester", "approver", "auditor", "admin"]
const permissions: Permission[] = ["admin", "read", "write", "approve", "audit"]

export default function UsersPage() {
  const { users, teams, addUser } = useStore()
  const { toast } = useToast()
  const [wizardOpen, setWizardOpen] = useState(false)
  const [step, setStep] = useState(0)
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [country, setCountry] = useState<Country>("Ghana")
  const [role, setRole] = useState<Role>("requester")
  const [selectedPermissions, setSelectedPermissions] = useState<Permission[]>(["read"])
  const [selectedTeams, setSelectedTeams] = useState<string[]>([])

  const steps = useMemo(
    () => [
      { title: "Profile", description: "Basic information and OpCo assignment." },
      { title: "Access", description: "Role and permissions for the user." },
      { title: "Teams", description: "Associate the user to teams." },
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
  }

  const closeWizard = () => {
    setWizardOpen(false)
    resetWizard()
  }

  const nextStep = () => setStep((prev) => Math.min(prev + 1, steps.length - 1))
  const prevStep = () => setStep((prev) => Math.max(prev - 1, 0))

  const submit = () => {
    if (!name || !email) {
      toast({
        title: "Missing details",
        description: "Name and email are required to onboard a user.",
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
    })
    toast({
      title: "User onboarded",
      description: `${name} has been added to ${country}.`,
      variant: "success",
    })
    closeWizard()
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">User Management</h1>
          <p className="text-sm text-slate-500">Onboard and manage users across OpCos.</p>
        </div>
        <Button onClick={() => setWizardOpen(true)}>Onboard User</Button>
      </div>

      <Card className="border-slate-200/80 bg-white/95">
        <CardHeader>
          <CardTitle className="text-base">Active Users</CardTitle>
          <CardDescription>{users.length} total users onboarded.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {users.length === 0 && <p className="text-sm text-slate-500">No users yet.</p>}
          {users.map((user) => (
            <div key={user.id} className="rounded-xl border border-slate-200/70 bg-slate-50 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium">{user.name}</div>
                  <div className="text-xs text-slate-500">{user.email}</div>
                </div>
                <div className="text-xs text-slate-500">
                  {user.country} • {user.role}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-600">
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
          <Card className="w-full max-w-2xl border-slate-200/80 bg-white/95">
            <CardHeader className="space-y-1">
              <CardTitle className="text-xl">Onboard User</CardTitle>
              <CardDescription>{steps[step].description}</CardDescription>
              <div className="mt-2 flex gap-2 text-xs text-slate-500">
                {steps.map((item, index) => (
                  <span
                    key={item.title}
                    className={`rounded-full px-3 py-1 ${
                      index === step ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {index + 1}. {item.title}
                  </span>
                ))}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {step === 0 && (
                <div className="grid gap-4">
                  <Input placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
                  <Input placeholder="Work email" value={email} onChange={(e) => setEmail(e.target.value)} />
                  <div>
                    <label className="text-sm font-medium">OpCo / Country</label>
                    <select
                      className="mt-2 h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
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
                    <label className="text-sm font-medium">Role</label>
                    <select
                      className="mt-2 h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
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
                    <label className="text-sm font-medium">Permissions</label>
                    <div className="mt-2 grid gap-2 text-sm text-slate-700 md:grid-cols-2">
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
                </div>
              )}

              {step === 2 && (
                <div className="grid gap-4">
                  {teams.length === 0 ? (
                    <p className="text-sm text-slate-500">No teams yet. Create teams first, then assign them here.</p>
                  ) : (
                    <div>
                      <label className="text-sm font-medium">Teams</label>
                      <div className="mt-2 grid gap-2 text-sm text-slate-700">
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
                  Cancel
                </Button>
                <div className="flex gap-2">
                  {step > 0 && (
                    <Button variant="outline" onClick={prevStep}>
                      Back
                    </Button>
                  )}
                  {step < steps.length - 1 ? (
                    <Button onClick={nextStep}>Next</Button>
                  ) : (
                    <Button onClick={submit}>Finish</Button>
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
