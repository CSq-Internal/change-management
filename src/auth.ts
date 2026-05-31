import NextAuth from "next-auth"
import authConfig from "@/auth.config"
import { enrichedJwt, sessionFromToken } from "@/lib/auth-callbacks"

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    jwt: enrichedJwt,
    session: sessionFromToken,
  },
})
