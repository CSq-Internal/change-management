import type { Metadata } from "next"
import "./globals.css"
import { cn } from "@/lib/utils"
export const metadata: Metadata = { title: "CSquared • Change Management", description: "ISO 27001 Internal CMS" }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={cn("min-h-screen bg-background antialiased relative overflow-x-hidden")}> 
        <div className="pointer-events-none absolute inset-0 -z-10 [mask-image:radial-gradient(60%_60%_at_50%_0%,#000_20%,transparent_70%)]">
          <div className="absolute -top-32 left-1/2 -translate-x-1/2 h-[400px] w-[800px] bg-gradient-to-r from-sky-400/30 via-blue-500/20 to-emerald-400/30 blur-3xl animate-pulse" />
        </div>
        <header className="sticky top-0 z-40 bg-white/70 backdrop-blur border-b">
          <div className="mx-auto max-w-6xl px-4 h-14 flex items-center justify-between">
            <div className="font-semibold tracking-tight">CSquared • Change Management</div>
            <nav className="text-sm text-slate-600">ISO 27001 Track</nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
        <footer className="border-t mt-12 py-6 text-xs text-slate-500">© {new Date().getFullYear()} CSquared</footer>
      </body>
    </html>
  )
}
