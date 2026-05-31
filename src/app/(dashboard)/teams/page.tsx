import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { getPrisma } from "@/server/db"
import { isGroupAdmin } from "@/lib/permissions"
import TeamsClient from "./teams-client"

export default async function TeamsPage() {
  const session = await auth()
  if (!session) redirect("/login")

  const db = getPrisma()
  const groupLevel = isGroupAdmin(session.user.realmRoles)
  const opcoSlugs = session.user.organizations.map((o) => o.alias)
  const opcoFilter = groupLevel ? {} : { slug: { in: opcoSlugs } }

  const teams = await db.team.findMany({
    where: { opco: opcoFilter },
    include: {
      members: true,
      opco: true,
    },
  })

  const serializable = teams.map((team) => ({
    id: team.id,
    name: team.name,
    description: team.description,
    planSummary: team.planSummary,
    memberCount: team.members.length,
    opco: { name: team.opco.name, slug: team.opco.slug },
  }))

  return <TeamsClient teams={serializable} />
}
