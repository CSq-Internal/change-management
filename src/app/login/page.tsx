"use client"

import { Suspense } from "react"
import Image from "next/image"
import { useSearchParams } from "next/navigation"
import { signIn } from "next-auth/react"
import { ArrowUpRight, ClipboardCheck, ShieldCheck, type LucideIcon } from "lucide-react"
import { useStore } from "@/lib/store"
import { t, type Language } from "@/lib/i18n"
import { Button } from "@/components/ui/button"

const FEATURES: Array<{ icon: LucideIcon; title: string; desc: string }> = [
  { icon: ArrowUpRight, title: "auth.brand.raise", desc: "auth.brand.raiseDesc" },
  { icon: ShieldCheck, title: "auth.brand.cab", desc: "auth.brand.cabDesc" },
  { icon: ClipboardCheck, title: "auth.brand.audit", desc: "auth.brand.auditDesc" },
]

export default function LoginPage() {
  // useSearchParams needs a Suspense boundary so the page can still prerender.
  return (
    <Suspense>
      <SignIn />
    </Suspense>
  )
}

function SignIn() {
  const { language, setLanguage } = useStore()
  const error = useSearchParams().get("error")
  // AccessDenied = the signIn callback refused the account. Anything else is a failed
  // or stale callback; never echo the raw code.
  const banner = error === "AccessDenied" ? "auth.error.domain" : "auth.error.callback"

  async function handleGoogleLogin() {
    // kc_idp_hint skips Keycloak's own page and goes straight to the dedicated,
    // csquared.com-restricted Google identity provider for this app.
    await signIn("keycloak", { callbackUrl: "/" }, { kc_idp_hint: "google-csquared" })
  }

  return (
    <div className="flex min-h-dvh flex-col md:grid md:grid-cols-[1.05fr_1fr]">
      <header className="flex items-center gap-2 bg-[#0a3d91] px-4 py-3 text-white md:hidden">
        <Logo size={26} />
        <span className="font-semibold">CSquared</span>
        <span className="text-sm opacity-75">· {t(language, "auth.brand.product")}</span>
      </header>

      <aside className="hidden flex-col bg-gradient-to-br from-[#0a3d91] to-[#072b66] p-10 text-white md:flex">
        <div className="flex items-center gap-3">
          <Logo size={36} />
          <span className="text-lg font-semibold">CSquared</span>
        </div>
        <div className="my-auto max-w-md py-10">
          <p className="text-xs font-bold tracking-[0.16em] text-[#7fd0ff]">{t(language, "auth.brand.eyebrow")}</p>
          <p className="mt-3 text-3xl font-bold leading-tight">{t(language, "auth.brand.headline")}</p>
          <ul className="mt-8 space-y-5">
            {FEATURES.map(({ icon: Icon, title, desc }) => (
              <li key={title} className="flex gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-[#00a3ff]/35 bg-[#00a3ff]/15 text-[#7fd0ff]">
                  <Icon className="size-4" aria-hidden />
                </span>
                <span>
                  <span className="block font-medium">{t(language, title)}</span>
                  <span className="block text-sm opacity-70">{t(language, desc)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs opacity-65">{t(language, "auth.brand.footer")}</p>
      </aside>

      <main className="relative flex flex-1 flex-col justify-center px-6 py-16 md:px-16">
        <LanguageSwitch language={language} onChange={setLanguage} />
        <div className="mx-auto w-full max-w-sm">
          <h1 className="text-3xl font-bold">{t(language, "auth.signIn")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t(language, "auth.subtitle")}</p>
          {error && (
            <div role="alert" className="mt-6 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
              <p className="font-medium">{t(language, banner)}</p>
              <p className="text-muted-foreground">{t(language, `${banner}Desc`)}</p>
            </div>
          )}
          <Button variant="outline" className="mt-6 h-11 w-full gap-3 text-sm font-semibold" onClick={handleGoogleLogin}>
            <GoogleMark />
            {t(language, "auth.google")}
          </Button>
          <p className="mt-4 text-xs text-muted-foreground">{t(language, "auth.staffOnly")}</p>
        </div>
      </main>
    </div>
  )
}

function Logo({ size }: { size: number }) {
  return (
    <Image src="/csquared-icon.png" alt="CSquared logo" width={size} height={size} unoptimized className="shrink-0 rounded-full bg-white" />
  )
}

function LanguageSwitch({ language, onChange }: { language: Language; onChange: (l: Language) => void }) {
  return (
    <div role="group" aria-label={t(language, "auth.language")} className="absolute right-4 top-4 flex gap-0.5 rounded-full border p-0.5 text-xs">
      {(["en", "fr"] as const).map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={language === l}
          onClick={() => onChange(l)}
          className={`rounded-full px-2.5 py-1 font-medium ${language === l ? "bg-[#0a3d91] text-white" : "text-muted-foreground"}`}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  )
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="size-[18px]" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  )
}
