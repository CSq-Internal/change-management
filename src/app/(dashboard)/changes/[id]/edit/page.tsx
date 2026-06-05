import { notFound, redirect } from "next/navigation"
import { auth } from "@/auth"
import { getChange } from "@/server/actions/changes"
import { isGroupAdmin, hasRoleInOpCo } from "@/lib/permissions"
import RequestForm from "@/app/(dashboard)/requests/request-form"

export default async function EditChangePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const session = await auth()
  if (!session) redirect("/login")

  const change = await getChange(id)
  if (!change) notFound()

  const me = session.user
  const isAdmin =
    isGroupAdmin(me.realmRoles) ||
    hasRoleInOpCo(me.organizations, change.opco.slug, "admin")
  const isRequester = change.requester.keycloakId === me.keycloakId

  // Only editable while draft, and only by requester or admin
  if (change.status !== "draft" || (!isRequester && !isAdmin)) {
    redirect(`/changes/${id}`)
  }

  const initial = {
    id: change.id,
    title: change.title,
    description: change.description,
    category: change.category,
    riskLevel: change.riskLevel,
    contactEmail: change.contactEmail,
    infrastructureType: change.infrastructureType,
    impactScope: change.impactScope ?? null,
    implementationPlan: change.implementationPlan ?? null,
    testingPlan: change.testingPlan ?? null,
    backoutPlan: change.backoutPlan ?? null,
    plannedStart: change.plannedStart
      ? change.plannedStart.toISOString().slice(0, 16)
      : null,
    plannedEnd: change.plannedEnd
      ? change.plannedEnd.toISOString().slice(0, 16)
      : null,
    opcoSlug: change.opco.slug,
  }

  return (
    <RequestForm
      mode="edit"
      initial={initial}
      opcoOptions={[change.opco.slug]}
      defaultEmail={change.contactEmail}
      attachments={change.attachments.map((a) => ({ id: a.id, kind: a.kind, filename: a.filename }))}
    />
  )
}
