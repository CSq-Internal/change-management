"use client"

import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Bell,
  MessageSquare,
  Mail,
  PhoneCall,
  Smartphone,
  Webhook,
  Ticket,
  Radio,
  Globe,
} from "lucide-react"

const channels = [
  { label: "Email", icon: Mail, desc: "Primary inbox and escalations." },
  { label: "SMS", icon: Smartphone, desc: "Critical changes and outages." },
  { label: "Voice Call", icon: PhoneCall, desc: "High severity alerts." },
  { label: "Discord", icon: MessageSquare, desc: "Team channels and webhooks." },
  { label: "Telegram", icon: MessageSquare, desc: "On-call and operations bots." },
  { label: "Zendesk", icon: Ticket, desc: "Support ticket routing." },
  { label: "PagerDuty", icon: Radio, desc: "On-call escalation policies." },
  { label: "Opsgenie", icon: Radio, desc: "Incident response workflows." },
  { label: "Webhook", icon: Webhook, desc: "Custom endpoints and automation." },
  { label: "In-App", icon: Bell, desc: "UI notifications and banners." },
  { label: "Status Page", icon: Globe, desc: "External comms updates." },
]

export default function AlertManagerPage() {
  const { language } = useStore()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t(language, "nav.settingsAlerts")}</h1>
        <p className="text-sm text-muted-foreground">
          Configure alert routing by channel, severity, and escalation rules.
        </p>
      </div>

      <Card className="border-border/80 bg-card/95">
        <CardHeader>
          <CardTitle className="text-base">Alert Channels</CardTitle>
          <CardDescription>Enable the media types used across your change workflows.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {channels.map((channel) => (
            <div
              key={channel.label}
              className="flex items-start gap-3 rounded-xl border border-border/70 bg-muted/60 px-4 py-3"
            >
              <div className="mt-0.5 rounded-full bg-background p-2 text-foreground">
                <channel.icon className="h-4 w-4" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium text-foreground">{channel.label}</div>
                <div className="text-xs text-muted-foreground">{channel.desc}</div>
              </div>
              <Button variant="outline" className="h-8 px-3 text-xs">
                Configure
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="border-border/80 bg-card/95">
        <CardHeader>
          <CardTitle className="text-base">Alert Policies</CardTitle>
          <CardDescription>Route notifications based on severity and category.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          {["Low", "Medium", "High", "Critical", "Security", "Compliance"].map((policy) => (
            <div
              key={policy}
              className="rounded-xl border border-border/70 bg-muted/60 px-4 py-3 text-sm text-foreground"
            >
              {policy}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
