"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toaster"

export default function LoginPage() {
  const router = useRouter()
  const { login, loginWithGoogle, language } = useStore()
  const { toast } = useToast()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)

  const submit = () => {
    if (!email || !password) {
      toast({
        title: t(language, "auth.error.missing"),
        description: t(language, "auth.error.missingDesc"),
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
              >
                {showPassword ? t(language, "auth.hidePassword") : t(language, "auth.showPassword")}
              </button>
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
