"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"

export default function PreferencesSettingsPage() {
  const { language } = useStore()
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t(language, "settings.preferences.title")}</h1>
        <p className="text-sm text-muted-foreground">{t(language, "settings.preferences.desc")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t(language, "settings.preferences.workspaceTitle")}</CardTitle>
          <CardDescription>{t(language, "settings.preferences.workspaceDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button variant="outline">{t(language, "settings.preferences.defaultOpco")}</Button>
          <Button variant="outline">{t(language, "settings.preferences.defaultRisk")}</Button>
          <Button variant="outline">{t(language, "settings.preferences.defaultApprovers")}</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t(language, "settings.preferences.displayTitle")}</CardTitle>
          <CardDescription>{t(language, "settings.preferences.displayDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button variant="outline">{t(language, "settings.preferences.compact")}</Button>
          <Button variant="outline">{t(language, "settings.preferences.comfortable")}</Button>
          <Button>{t(language, "settings.preferences.spacious")}</Button>
        </CardContent>
      </Card>
    </div>
  )
}
