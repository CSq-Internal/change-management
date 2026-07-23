import { Heading, Text, Section, Row, Column, Hr } from "@react-email/components"
import * as React from "react"
import { EmailLayout, CtaButton, Pill } from "./layout"
import type { Language } from "@/lib/i18n"

export interface ChangeEventEmailProps {
  headline: string
  intro: string
  pill?: { tone: string; label: string }
  /** Label/value pairs rendered as a detail table. */
  rows: [string, string][]
  note?: string
  ctaHref: string
  ctaLabel: string
  lang: Language
}

/**
 * One parameterized template behind every notification added by the expansion. The five
 * pre-existing transactional emails keep their bespoke templates.
 */
export default function ChangeEventEmail({
  headline, intro, pill, rows, note, ctaHref, ctaLabel, lang,
}: ChangeEventEmailProps) {
  return (
    <EmailLayout lang={lang} previewText={intro}>
      <Heading className="text-xl font-semibold text-slate-900">{headline}</Heading>
      <Text className="text-sm text-slate-700">
        {intro}{" "}
        {pill ? <Pill tone={pill.tone}>{pill.label}</Pill> : null}
      </Text>

      {rows.length > 0 ? (
        <>
          <Hr className="my-4 border-slate-200" />
          <Section>
            {rows.map(([label, value]) => (
              <Row key={label} className="mb-1">
                <Column className="w-1/3 align-top text-xs font-medium text-slate-500">{label}</Column>
                <Column className="text-sm text-slate-800">{value}</Column>
              </Row>
            ))}
          </Section>
        </>
      ) : null}

      {note ? (
        <Text className="mt-4 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">{note}</Text>
      ) : null}

      <CtaButton href={ctaHref}>{ctaLabel}</CtaButton>
    </EmailLayout>
  )
}
