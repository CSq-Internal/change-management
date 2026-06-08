import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { getMyPreferences } from "@/server/actions/notification-prefs"
import NotificationsPrefsClient from "./notifications-prefs-client"

export default async function NotificationSettingsPage() {
  const session = await auth()
  if (!session) redirect("/login")
  const prefs = await getMyPreferences()
  return <NotificationsPrefsClient prefs={prefs} />
}
