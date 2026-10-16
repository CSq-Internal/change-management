import { getPrisma } from "@/server/db"
import { listMyRoleRequests } from "@/server/actions/access-requests"
import ProfileClient from "./profile-client"

export default async function ProfileSettingsPage() {
  const [opcos, requests] = await Promise.all([
    getPrisma().opCo.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" }, select: { name: true, slug: true } }),
    listMyRoleRequests(),
  ])
  return <ProfileClient opcos={opcos} requests={requests} />
}
