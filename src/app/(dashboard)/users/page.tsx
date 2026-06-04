import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { getPrisma } from "@/server/db"
import { manageableOpCoSlugs } from "@/lib/permissions"
import UsersClient from "./users-client"

export default async function UsersPage() {
  const session = await auth()
  if (!session) redirect("/login")

  const db = getPrisma()
  const scope = manageableOpCoSlugs(session.user.organizations, session.user.realmRoles)

  const users = await db.user.findMany({
    where:
      scope === "all"
        ? {}
        : { opcoAssignments: { some: { opco: { slug: { in: scope } } } } },
    include: {
      opcoAssignments: { include: { opco: true } },
    },
  })

  const serializable = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    isActive: u.isActive,
    opcoAssignments: u.opcoAssignments.map((a) => ({
      role: a.role,
      isActive: a.isActive,
      opco: { name: a.opco.name, slug: a.opco.slug },
    })),
  }))

  return <UsersClient users={serializable} />
}
