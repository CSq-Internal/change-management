import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { getPrisma } from "@/server/db"
import { isGroupLevel, manageableOpCoSlugs } from "@/lib/permissions"
import UsersClient from "./users-client"

export default async function UsersPage() {
  const session = await auth()
  if (!session) redirect("/login")

  const db = getPrisma()
  // Group-level roles (group_admin and read-only group_auditor) see every user;
  // OpCo admins are scoped to the OpCos they manage.
  const scope = isGroupLevel(session.user.realmRoles)
    ? "all"
    : manageableOpCoSlugs(session.user.organizations, session.user.realmRoles)

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
