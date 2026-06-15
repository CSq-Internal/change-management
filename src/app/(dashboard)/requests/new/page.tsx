import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { getPrisma } from "@/server/db"
import { isGroupLevel } from "@/lib/permissions"
import { OPCO_SLUGS } from "@/lib/opco"
import RequestForm from "../request-form"

export default async function NewRequestPage() {
  const session = await auth()
  if (!session) redirect("/login")
  const db = getPrisma()

  const opcoOptions = isGroupLevel(session.user.realmRoles)
    ? [...OPCO_SLUGS]
    : session.user.organizations.map((o) => o.alias)

  const opcoRecords = await db.opCo.findMany({
    where: { slug: { in: opcoOptions } },
    select: { id: true, slug: true },
  })
  const groupCtos = (await db.cABMembership.findMany({
    where: { opcoId: null, isActive: true },
    include: { user: { select: { name: true, email: true } } },
  })).map((m) => m.user)

  const opcoCab = await db.cABMembership.findMany({
    where: { opcoId: { in: opcoRecords.map((o) => o.id) }, isActive: true },
    include: { user: { select: { name: true, email: true } }, opco: { select: { slug: true } } },
  })
  const approversByOpco: Record<string, { name: string | null; email: string }[]> = {}
  for (const o of opcoRecords) approversByOpco[o.slug] = []
  for (const m of opcoCab) {
    if (m.opco) approversByOpco[m.opco.slug]?.push({ name: m.user.name, email: m.user.email })
  }

  return (
    <RequestForm
      opcoOptions={opcoOptions}
      defaultEmail={session.user.email ?? ""}
      groupCtos={groupCtos}
      approversByOpco={approversByOpco}
    />
  )
}
