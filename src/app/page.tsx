"use client"
import Link from "next/link"
import { motion } from "framer-motion"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { ChevronRight, ClipboardList, ShieldCheck, GitCompare, FileClock } from "lucide-react"

const tiles = [
  { href: "/requests", label: "Requests", desc: "Raise and track change requests", icon: ClipboardList },
  { href: "/approvals", label: "Approvals", desc: "Review and approve changes", icon: ShieldCheck },
  { href: "/changes", label: "Changes", desc: "Implement and verify changes", icon: GitCompare },
  { href: "/audits", label: "Audits", desc: "Evidence for ISO 27001", icon: FileClock },
]

export default function Home(){
  return (
    <div>
      <div className="mb-8">
        <motion.h1 initial={{opacity:0, y:8}} animate={{opacity:1, y:0}} transition={{duration:0.5}} className="text-3xl font-semibold">Change Management System</motion.h1>
        <motion.p initial={{opacity:0}} animate={{opacity:1}} transition={{delay:0.1}} className="text-slate-600 mt-2">Secure workflows aligned with ISO 27001: request, approve, implement, and audit.</motion.p>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        {tiles.map((t, i) => (
          <motion.div key={t.href} initial={{opacity:0, y:10}} animate={{opacity:1, y:0}} transition={{delay:0.05*i}}>
            <Link href={t.href}>
              <Card className="group hover:shadow-md transition-shadow">
                <CardHeader className="flex flex-row items-center gap-3">
                  <t.icon className="w-5 h-5 text-slate-500" />
                  <div>
                    <CardTitle className="text-base">{t.label}</CardTitle>
                    <CardDescription>{t.desc}</CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="text-sm text-slate-500 flex items-center gap-2">Open <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5"/></CardContent>
              </Card>
            </Link>
          </motion.div>
        ))}
      </div>
    </div>
  )
}
