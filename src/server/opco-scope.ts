// src/server/opco-scope.ts
import { cookies } from "next/headers"
import { manageableOpCoSlugs } from "@/lib/permissions"
import { getPrisma } from "@/server/db"
import type { SessionOrganization } from "@/types/next-auth"

// Resolves the OpCo slug filter for an admin page: the caller's manageable OpCos,
// narrowed to the header switcher's active OpCo (cookie `csq-active-opco`) when it
// is a specific, manageable one. Returns `undefined` for "all manageable" (group_admin
// with no narrowing), meaning no `where` filter.
export async function activeOpCoSlugFilter(user: {
  organizations: SessionOrganization[]
  realmRoles: string[]
}): Promise<{ in: string[] } | undefined> {
  const scope = manageableOpCoSlugs(user.organizations, user.realmRoles)
  const active = (await cookies()).get("csq-active-opco")?.value

  let slugFilter: { in: string[] } | undefined
  if (scope !== "all") slugFilter = { in: scope }
  if (active && active !== "all" && (scope === "all" || scope.includes(active))) {
    slugFilter = { in: [active] }
  }
  return slugFilter
}

/** OpCos a picker may offer, by name: the given slugs (or every one), never archived ones. */
export function activeOpCos(slugs: string[] | "all"): Promise<{ slug: string; name: string }[]> {
  return getPrisma().opCo.findMany({
    where: { archivedAt: null, ...(slugs === "all" ? {} : { slug: { in: slugs } }) },
    orderBy: { name: "asc" },
    select: { slug: true, name: true },
  })
}
