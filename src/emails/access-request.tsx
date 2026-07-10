import { Heading, Text } from "@react-email/components"
import * as React from "react"
import { EmailLayout, CtaButton } from "./layout"
import { EMAIL_BASE_URL } from "./config"
import type { Language } from "@/lib/i18n"

export interface AccessRequestEmailProps {
  adminName: string
  requesterName: string
  opcoName: string
  lang: Language
}

export default function AccessRequestEmail({
  adminName, requesterName, opcoName, lang,
}: AccessRequestEmailProps) {
  const fr = lang === "fr"
  return (
    <EmailLayout lang={lang} previewText={fr ? `Demande d'accès : ${opcoName}` : `Access request: ${opcoName}`}>
      <Heading className="text-xl font-semibold text-slate-900">
        {fr ? `Bonjour ${adminName},` : `Hi ${adminName},`}
      </Heading>
      <Text className="text-sm text-slate-700">
        <strong>{requesterName}</strong>{" "}
        {fr ? "a demandé l'accès à " : "requested access to "}
        <strong>{opcoName}</strong>.
      </Text>
      <CtaButton href={`${EMAIL_BASE_URL}/access-requests`}>
        {fr ? "Examiner la demande" : "Review the request"}
      </CtaButton>
    </EmailLayout>
  )
}
