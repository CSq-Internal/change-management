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
        token.realmRoles = (p.realm_access as { roles?: string[] })?.roles ?? []
      }
      return token
    },
  },
}

export default authConfig
