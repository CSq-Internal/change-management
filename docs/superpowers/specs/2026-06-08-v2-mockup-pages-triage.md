# v2 Triage — Automation, Alerts & Security mockup pages

**Date:** 2026-06-08
**Type:** Backlog brief / build-vs-drop triage (not an implementation spec)
**Status:** Decided — see verdicts. No implementation planned yet.

## Why this exists

Three nav pages shipped as static mockups during the v1.0 build and were deliberately
left in place (unlinked candidates) for a build-vs-drop decision: `/automation`,
`/settings/alerts`, `/settings/security`. This is the triage of whether any are worth
building as genuine v2 features.

**Goal of the exercise:** scope genuine v2 features (forward-looking), not just tidy the nav.

**Key facts that shaped the decision:**
- The risk-based approver routing and SLA escalation that `/automation` advertises are
  **already implemented and working** (CAB routing by infra type; `runDueEscalations` cron).
- The notification channels `/settings/alerts` advertises are **already covered** by
  email + in-app (`/settings/notifications`, per-user preference matrix) and Google Chat
  webhooks (`/settings/integrations`).
- Auth is fully delegated to **Keycloak** (NextAuth v5 + OIDC). MFA, device management and
  session control are Keycloak's responsibility and ship in its Account Console.
- CSquared's real external tooling is **Google Workspace/Chat** (integrated) and **Odoo**
  (primary ERP). **Slack, Jira, PagerDuty, Zendesk are not change-management-relevant.**
- Strategic direction: route reporting/visibility **through Odoo** "where we can."

## Decision summary

| # | Page | Verdict | Effort if built | Why |
|---|------|---------|-----------------|-----|
| 1 | `/automation` | **Drop** | L/XL | Its valuable rules already exist hardcoded; a configurable rules engine is high cost for low marginal value; remaining actions target unused tools. |
| 2 | `/settings/alerts` | **Fold, don't build** | M | Duplicates existing notifications + integrations; only genuine increment is severity/category routing policies, which belong in the existing notification settings. |
| 3 | `/settings/security` | **Integrate, don't rebuild** | S (deep-link) / M (proxy) | Keycloak owns MFA/devices/sessions and has an Account Console; deep-link to it instead of reimplementing. |
| 4 | **Odoo visibility** (emergent) | **Roadmap candidate** | M–L | Not one of the three pages, but the genuinely valuable v2 integration surfaced here; aligns with "everything through Odoo." Needs its own brainstorming cycle. |

**Bottom line:** none of the three mockups are worth building as drawn. Two collapse into
existing functionality; one belongs to Keycloak. The real v2 opportunity is Odoo integration.

---

## Brief 1 — `/automation` (workflow rules engine)

**What the mockup claims:** configurable rules that "route and automate change workflows" —
auto-assign approver by risk, escalate approvals after 24h, notify security on high-risk,
open Jira ticket on approval, post to Slack on close, schedule month-end audit export.

**Reality / overlap:**
- *Auto-assign approver by risk level* → **done** (CAB approval routing by infrastructure type
  + risk-based quorum).
- *Escalate approvals after 24h* → **done** (`runDueEscalations` advances SLA tiers and
  notifies opco admins + group CAB; runs lazily on page load and via `POST /api/cron/sla`).
- *Notify security on high-risk* → **partially done** (emergency-alert notifications).
- *Open Jira ticket* / *Post to Slack* → not built, and **Jira/Slack are not used.**
- *Schedule month-end audit export* → not built (CSV export exists on `/audits`, run on demand).

**Honest net-new scope (two separable pieces):**
1. A *configurable* rules engine (admins define triggers → conditions → actions instead of
   code). Large, generic subsystem; high risk of building automation nobody reconfigures.
2. Outbound integration — the only real target is **Odoo** (see Brief 4), not Jira/Slack.

**Size:** L/XL for the engine.
**Dependencies:** none new for (1); Odoo API for (2).
**Verdict: DROP the page.** Don't build a generic rules engine to make configurable what
already works. Any genuine outbound-action need belongs to the Odoo candidate.

## Brief 2 — `/settings/alerts` (multi-channel alert manager)

**What the mockup claims:** configure alert routing across 11 channels (Email, SMS, Voice,
Discord, Telegram, Zendesk, PagerDuty, Opsgenie, Webhook, In-App, Status Page) with
severity/category policies.

**Reality / overlap:**
- Email + in-app already exist with a per-user preference matrix (`/settings/notifications`).
- Google Chat webhooks already exist, opco-scoped (`/settings/integrations`).
- SMS / Voice / Discord / Telegram / Zendesk / PagerDuty / Opsgenie / Status Page are tools
  CSquared does not run — mockup noise.

**Honest net-new scope:** the channels are mostly done; the only real increment is
**severity/category-based routing policies** (e.g. Critical → also post to Chat and notify
opco admins; Security category → notify a security group). That is an enhancement to the
*existing* notification system, not a separate "Alert Manager" page.

**Size:** M.
**Dependencies:** existing `notifyEvent` dispatch + notification-prefs model.
**Verdict: FOLD, don't build.** Drop the standalone page (it duplicates two working pages).
If severity-routing is wanted, add it to `/settings/notifications` as a policy layer. Low/medium
priority.

## Brief 3 — `/settings/security` (account security self-service)

**What the mockup claims:** enable MFA, manage devices, view active sessions, sign out
everywhere.

**Reality / overlap:** the app is an OIDC client of **Keycloak**, which owns identity, MFA,
device registration and session lifecycle, and exposes them in its **Account Console**.

**Honest options:**
- (a) **Deep-link / redirect** to the Keycloak Account Console from a thin settings page —
  honest, tiny, no duplicated security surface. *Recommended.*
- (b) **Proxy Keycloak's Admin API** to manage MFA/sessions in-app — reimplements Keycloak's
  own UI, ongoing maintenance and security-surface cost.

**Size:** S (deep-link) / M (proxy).
**Dependencies:** Keycloak Account Console URL (deep-link) or Admin API creds (proxy).
**Verdict: INTEGRATE, don't rebuild.** Replace the mockup with a deep-link to the Keycloak
Account Console (or drop it and document that account security lives in Keycloak). Low priority.

## Brief 4 — Odoo integration for management visibility (emergent candidate)

**Not one of the three mockup pages**, but the valuable v2 candidate this exploration surfaced.

**Problem:** management needs visibility into the change-management system, and the
organisational direction is to route reporting/operations through **Odoo** (primary ERP)
where possible.

**Scope (range, to be brainstormed separately):**
- One-way push of change records / status transitions / audit events into Odoo for management
  reporting and visibility (M).
- → up to deeper, possibly bidirectional sync (L).

**Size:** M–L depending on direction.
**Dependencies:** Odoo API access + an agreed data model for what management needs to see.
**Verdict: ROADMAP CANDIDATE.** More valuable than all three mockups combined. Deserves its
own brainstorming → spec → plan cycle; out of scope for this triage.

---

## Recommended follow-ups (not done here)

1. **Cleanup pass** (small, like the prior stub cleanup): remove `/automation` and
   `/settings/alerts` (pages + nav + i18n); rework `/settings/security` into a Keycloak
   Account-Console deep-link (or remove it). To be greenlit separately.
2. **Workplan:** add Brief 4 (Odoo visibility) to Phase 12 (v2.0) of the workplan; record
   Briefs 1–3 as "triaged: drop/fold."
3. **Optional v2 enhancement:** severity/category routing policies on `/settings/notifications`
   (Brief 2), only if there is real demand.
