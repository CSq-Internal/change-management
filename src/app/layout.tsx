import type { Metadata } from "next"
import { Space_Grotesk } from "next/font/google"
import "./globals.css"
import { AppShell } from "@/components/app-shell"
import { cn } from "@/lib/utils"

const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-space-grotesk" })

export const metadata: Metadata = { title: "CSquared • Change Management", description: "ISO 27001 Internal CMS" }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={cn(spaceGrotesk.variable, "min-h-screen bg-background font-sans antialiased")}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  )
}
