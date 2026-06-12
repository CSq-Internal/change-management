import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { listChatWebhooks } from "@/server/actions/chat-webhooks"
import { canManageAnyOpCo, isGroupAdmin } from "@/lib/permissions"
import IntegrationsClient, { type WebhookRow } from "./integrations-client"

export default async function IntegrationsSettingsPage() {
  const session = await auth()
  if (!session) redirect("/login")

  const canManage = canManageAnyOpCo(session.user.organizations, session.user.realmRoles)
  const webhooks = canManage ? await listChatWebhooks() : []
  const rows: WebhookRow[] = webhooks.map((w) => ({
    id: w.id, opcoSlug: w.opco?.slug ?? null, opcoName: w.opco?.name ?? null,
    url: w.url, isActive: w.isActive,
  }))
  const scopes = [
    ...(isGroupAdmin(session.user.realmRoles) ? [{ slug: "", name: "Group" }] : []),
    ...session.user.organizations.filter((o) => o.roles.includes("admin")).map((o) => ({ slug: o.alias, name: o.name })),
  ]
  return <IntegrationsClient rows={rows} canManage={canManage} scopes={scopes} />
}
