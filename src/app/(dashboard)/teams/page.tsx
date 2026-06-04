import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import { auth } from "@/auth"
import { getPrisma } from "@/server/db"
import { manageableOpCoSlugs } from "@/lib/permissions"
import TeamsClient from "./teams-client"
import type { DbTeam } from "./types"

export default async function TeamsPage() {
  const session = await auth()
  if (!session) redirect("/login")

  const scope = manageableOpCoSlugs(session.user.organizations, session.user.realmRoles)
  const active = (await cookies()).get("csq-active-opco")?.value

  let slugFilter: { in: string[] } | undefined
  if (scope !== "all") slugFilter = { in: scope }
  if (active && active !== "all" && (scope === "all" || scope.includes(active))) {
    slugFilter = { in: [active] }
  }

  const db = getPrisma()
  const teams = await db.team.findMany({
    where: slugFilter ? { opco: { slug: slugFilter } } : {},
    include: {
      opco: true,
      members: true,
    },
    orderBy: { name: "asc" },
  })

  // Collect all member userIds and fetch user details in one query
  const allUserIds = [...new Set(teams.flatMap((team) => team.members.map((m) => m.userId)))]
  const users =
    allUserIds.length > 0
      ? await db.user.findMany({
          where: { id: { in: allUserIds } },
          select: { id: true, name: true, email: true },
        })
      : []
  const userMap = new Map(users.map((u) => [u.id, u]))

  const serializable: DbTeam[] = teams.map((team) => ({
    id: team.id,
    name: team.name,
    description: team.description,
    opco: { name: team.opco.name, slug: team.opco.slug },
    members: team.members.map((m) => {
      const u = userMap.get(m.userId)
      return {
        userId: m.userId,
        name: u?.name ?? null,
        email: u?.email ?? "",
        role: m.role,
      }
    }),
  }))

  return <TeamsClient teams={serializable} />
}
