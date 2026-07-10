import {
  Html, Head, Preview, Tailwind, Body, Container, Section, Img, Text, Button, pixelBasedPreset,
} from "@react-email/components"
import * as React from "react"
import { EMAIL_BASE_URL, BRAND } from "./config"
import type { Language } from "@/lib/i18n"

export function EmailLayout({
  lang, previewText, children,
}: { lang: Language; previewText: string; children: React.ReactNode }) {
  return (
    <Html lang={lang}>
      <Head />
      <Preview>{previewText}</Preview>
      <Tailwind config={{ presets: [pixelBasedPreset] }}>
        <Body className="bg-slate-100 py-8 font-sans">
          <Container className="mx-auto max-w-[520px]">
            <Section className="rounded-t-lg px-6 py-5 text-center" style={{ backgroundColor: BRAND }}>
              <Img
                src={`${EMAIL_BASE_URL}/csquared-icon.png`}
                alt="CSquared"
                width={40}
                height={40}
                className="mx-auto"
              />
            </Section>
            <Section className="rounded-b-lg border border-t-0 border-slate-200 bg-white px-6 py-6">
              {children}
            </Section>
            <Text className="mt-4 px-6 text-center text-xs text-slate-400">
              {lang === "fr"
                ? "Système de gestion des changements CSquared · message automatique, merci de ne pas répondre."
                : "CSquared Change Management System · automated message — please do not reply."}
            </Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  )
}

export function CtaButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Button
      href={href}
      className="mt-4 inline-block rounded-md px-5 py-3 text-sm font-medium text-white"
      style={{ backgroundColor: BRAND }}
    >
      {children}
    </Button>
  )
}

const PILL_TONES: Record<string, string> = {
  emergency: "bg-red-100 text-red-700",
  high: "bg-red-100 text-red-700",
  medium: "bg-amber-100 text-amber-800",
  low: "bg-green-100 text-green-700",
  sla: "bg-amber-100 text-amber-800",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  info: "bg-slate-100 text-slate-700",
}

export function Pill({ tone, children }: { tone: string; children: React.ReactNode }) {
  const cls = PILL_TONES[tone] ?? PILL_TONES.info
  return (
    <span className={`inline-block rounded-full px-2 py-1 text-xs font-semibold ${cls}`}>
      {children}
    </span>
  )
}
