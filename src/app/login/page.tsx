"use client"

import { signIn } from "next-auth/react"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

export default function LoginPage() {
  const { language } = useStore()

  async function handleLogin() {
    await signIn("keycloak", { callbackUrl: "/" })
  }

  async function handleGoogleLogin() {
    // Brokered Google sign-in: kc_idp_hint tells Keycloak to skip its own login
    // screen and redirect straight to the Google identity provider.
    await signIn("keycloak", { callbackUrl: "/" }, { kc_idp_hint: "google" })
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <Card className="w-full max-w-md border-border/80 bg-card/95">
        <CardHeader className="space-y-2 text-center">
          <CardTitle className="text-2xl">{t(language, "auth.signIn")}</CardTitle>
          <CardDescription>{t(language, "auth.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button variant="outline" className="w-full" onClick={handleGoogleLogin}>
            {t(language, "auth.google")}
          </Button>
          <div className="text-center text-xs uppercase tracking-[0.2em] text-slate-400">
            {t(language, "auth.or")}
          </div>
          <Button className="w-full" onClick={handleLogin}>
            {t(language, "auth.submit")}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
