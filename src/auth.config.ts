import type { NextAuthConfig } from "next-auth"
import Keycloak from "next-auth/providers/keycloak"

/**
 * Edge-safe NextAuth config: providers + token/profile extraction only.
 * MUST NOT import the DB layer (pg) — this is imported by middleware which
 * runs in the edge runtime. DB-backed enrichment lives in `src/auth.ts`.
 */
const authConfig: NextAuthConfig = {
  providers: [
    Keycloak({
      clientId: process.env.KEYCLOAK_CLIENT_ID!,
      clientSecret: process.env.KEYCLOAK_CLIENT_SECRET!,
      issuer: process.env.KEYCLOAK_ISSUER!,
    }),
  ],
  callbacks: {
    jwt({ token, account, profile }) {
      if (account) token.accessToken = account.access_token
      if (profile) {
        const p = profile as Record<string, unknown>
        token.keycloakId = p.sub as string
        // Standard OIDC `picture` claim — present once Keycloak's Google IdP has a
        // `picture` attribute-importer mapper. Absent until then (falls back to initials).
        token.picture = (p.picture as string | undefined) ?? null
        // Group-level roles are CMS *client* roles, scoped to this app within the
        // shared realm — read from resource_access[<client>].roles, not realm roles.
        const clientId = process.env.KEYCLOAK_CLIENT_ID ?? "csquared-cms"
        const resourceAccess = p.resource_access as
          | Record<string, { roles?: string[] }>
          | undefined
        token.realmRoles = resourceAccess?.[clientId]?.roles ?? []
      }
      return token
    },
  },
}

export default authConfig
