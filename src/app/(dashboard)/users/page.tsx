import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { getPrisma } from "@/server/db"
import { isGroupLevel } from "@/lib/permissions"
import UsersClient from "./users-client"

export default async function UsersPage() {
  const session = await auth()
  if (!session) redirect("/login")

  const db = getPrisma()
  const groupLevel = isGroupLevel(session.user.realmRoles)
  const opcoSlugs = session.user.organizations.map((o) => o.alias)

  const users = await db.user.findMany({
    where: {
      opcoAssignments: {
        some: {
          ...(groupLevel ? {} : { opco: { slug: { in: opcoSlugs } } }),
        },
      },
    },
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
