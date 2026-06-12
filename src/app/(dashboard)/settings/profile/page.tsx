"use client"

import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useSession } from "next-auth/react"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="text-sm">{value || "—"}</div>
    </div>
  )
}

export default function ProfileSettingsPage() {
  const { language } = useStore()
  const { data: session } = useSession()
  const router = useRouter()
  const currentUser = session?.user ?? null

  const opcos = (currentUser?.organizations ?? [])
    .map((o) => (o.roles.length ? `${o.name} · ${o.roles.join(", ")}` : o.name))
    .join("\n")

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t(language, "settings.profile.title")}</h1>
        <p className="text-sm text-muted-foreground">{t(language, "settings.profile.desc")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t(language, "settings.profile.infoTitle")}</CardTitle>
          <CardDescription>{t(language, "settings.profile.infoDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field label={t(language, "users.wizard.name")} value={currentUser?.name ?? ""} />
          <Field label={t(language, "auth.email")} value={currentUser?.email ?? ""} />
          <div className="space-y-1 md:col-span-2">
            <div className="text-xs font-medium text-muted-foreground">{t(language, "settings.profile.location")}</div>
            <div className="whitespace-pre-line text-sm">{opcos || "—"}</div>
          </div>
          <p className="text-xs text-muted-foreground md:col-span-2">{t(language, "settings.profile.managedNote")}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t(language, "settings.security.consoleTitle")}</CardTitle>
          <CardDescription>{t(language, "settings.profile.securityDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => router.push("/settings/security")}>
            {t(language, "settings.profile.securityLink")}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
