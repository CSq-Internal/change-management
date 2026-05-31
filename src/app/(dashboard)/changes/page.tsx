import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { getPrisma } from "@/server/db"
import { isGroupAdmin } from "@/lib/permissions"
import ChangesClient from "./changes-client"

export default async function Changes() {
  const session = await auth()
  if (!session) redirect("/login")

  const db = getPrisma()
  const groupLevel = isGroupAdmin(session.user.realmRoles)
  const opcoSlugs = session.user.organizations.map((o) => o.alias)
  const opcoFilter = groupLevel ? {} : { opco: { slug: { in: opcoSlugs } } }

  const changes = await db.changeRequest.findMany({
    where: {
      status: { in: ["approved", "implemented", "verified"] },
      ...opcoFilter,
    },
    include: { requester: true, opco: true },
    orderBy: { updatedAt: "desc" },
  })

  const serializable = changes.map((c) => ({
    id: c.id,
    title: c.title,
    status: c.status,
    updatedAt: c.updatedAt,
  }))

  return <ChangesClient changes={serializable} />
}
