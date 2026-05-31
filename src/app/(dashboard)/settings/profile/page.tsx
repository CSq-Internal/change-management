"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useSession } from "next-auth/react"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"

export default function ProfileSettingsPage() {
  const { language } = useStore()
  const { data: session } = useSession()
  const currentUser = session?.user ?? null

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
          <Input placeholder={t(language, "users.wizard.name")} defaultValue={currentUser?.name ?? ""} />
          <Input placeholder={t(language, "auth.email")} defaultValue={currentUser?.email ?? ""} />
          <Input placeholder={t(language, "settings.profile.job")} />
          <Input placeholder={t(language, "settings.profile.location")} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t(language, "settings.profile.visibilityTitle")}</CardTitle>
          <CardDescription>{t(language, "settings.profile.visibilityDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button variant="outline">{t(language, "settings.profile.private")}</Button>
          <Button variant="outline">{t(language, "settings.profile.team")}</Button>
          <Button>{t(language, "settings.profile.company")}</Button>
        </CardContent>
      </Card>
    </div>
  )
}
