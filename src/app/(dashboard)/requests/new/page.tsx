import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { isGroupLevel } from "@/lib/permissions"
import { activeOpCos } from "@/server/opco-scope"
import RequestForm from "../request-form"

export default async function NewRequestPage() {
  const session = await auth()
  if (!session) redirect("/login")

  const opcoOptions = await activeOpCos(
    isGroupLevel(session.user.realmRoles) ? "all" : session.user.organizations.map((o) => o.alias),
  )

  return <RequestForm opcoOptions={opcoOptions} defaultEmail={session.user.email ?? ""} />
}
