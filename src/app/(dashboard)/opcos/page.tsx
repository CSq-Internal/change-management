import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { getPrisma } from "@/server/db"
import { isGroupAdmin } from "@/lib/permissions"
import OpcosClient from "./opcos-client"
import type { DbOpCo } from "./types"

export default async function OpcosPage() {
  const session = await auth()
  if (!session) redirect("/login")
  if (!isGroupAdmin(session.user.realmRoles)) redirect("/")

  const db = getPrisma()
  const opcos = await db.opCo.findMany({ orderBy: { name: "asc" } })

  const serializable: DbOpCo[] = opcos.map((o) => ({
    id: o.id,
    name: o.name,
    slug: o.slug,
    locale: o.locale,
    archived: o.archivedAt !== null,
  }))

  return <OpcosClient opcos={serializable} />
}
