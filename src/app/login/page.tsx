"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toaster"
import { Eye, EyeOff } from "lucide-react"

export default function LoginPage() {
  const router = useRouter()
  const { login, loginWithGoogle, language } = useStore()
  const { toast } = useToast()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)

  const passwordChecks = useMemo(() => {
    return {
      length: password.length >= 8,
      upper: /[A-Z]/.test(password),
      lower: /[a-z]/.test(password),
      number: /[0-9]/.test(password),
      symbol: /[^A-Za-z0-9]/.test(password),
    }
  }, [password])
  const isPolicyMet =
    passwordChecks.length &&
    passwordChecks.upper &&
    passwordChecks.lower &&
    passwordChecks.number &&
    passwordChecks.symbol

  const submit = () => {
    if (!email || !password) {
      toast({
        title: t(language, "auth.error.missing"),
        description: t(language, "auth.error.missingDesc"),
        variant: "error",
      })
      return
    }
    if (!email.toLowerCase().endsWith("@csquared.com")) {
      toast({
        title: t(language, "auth.error.domain"),
        description: t(language, "auth.error.domainDesc"),
        variant: "error",
      })
      return
    }
    if (!isPolicyMet) {
      toast({
        title: t(language, "auth.error.policy"),
        description: t(language, "auth.error.policyDesc"),
        variant: "error",
      })
      return
    }
    const ok = login(email, password)
    if (!ok) {
      toast({
        title: t(language, "auth.error.failed"),
        description: t(language, "auth.error.failedDesc"),
        variant: "error",
      })
      return
    }
    router.push("/")
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <Card className="w-full max-w-md border-border/80 bg-card/95">
        <CardHeader className="space-y-2 text-center">
          <CardTitle className="text-2xl">{t(language, "auth.signIn")}</CardTitle>
          <CardDescription>{t(language, "auth.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              loginWithGoogle()
              router.push("/")
            }}
          >
            {t(language, "auth.google")}
          </Button>
          <div className="text-center text-xs uppercase tracking-[0.2em] text-slate-400">
            {t(language, "auth.or")}
          </div>
          <div className="space-y-3">
            <Input placeholder={t(language, "auth.email")} value={email} onChange={(e) => setEmail(e.target.value)} />
            <div className="relative">
              <Input
                type={showPassword ? "text" : "password"}
                placeholder={t(language, "auth.password")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pr-24"
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground hover:text-foreground"
                aria-label={showPassword ? t(language, "auth.hidePassword") : t(language, "auth.showPassword")}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <div className="rounded-md border border-border/60 bg-slate-50/60 p-3 text-xs text-muted-foreground">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                {t(language, "auth.passwordRequirements")}
              </div>
              <div className={passwordChecks.length ? "text-emerald-600" : ""}>
                {t(language, "auth.requirement.length")}
              </div>
              <div className={passwordChecks.upper ? "text-emerald-600" : ""}>
                {t(language, "auth.requirement.upper")}
              </div>
              <div className={passwordChecks.lower ? "text-emerald-600" : ""}>
                {t(language, "auth.requirement.lower")}
              </div>
              <div className={passwordChecks.number ? "text-emerald-600" : ""}>
                {t(language, "auth.requirement.number")}
              </div>
              <div className={passwordChecks.symbol ? "text-emerald-600" : ""}>
                {t(language, "auth.requirement.symbol")}
              </div>
            </div>
            <Button className="w-full" onClick={submit}>
              {t(language, "auth.submit")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
