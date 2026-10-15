import type { NextAuthConfig } from "next-auth"
import Keycloak from "next-auth/providers/keycloak"
import { isAllowedSignInEmail } from "@/lib/sign-in-domain"

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
  // Failed callbacks (e.g. a PKCE mismatch from a stale or duplicated login tab)
  // land back on the login page with ?error=<code> instead of Auth.js's 500 page.
  // Sign-in errors (provider-side OAuth errors, CSRF) redirect to pages.signIn instead.
  pages: { error: "/login", signIn: "/login" },
  logger: {
    // One JSON line at ERROR severity: Cloud Run only maps plain stderr text to DEFAULT,
    // so without this a failed sign-in never reaches the prod error alert.
    error(error) {
      const { err, ...details } = (error.cause ?? {}) as { err?: unknown } & Record<string, unknown>
      const type = (error as { type?: string }).type ?? error.name
      console.error(JSON.stringify({
        severity: "ERROR",
        message: `[auth][error] ${type}: ${error.message}`,
        cause: err instanceof Error ? err.message : undefined,
        details: Object.keys(details).length > 0 ? details : undefined,
        stack: err instanceof Error ? err.stack : error.stack,
      }))
    },
  },
  callbacks: {
    // Google @csquared.com only. Keycloak's cms-google-only flow already forces Google;
    // this is the in-app lock if that client setting is ever reverted. A refusal lands on
    // /login?error=AccessDenied and is logged through logger.error above.
    signIn({ profile }) {
      return profile?.email_verified === true && isAllowedSignInEmail(profile.email)
    },
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
