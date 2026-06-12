"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"

export default function SecurityClient({ accountUrl }: { accountUrl: string | null }) {
  const { language } = useStore()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t(language, "settings.security.title")}</h1>
        <p className="text-sm text-muted-foreground">{t(language, "settings.security.desc")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t(language, "settings.security.consoleTitle")}</CardTitle>
          <CardDescription>{t(language, "settings.security.consoleDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          {accountUrl ? (
            <Button onClick={() => window.open(accountUrl, "_blank", "noopener,noreferrer")}>
              {t(language, "settings.security.openConsole")}
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">{t(language, "settings.security.unavailable")}</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
