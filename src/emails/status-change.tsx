import { Heading, Text } from "@react-email/components"
import * as React from "react"
import { EmailLayout, CtaButton, Pill } from "./layout"
import { EMAIL_BASE_URL } from "./config"
import type { Language } from "@/lib/i18n"

export interface StatusChangeEmailProps {
  name: string
  changeTitle: string
  status: string // already localized display value
  tone: string   // "approved" | "rejected" | "info"
  lang: Language
}

export default function StatusChangeEmail({
  name, changeTitle, status, tone, lang,
}: StatusChangeEmailProps) {
  const fr = lang === "fr"
  return (
    <EmailLayout lang={lang} previewText={fr ? `« ${changeTitle} » : ${status}` : `"${changeTitle}": ${status}`}>
      <Heading className="text-xl font-semibold text-slate-900">
        {fr ? `Bonjour ${name},` : `Hi ${name},`}
      </Heading>
      <Text className="text-sm text-slate-700">
        {fr ? "Votre demande de changement " : "Your change request "}
        <strong>{changeTitle}</strong>{" "}
        {fr ? "est maintenant : " : "is now: "}
        <Pill tone={tone}>{status}</Pill>
      </Text>
      <CtaButton href={`${EMAIL_BASE_URL}/changes`}>
        {fr ? "Voir les changements" : "View Changes"}
      </CtaButton>
    </EmailLayout>
  )
}
