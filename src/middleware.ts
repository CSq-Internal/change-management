import NextAuth from "next-auth"
import authConfig from "@/auth.config"
import { NextResponse } from "next/server"

// Build a middleware-only NextAuth instance from the edge-safe config so the
// edge runtime never bundles `pg` (which lives behind `@/auth` / `@/server/db`).
export default NextAuth(authConfig).auth((req) => {
  const { pathname } = req.nextUrl
  const session = req.auth

  if (pathname.startsWith("/api/auth")) return NextResponse.next()

  if (!session && pathname !== "/login") {
    return NextResponse.redirect(new URL("/login", req.url))
  }

  if (session && pathname === "/login") {
    return NextResponse.redirect(new URL("/", req.url))
  }

  return NextResponse.next()
})

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons|images).*)"],
}
