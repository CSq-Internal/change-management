import { Heading, Text } from "@react-email/components"
import * as React from "react"
import { EmailLayout, CtaButton, Pill } from "./layout"
import { EMAIL_BASE_URL } from "./config"
import type { Language } from "@/lib/i18n"

export interface EmergencyAlertEmailProps {
  changeTitle: string
  changeId: string
  requesterName: string
  lang: Language
}

export default function EmergencyAlertEmail({
  changeTitle, changeId, requesterName, lang,
}: EmergencyAlertEmailProps) {
  const fr = lang === "fr"
  return (
    <EmailLayout lang={lang} previewText={fr ? `Changement d'urgence : « ${changeTitle} »` : `Emergency change: "${changeTitle}"`}>
      <Heading className="text-xl font-semibold text-slate-900">
        <Pill tone="emergency">{fr ? "Urgence" : "Emergency"}</Pill>
      </Heading>
      <Text className="text-sm text-slate-700">
        <strong>{requesterName}</strong>{" "}
        {fr
          ? <>a soumis un changement <strong>d&apos;urgence</strong> : <strong>{changeTitle}</strong>.</>
          : <>submitted an <strong>emergency</strong> change: <strong>{changeTitle}</strong>.</>}
      </Text>
      <CtaButton href={`${EMAIL_BASE_URL}/changes/${changeId}`}>
        {fr ? "Examiner le changement" : "Review the change"}
      </CtaButton>
    </EmailLayout>
  )
}
