import type { Prisma } from "@prisma/client"
import { viewerTier, requestScopedSlugs } from "@/lib/permissions"
import type { SessionOrganization } from "@/types/next-auth"

/**
 * Prisma `where` selecting the change requests a user may browse:
 *   group  → {} (all)
 *   opco   → changes in their admin/approver OpCos, plus their own anywhere (an OpCo
 *            where they are only a requester still has their drafts)
 *   member → { requester: { keycloakId } } (own only)
 */
export function requestScope(user: {
  keycloakId: string
  organizations: SessionOrganization[]
  realmRoles: string[]
}): Prisma.ChangeRequestWhereInput {
  const tier = viewerTier(user.organizations, user.realmRoles)
  if (tier === "group") return {}
  const own = { requester: { keycloakId: user.keycloakId } }
  if (tier === "opco") return { OR: [{ opco: { slug: { in: requestScopedSlugs(user.organizations) } } }, own] }
  return own
}

const RECENT_DAYS = 90

/**
 * Open changes, plus finished ones (closed, rejected, cancelled) touched in the last 90 days.
 * shortcut: lists stop growing with history, but open changes still load in full; move to
 * server-side paging if open changes alone reach the thousands.
 */
export function openOrRecent(nowMs: number): Prisma.ChangeRequestWhereInput {
  return {
    OR: [
      { status: { notIn: ["closed", "rejected", "cancelled"] } },
      { updatedAt: { gte: new Date(nowMs - RECENT_DAYS * 24 * 60 * 60 * 1000) } },
    ],
  }
}
