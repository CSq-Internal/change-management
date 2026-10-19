import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { getPrisma } from "@/server/db"
import { listMyRoleRequests } from "@/server/actions/access-requests"
import ProfileClient from "./profile-client"

export default async function ProfileSettingsPage() {
  // auth() reads the request, which also stops the build from prerendering this page
  // (it has no database at build time).
  if (!(await auth())) redirect("/login")
  const [opcos, requests] = await Promise.all([
    getPrisma().opCo.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" }, select: { name: true, slug: true } }),
    listMyRoleRequests(),
  ])
  return <ProfileClient opcos={opcos} requests={requests} />
}
