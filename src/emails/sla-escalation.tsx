import { Heading, Text } from "@react-email/components"
import * as React from "react"
import { EmailLayout, CtaButton, Pill } from "./layout"
import { EMAIL_BASE_URL } from "./config"
import type { Language } from "@/lib/i18n"

export interface SlaEscalationEmailProps {
  changeTitle: string
  changeId: string
  level: number
  riskLevel: string
  tier: string // already localized
  lang: Language
}

export default function SlaEscalationEmail({
  changeTitle, changeId, level, riskLevel, tier, lang,
}: SlaEscalationEmailProps) {
  const fr = lang === "fr"
  return (
    <EmailLayout lang={lang} previewText={fr ? `Dépassement de SLA : « ${changeTitle} »` : `SLA breach: "${changeTitle}"`}>
      <Heading className="text-xl font-semibold text-slate-900">
        <Pill tone="sla">{fr ? `SLA niveau ${level}` : `SLA level ${level}`}</Pill>
      </Heading>
      <Text className="text-sm text-slate-700">
        {fr ? "Le changement à " : "The "}
        <Pill tone={riskLevel}>{fr ? `risque ${riskLevel}` : `${riskLevel} risk`}</Pill>{" "}
        <strong>{changeTitle}</strong>{" "}
        {fr
          ? <>a dépassé son SLA d&apos;approbation et a été escaladé au niveau <strong>{tier}</strong>.</>
          : <>has breached its approval SLA and was escalated to <strong>{tier}</strong> level.</>}
      </Text>
      <CtaButton href={`${EMAIL_BASE_URL}/changes/${changeId}`}>
        {fr ? "Examiner le changement" : "Review the change"}
      </CtaButton>
    </EmailLayout>
  )
}
