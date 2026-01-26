"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"

export default function SecuritySettingsPage() {
  const { language } = useStore()
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t(language, "settings.security.title")}</h1>
        <p className="text-sm text-muted-foreground">{t(language, "settings.security.desc")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t(language, "settings.security.mfaTitle")}</CardTitle>
          <CardDescription>{t(language, "settings.security.mfaDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button>{t(language, "settings.security.enableMfa")}</Button>
          <Button variant="outline">{t(language, "settings.security.manageDevices")}</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t(language, "settings.security.sessionsTitle")}</CardTitle>
          <CardDescription>{t(language, "settings.security.sessionsDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button variant="outline">{t(language, "settings.security.viewSessions")}</Button>
          <Button variant="outline">{t(language, "settings.security.signOutAll")}</Button>
        </CardContent>
      </Card>
    </div>
  )
}
