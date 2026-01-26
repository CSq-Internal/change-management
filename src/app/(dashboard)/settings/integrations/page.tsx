"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"

export default function IntegrationsSettingsPage() {
  const { language } = useStore()
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t(language, "settings.integrations.title")}</h1>
        <p className="text-sm text-muted-foreground">{t(language, "settings.integrations.desc")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t(language, "settings.integrations.commTitle")}</CardTitle>
          <CardDescription>{t(language, "settings.integrations.commDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button variant="outline">Slack</Button>
          <Button variant="outline">Microsoft Teams</Button>
          <Button variant="outline">Email Hooks</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t(language, "settings.integrations.itsmTitle")}</CardTitle>
          <CardDescription>{t(language, "settings.integrations.itsmDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button variant="outline">Jira Service Management</Button>
          <Button variant="outline">ServiceNow</Button>
          <Button variant="outline">Azure DevOps</Button>
        </CardContent>
      </Card>
    </div>
  )
}
