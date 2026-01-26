"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"

export default function NotificationSettingsPage() {
  const { language } = useStore()
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t(language, "settings.notifications.title")}</h1>
        <p className="text-sm text-muted-foreground">{t(language, "settings.notifications.desc")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t(language, "settings.notifications.emailTitle")}</CardTitle>
          <CardDescription>{t(language, "settings.notifications.emailDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button>{t(language, "settings.notifications.on")}</Button>
          <Button variant="outline">{t(language, "settings.notifications.off")}</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t(language, "settings.notifications.digestTitle")}</CardTitle>
          <CardDescription>{t(language, "settings.notifications.digestDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button variant="outline">{t(language, "settings.notifications.daily")}</Button>
          <Button>{t(language, "settings.notifications.weekly")}</Button>
          <Button variant="outline">{t(language, "settings.notifications.off")}</Button>
        </CardContent>
      </Card>
    </div>
  )
}
