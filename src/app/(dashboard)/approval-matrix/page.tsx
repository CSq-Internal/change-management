import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { getPrisma } from "@/server/db"
import { OPCO_SLUGS, OPCO_NAMES } from "@/lib/opco"
import type { OpCoSlug } from "@/lib/opco"
import { isGroupLevelInfra } from "@/lib/approver-routing"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

const INFRA_TYPES = [
  "Equiano Optics",
  "Equiano IP",
  "Backbone Transport Network",
  "Metro Transport Network",
  "Wifi",
  "Internal IT Infrastructure",
  "Backbone IP Network",
]

export default async function ApprovalMatrixPage() {
  const session = await auth()
  if (!session) redirect("/login")
  const db = getPrisma()

  const groupCtos = await db.user.findMany({
    where: { isGroupCto: true, isActive: true },
    select: { name: true, email: true },
  })
  const groupCtoNames = groupCtos.map((c) => c.name ?? c.email)
  const groupCtoLabel = groupCtoNames.length > 0 ? groupCtoNames.join(", ") : "—"

  const opcos = await db.opCo.findMany({
    select: {
      slug: true,
      name: true,
      users: {
        where: { role: "approver", isActive: true },
        select: { user: { select: { name: true, email: true } } },
      },
    },
  })
  const approversBySlug: Record<string, string[]> = {}
  for (const o of opcos) {
    approversBySlug[o.slug] = o.users.map((a) => a.user.name ?? a.user.email)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Approval Matrix</h1>
        <p className="text-sm text-muted-foreground">
          Who approves a change, by infrastructure type and OpCo. Approvers are notified automatically on submit.
        </p>
      </div>

      <Card className="border-border/80 bg-card/95">
        <CardHeader>
          <CardTitle className="text-base">Routing by infrastructure type</CardTitle>
          <CardDescription>Equiano infra is group-level (Group CTO); the rest route to the resident OpCo approver with the Group CTO as secondee.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {INFRA_TYPES.map((infra) => (
            <div key={infra} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-muted/50 px-4 py-2 text-sm">
              <span className="font-medium">{infra}</span>
              <span className="text-muted-foreground">
                {isGroupLevelInfra(infra)
                  ? `Group CTO — ${groupCtoLabel}`
                  : `Resident OpCo approver + secondee ${groupCtoLabel}`}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="border-border/80 bg-card/95">
        <CardHeader>
          <CardTitle className="text-base">Approvers per OpCo</CardTitle>
          <CardDescription>Resident approvers for each operating company. Group CTO ({groupCtoLabel}) is secondee on all non-Equiano changes.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {OPCO_SLUGS.map((slug) => (
            <div key={slug} className="rounded-xl border border-border/70 bg-muted/40 px-4 py-3">
              <div className="text-sm font-medium text-foreground">{OPCO_NAMES[slug as OpCoSlug] ?? slug}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {approversBySlug[slug]?.length > 0 ? approversBySlug[slug].join(", ") : "No resident approver assigned"}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
