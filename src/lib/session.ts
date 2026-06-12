// src/lib/session.ts
import { auth } from "@/auth"
import type { SessionOrganization } from "@/types/next-auth"

export type AppSession = {
  keycloakId: string
  email: string
  name: string | null
  organizations: SessionOrganization[]
  realmRoles: string[]
}

export async function getAppSession(): Promise<AppSession> {
  const session = await auth()
  if (!session?.user) throw new Error("Unauthorized")
  return {
    keycloakId: session.user.keycloakId,
    email: session.user.email ?? "",
    name: session.user.name ?? null,
    organizations: session.user.organizations,
    realmRoles: session.user.realmRoles,
  }
}

export function getOpCoSlugsFromSession(session: AppSession): string[] | undefined {
  const { realmRoles } = session
  if (realmRoles.includes("group_admin") || realmRoles.includes("group_auditor")) {
    return undefined // undefined = no filter = all OpCos
  }
  return session.organizations.map((o) => o.alias)
}
