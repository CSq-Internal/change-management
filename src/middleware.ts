import NextAuth from "next-auth"
import { NextResponse } from "next/server"
import authConfig from "@/auth.config"
import { shouldRedirectToRequestAccess } from "@/lib/permissions"
import type { SessionOrganization } from "@/types/next-auth"

// Edge-safe NextAuth instance: base (DB-free) config + an inline session callback
// that copies the access-relevant claims off the JWT. We deliberately do NOT import
// sessionFromToken (it pulls in the pg layer) — these three lines are edge-safe.
const { auth } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    session({ session, token }) {
      session.user.organizations = (token.organizations as SessionOrganization[] | undefined) ?? []
      session.user.realmRoles = (token.realmRoles as string[] | undefined) ?? []
      return session
    },
  },
})

export default auth((req) => {
  const token = req.auth
    ? { organizations: req.auth.user.organizations, realmRoles: req.auth.user.realmRoles }
    : null
  if (shouldRedirectToRequestAccess(req.nextUrl.pathname, token)) {
    return NextResponse.redirect(new URL("/request-access", req.nextUrl))
  }
  return NextResponse.next()
})

// Run on app routes; skip Next internals and static asset files.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
}
