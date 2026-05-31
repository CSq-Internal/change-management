import NextAuth from "next-auth"
import Keycloak from "next-auth/providers/keycloak"
import type { SessionOrganization } from "@/types/next-auth"

export const { handlers, auth, signIn, signOut } = NextAuth({
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
        token.organizations = (p.organizations as unknown[]) ?? []
        token.realmRoles = (p.realm_access as { roles?: string[] })?.roles ?? []
      }
      return token
    },
    session({ session, token }) {
      session.user.keycloakId = (token.keycloakId as string) ?? ""
      session.user.organizations = (token.organizations as SessionOrganization[]) ?? []
      session.user.realmRoles = (token.realmRoles as string[]) ?? []
      return session
    },
  },
})
