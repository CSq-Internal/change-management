import "next-auth"

export interface SessionOrganization {
  id: string
  name: string
  alias: string   // matches OpCo.slug: "ghana" | "uganda" | "drc" | "togo" | "liberia" | "mauritius"
  roles: string[] // org-level roles: "requester" | "approver" | "auditor" | "admin"
}

declare module "next-auth" {
  interface Session {
    user: {
      id: string
      name?: string | null
      email?: string | null
      image?: string | null
      keycloakId: string
      organizations: SessionOrganization[]
      realmRoles: string[]  // CMS client roles on csquared-cms: "group_admin" | "group_auditor"
      orphaned?: boolean    // token's keycloakId maps to no DB user → client guard signs out
    }
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    keycloakId?: string
    organizations?: SessionOrganization[]
    realmRoles?: string[]
    accessToken?: string
    orgsRefreshedAt?: number // epoch ms of the last DB org load (Part A TTL re-enrichment)
    orphaned?: boolean // set when this token's keycloakId no longer maps to a DB user
  }
}
