import { Heading, Text } from "@react-email/components"
import * as React from "react"
import { EmailLayout, CtaButton, Pill } from "./layout"
import { EMAIL_BASE_URL } from "./config"
import type { Language } from "@/lib/i18n"

export interface ApprovalRequestEmailProps {
  approverName: string
  changeTitle: string
  requesterName: string
  riskLevel: string
  lang: Language
}

export default function ApprovalRequestEmail({
  approverName, changeTitle, requesterName, riskLevel, lang,
}: ApprovalRequestEmailProps) {
  const fr = lang === "fr"
  return (
    <EmailLayout lang={lang} previewText={fr ? `Approuver « ${changeTitle} »` : `Approve "${changeTitle}"`}>
      <Heading className="text-xl font-semibold text-slate-900">
        {fr ? `Bonjour ${approverName},` : `Hi ${approverName},`}
      </Heading>
      <Text className="text-sm text-slate-700">
        <strong>{requesterName}</strong>{" "}
        {fr ? "a soumis un changement à " : "submitted a "}
        <Pill tone={riskLevel}>{fr ? `risque ${riskLevel}` : `${riskLevel} risk`}</Pill>{" "}
        {fr ? "à approuver : " : "change to approve: "}
        <strong>{changeTitle}</strong>.
      </Text>
      <CtaButton href={`${EMAIL_BASE_URL}/approvals`}>
        {fr ? "Examiner et approuver" : "Review & Approve"}
      </CtaButton>
    </EmailLayout>
  )
}
