"use server"
import { headers } from "next/headers"
import { getToken } from "next-auth/jwt"

/**
 * Keycloak's end-session URL for the signed-in user. Clearing the app cookie alone leaves
 * the Keycloak session alive, so the next "Sign in" would skip the login screen. The ID
 * token hint lets Keycloak end it without asking for confirmation.
 */
export async function keycloakLogoutUrl(): Promise<string> {
  const appUrl = process.env.NEXTAUTH_URL ?? ""
  const token = await getToken({
    req: { headers: await headers() },
    secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
    secureCookie: appUrl.startsWith("https://"),
  })
  const url = new URL(`${process.env.KEYCLOAK_ISSUER}/protocol/openid-connect/logout`)
  url.searchParams.set("client_id", process.env.KEYCLOAK_CLIENT_ID ?? "csquared-cms")
  url.searchParams.set("post_logout_redirect_uri", `${appUrl}/login`)
  if (typeof token?.idToken === "string") url.searchParams.set("id_token_hint", token.idToken)
  return url.toString()
}
