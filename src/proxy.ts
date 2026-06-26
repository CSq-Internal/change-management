import NextAuth from "next-auth"
import authConfig from "@/auth.config"
import { NextResponse } from "next/server"
import { shouldRedirectToRequestAccess } from "@/lib/permissions"
import type { SessionOrganization } from "@/types/next-auth"

// Build a proxy-only NextAuth instance from the edge-safe config so this entry
// stays decoupled from `@/auth` / `@/server/db` (which pull in `pg`). The inline
// session callback copies the access-relevant claims off the JWT for the gate
// below; it must stay edge-safe (we deliberately do NOT import sessionFromToken,
// which pulls in the pg layer).
export const proxy = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    session({ session, token }) {
      session.user.organizations = (token.organizations as SessionOrganization[] | undefined) ?? []
      session.user.realmRoles = (token.realmRoles as string[] | undefined) ?? []
      return session
    },
  },
}).auth((req) => {
  const { pathname } = req.nextUrl
  const session = req.auth

  if (pathname.startsWith("/api/auth")) return NextResponse.next()

  // The SLA cron endpoint authenticates itself via the x-cron-secret header
  // (no session), so it must bypass the session-redirect proxy.
  if (pathname.startsWith("/api/cron")) return NextResponse.next()

  if (!session && pathname !== "/login") {
    return NextResponse.redirect(new URL("/login", req.url))
  }

  if (session && pathname === "/login") {
    return NextResponse.redirect(new URL("/", req.url))
  }

  // Authenticated but no standing access → self-service request page. API routes
  // self-authorize and must not receive an HTML redirect, so gate page routes only.
  const token = session
    ? { organizations: session.user.organizations, realmRoles: session.user.realmRoles }
    : null
  if (!pathname.startsWith("/api") && shouldRedirectToRequestAccess(pathname, token)) {
    return NextResponse.redirect(new URL("/request-access", req.url))
  }

  return NextResponse.next()
})

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons|images).*)"],
}
