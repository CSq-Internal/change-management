// src/server/active-opco.ts
import { cookies } from "next/headers"
import type { Prisma } from "@prisma/client"
import { viewerTier, requestScopedSlugs } from "@/lib/permissions"
import type { SessionOrganization } from "@/types/next-auth"

type Viewer = {
  organizations: SessionOrganization[]
  realmRoles: string[]
}

/**
 * The header OpCo switcher's active selection (cookie `csq-active-opco`), validated
 * to an OpCo the viewer may actually see. Returns `null` for "all" / unset / an
 * out-of-scope value — i.e. "no narrowing". This is the VIEW-scope counterpart to
 * `activeOpCoSlugFilter` (which is for management pages / manageable OpCos).
 */
export async function activeOpCoSlug(user: Viewer): Promise<string | null> {
  const active = (await cookies()).get("csq-active-opco")?.value
  if (!active || active === "all") return null

  const tier = viewerTier(user.organizations, user.realmRoles)
  const entitled =
    tier === "group" || // group-level viewers may focus on any OpCo
    (tier === "opco" && requestScopedSlugs(user.organizations).includes(active)) ||
    user.organizations.some((o) => o.alias === active)

  return entitled ? active : null
}

/** AND the active OpCo onto a ChangeRequest where-filter (no-op when active is null). */
export function withActiveOpCo(
  base: Prisma.ChangeRequestWhereInput,
  active: string | null,
): Prisma.ChangeRequestWhereInput {
  return active ? { AND: [base, { opco: { slug: active } }] } : base
}
