import { Heading, Text, Section } from "@react-email/components"
import * as React from "react"
import { EmailLayout, CtaButton } from "./layout"
import { EMAIL_BASE_URL } from "./config"
import type { Language } from "@/lib/i18n"

export interface InvitationEmailProps {
  name: string
  tempPassword?: string
  existingIdentity: boolean
  federated?: boolean
  assignments: Array<{ opcoSlug: string; role: string }>
  lang: Language
}

export default function InvitationEmail({
  name, tempPassword, existingIdentity, federated, assignments, lang,
}: InvitationEmailProps) {
  const fr = lang === "fr"
  const passwordCopy = federated
    ? (fr
        ? "Connectez-vous avec Google (« Se connecter avec Google ») en utilisant votre adresse @csquared.com. Aucun mot de passe n'est requis."
        : 'Sign in with Google ("Sign in with Google") using your @csquared.com address. No password is required.')
    : existingIdentity
    ? (fr
        ? "Utilisez votre mot de passe Keycloak existant. Si vous ne le connaissez pas, demandez à un administrateur de le réinitialiser dans Keycloak."
        : "Use your existing Keycloak password. If you do not know it, ask an administrator to reset it in Keycloak.")
    : (fr
        ? `Votre mot de passe temporaire est : ${tempPassword ?? "ChangeMe123!"}. Il pourra vous être demandé de le changer à la première connexion.`
        : `Your temporary password is: ${tempPassword ?? "ChangeMe123!"}. You may be asked to change it on first sign-in.`)

  return (
    <EmailLayout lang={lang} previewText={fr ? "Vous êtes invité à CSquared CMS" : "You're invited to CSquared CMS"}>
      <Heading className="text-xl font-semibold text-slate-900">
        {fr ? `Bonjour ${name},` : `Hi ${name},`}
      </Heading>
      <Text className="text-sm text-slate-700">
        {fr ? "Vous avez été invité à CSquared CMS." : "You have been invited to CSquared CMS."}
      </Text>
      <Text className="text-sm text-slate-700">{passwordCopy}</Text>
      <CtaButton href={`${EMAIL_BASE_URL}/login`}>
        {fr ? "Se connecter à CSquared CMS" : "Sign in to CSquared CMS"}
      </CtaButton>
      <Section className="mt-6">
        <Text className="text-sm font-medium text-slate-900">{fr ? "Vos accès :" : "Your access:"}</Text>
        {assignments.map((a, i) => (
          <Text key={i} className="my-1 text-sm text-slate-700">
            • {a.role} {fr ? "dans" : "in"} {a.opcoSlug}
          </Text>
        ))}
      </Section>
    </EmailLayout>
  )
}
