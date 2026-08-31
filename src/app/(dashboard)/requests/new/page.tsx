import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { isGroupLevel } from "@/lib/permissions"
import { OPCO_SLUGS } from "@/lib/opco"
import RequestForm from "../request-form"

export default async function NewRequestPage() {
  const session = await auth()
  if (!session) redirect("/login")

  const opcoOptions = isGroupLevel(session.user.realmRoles)
    ? [...OPCO_SLUGS]
    : session.user.organizations.map((o) => o.alias)

  return <RequestForm opcoOptions={opcoOptions} defaultEmail={session.user.email ?? ""} />
}
