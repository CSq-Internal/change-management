"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import {
  Bot,
  Boxes,
  Cloud,
  Database,
  FileText,
  Globe,
  MessageSquare,
  Package,
  ShieldCheck,
  SlidersHorizontal,
  Ticket,
  Workflow,
} from "lucide-react"

export default function IntegrationsSettingsPage() {
  const { language } = useStore()
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t(language, "settings.integrations.title")}</h1>
        <p className="text-sm text-muted-foreground">{t(language, "settings.integrations.desc")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t(language, "settings.integrations.commTitle")}</CardTitle>
          <CardDescription>{t(language, "settings.integrations.commDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <IntegrationItem icon={MessageSquare} label="Slack" desc="Channel alerts and approvals." />
          <IntegrationItem icon={MessageSquare} label="Microsoft Teams" desc="Collaborative notifications." />
          <IntegrationItem icon={MailIcon} label="Google Workspace" desc="Gmail + Calendar workflow." />
          <IntegrationItem icon={MailIcon} label="Email Hooks" desc="Custom routing rules." />
          <IntegrationItem icon={Globe} label="Webhook Gateway" desc="Trigger external workflows." />
          <IntegrationItem icon={Bot} label="ChatOps Bot" desc="Approve changes from chat." />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t(language, "settings.integrations.itsmTitle")}</CardTitle>
          <CardDescription>{t(language, "settings.integrations.itsmDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <IntegrationItem icon={Ticket} label="Jira Service Management" desc="Sync incidents and changes." />
          <IntegrationItem icon={Ticket} label="ServiceNow" desc="ITIL change records." />
          <IntegrationItem icon={Workflow} label="Azure DevOps" desc="Pipelines + release gates." />
          <IntegrationItem icon={Workflow} label="GitHub Actions" desc="CI/CD approvals." />
          <IntegrationItem icon={Workflow} label="GitLab" desc="Merge request controls." />
          <IntegrationItem icon={Workflow} label="Bitbucket" desc="Release tracking." />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">ERP &amp; Finance</CardTitle>
          <CardDescription>Bridge operational change data to business systems.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <IntegrationItem icon={Package} label="Odoo" desc="ERP workflows and approvals." />
          <IntegrationItem icon={Package} label="SAP" desc="Enterprise change alignment." />
          <IntegrationItem icon={Package} label="Oracle NetSuite" desc="Finance linkage." />
          <IntegrationItem icon={Boxes} label="Microsoft Dynamics" desc="Business operations sync." />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Identity &amp; Access</CardTitle>
          <CardDescription>Centralize authentication, audit, and governance.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <IntegrationItem icon={ShieldCheck} label="Okta" desc="SSO and MFA policies." />
          <IntegrationItem icon={ShieldCheck} label="Azure AD" desc="Directory sync." />
          <IntegrationItem icon={ShieldCheck} label="Google Workspace" desc="SSO with Google identity." />
          <IntegrationItem icon={SlidersHorizontal} label="SCIM" desc="User provisioning." />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Data &amp; Analytics</CardTitle>
          <CardDescription>Export and monitor change performance.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <IntegrationItem icon={Database} label="BigQuery" desc="Analytics warehouse." />
          <IntegrationItem icon={Database} label="Snowflake" desc="Cross-team reporting." />
          <IntegrationItem icon={FileText} label="Power BI" desc="Executive dashboards." />
          <IntegrationItem icon={Cloud} label="Looker Studio" desc="Operational insights." />
        </CardContent>
      </Card>
    </div>
  )
}

function IntegrationItem({
  icon: Icon,
  label,
  desc,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  desc: string
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border/70 bg-muted/60 px-4 py-3">
      <div className="mt-0.5 rounded-full bg-background p-2 text-foreground">
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <div className="text-sm font-medium text-foreground">{label}</div>
        <div className="text-xs text-muted-foreground">{desc}</div>
      </div>
    </div>
  )
}

function MailIcon({ className }: { className?: string }) {
  return <Globe className={className} />
}
