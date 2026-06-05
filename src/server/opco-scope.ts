// src/server/opco-scope.ts
import { cookies } from "next/headers"
import { manageableOpCoSlugs } from "@/lib/permissions"
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
