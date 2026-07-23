# Notification expansion — email across the request flow

Date: 2026-07-23

Spec B of two. Depends on `2026-07-23-requester-selected-approvers-design.md` (Spec A),
which changes who the approval notifications reach. Build Spec A first.

## Problem

Only five moments in the change lifecycle notify anyone. Every other transition writes an
`AuditLog` row and tells nobody.

Wired today, all through `notifyEvent`:

| Event | Fires in | Recipients |
| --- | --- | --- |
| `approval_requested` | `submitChange` | routed approvers + named approvers |
| `emergency_submitted` | `submitChange` (emergency) | group CAB |
| `change_approved` | `submitApproval`, quorum met | requester |
| `change_rejected` | `submitApproval`, reject | requester |
| `sla_escalated` | `/api/cron/sla` | admins |

Silent today: submission receipt to the requester, implementation, verification (PIR),
closure, cancellation, reopening, rescheduling, assignment, retrospective
approval/rejection, and the 48-hour retro-approval deadline.

Two structural problems block simply adding more calls:

1. **Recipients are hand-picked at each call site.** Thirteen more events would mean
   thirteen more copies of "load the requester, load the assignees, dedupe" — the source
   of the "who should have been told?" class of bug.
2. **`isChannelEnabled` returns `true` whenever no preference row exists**
   (`notifications.ts:57`). Adding thirteen event types would silently switch on email for
   every one of them, for every user.

## Decisions

- A **central audience resolver** maps each event type to role-based groups. Call sites
  say what happened, not who to tell.
- **One generic `ChangeEventEmail` template** renders all new events. The five existing
  bespoke templates stay unchanged.
- **Per-event channel defaults.** Email defaults on only when the recipient is the direct
  subject; ambient events are in-app only. Defaults live in code, so no migration and no
  backfill — preference rows are still written only when a user toggles something.
- **The preference matrix is grouped** into four labelled sections. Eighteen event types
  × two channels is 36 toggles; a flat list is unusable.
- **Reminders reuse `/api/cron/sla`.** No new endpoint, secret, `vercel.json` entry, or
  Cloud Scheduler job.
- **A send ledger** (`NotificationDispatch`) makes recurring reminders idempotent.
- **Chat broadcast grows by exactly two**: `change_implemented`, `change_verified`.
- The **actor is suppressed** from their own event, except `change_submitted`, which is
  deliberately a receipt to the requester who just submitted.

## Architecture

```
src/lib/notifications.ts        extend  18 event types, DEFAULT_CHANNELS, copy, chat text
src/server/audience.ts          new     resolveAudience(type, change) -> NotifyRecipient[]
src/server/notify.ts            extend  notifyChange() facade + ledger writes
src/emails/change-event.tsx     new     generic parameterized template
src/server/reminders.ts         new     cron sweep
src/app/api/cron/sla/route.ts   extend  runs the sweep after runDueEscalations
prisma/schema.prisma            extend  NotificationDispatch
```

Call sites collapse to one line:

```ts
await notifyChange("change_implemented", changeId, { actorId: user.id }).catch(() => {})
```

`notifyChange` loads the change once, resolves the audience, dedupes, drops the actor,
applies `DEFAULT_CHANNELS` then stored preferences, writes the ledger row, and fans out.

The existing `notifyEvent({ recipients, … })` stays as the low-level primitive, so the
five current call sites keep working unchanged and can migrate later.

### Audience resolver

`resolveAudience` maps an event type to role groups, then resolves each against the DB:

| Role group | Resolution |
| --- | --- |
| `requester` | `ChangeRequest.requesterId` |
| `assignees` | `ChangeAssignee` for the change, both roles |
| `voters` | distinct `Approval.approverId` for the change |
| `approversPending` | `getRoutedApprovers()` + named approvers, minus voters |
| `opcoAdmins` | active `UserOpCoAssignment` with `role: "admin"` in the change's OpCo |
| `groupCab` | active `CABMembership` where `opcoId IS NULL` |

Inactive users are dropped in every group. The result is deduped by `userId`.

`approversPending` reuses Spec A's `getRoutedApprovers`, so the nudge reaches exactly the
people who can actually act — including requester-nominated approvers.

### Event catalog

Thirteen new types, bringing the total to eighteen.

| Event | Fires in | Audience | Email default |
| --- | --- | --- | --- |
| `change_submitted` | `submitChange` | requester (receipt) | on |
| `change_implemented` | `updateChangeStatus` | requester, assignees, voters | on |
| `change_verified` | `submitPostImplementationReview` | requester, opcoAdmins | on |
| `change_closed` | `updateChangeStatus` | requester, assignees | in-app |
| `change_reopened` | `updateChangeStatus` → draft | requester, voters | in-app |
| `change_cancelled` | `discardChange` | requester, assignees, voters | in-app |
| `change_rescheduled` | `rescheduleChange` | requester, assignees, voters | in-app |
| `assignee_added` | `setChangeAssignees` | the newly named user | on |
| `assignee_removed` | `setChangeAssignees` | the removed user | in-app |
| `retro_approved` | `submitApproval` (retrospective) | requester, opcoAdmins | on |
| `retro_rejected` | `submitApproval` (retrospective) | requester, opcoAdmins | on |
| `retro_overdue` | cron sweep | requester, groupCab | on |
| `approver_nudge` | cron sweep | approversPending | on |

`setChangeAssignees` replaces all rows on every save, so `assignee_added` /
`assignee_removed` are computed by diffing the previous set against the new one inside the
transaction — otherwise every save would notify everyone.

Preference matrix groups:

- **Approvals** — `approval_requested`, `approver_nudge`, `change_approved`, `change_rejected`
- **Lifecycle** — `change_submitted`, `change_implemented`, `change_verified`, `change_closed`, `change_reopened`, `change_cancelled`, `change_rescheduled`
- **Assignment** — `assignee_added`, `assignee_removed`
- **Emergency & SLA** — `emergency_submitted`, `sla_escalated`, `retro_approved`, `retro_rejected`, `retro_overdue`

`isChannelEnabled` changes its fallback from a blanket `true` to
`DEFAULT_CHANNELS[type][channel]`. The five existing types are all `{ email: true, in_app:
true }`, so current behaviour is preserved exactly.

### Email template

One `ChangeEventEmail`, built on the existing `EmailLayout` / `CtaButton` / `Pill`
primitives:

```tsx
<ChangeEventEmail
  lang="en"
  headline="Change implemented"
  intro="Kofi marked your change as implemented."
  pill={{ tone: "approved", label: "implemented" }}
  rows={[["Change", …], ["OpCo", …], ["Risk", …], ["Window", …]]}
  note="Backout not required."
  cta={{ href: "/changes/abc123", label: "View request" }}
/>
```

Copy for all eighteen types lives in `notifications.ts` in EN and FR, alongside the
existing `notificationContent` and `chatMessageText`.

Deep links point at `/changes/<id>`, the live change-detail route. The five existing
templates link to the bare `/changes` list, which now redirects — they are repointed at
`/changes/<id>` as part of this work, since every one of them already has the change id
in scope.

### Idempotency and reminders

```prisma
model NotificationDispatch {
  id        String   @id @default(cuid())
  userId    String
  changeId  String
  type      String
  sentAt    DateTime @default(now())

  @@index([userId, changeId, type, sentAt])
}
```

Written after a fan-out attempt. Event-driven sends do not consult it — they are
inherently one-shot — but they do write to it, so the ledger is a complete record.

The sweep in `reminders.ts` consults it, with per-type minimum intervals:

- `approver_nudge` — pending changes past 50% of their `SLA_HOURS` window, at most once
  per 24h per approver per change. Suppressed once the change breaches, since
  `sla_escalated` takes over.
- `retro_overdue` — expedited emergencies whose `retroApprovalDueAt` is within 12 hours or
  already past, and `retroApprovedAt` is null; at most once per 12h.

`/api/cron/sla` runs the sweep after `runDueEscalations` and returns
`{ escalations: […], reminders: […] }`. Schedule, secret, and both auth conventions are
unchanged.

## Error handling

Notifications stay best-effort and must never fail a domain operation. `notifyChange` is
`.catch(() => {})` at every call site and uses `Promise.allSettled` internally, so a dead
Resend key or an unreachable Chat webhook cannot roll back a status transition.

Two ordering constraints:

- `submitPostImplementationReview` returns from inside a `$transaction`. `notifyChange`
  fires **after** the transaction commits, never within it.
- `setChangeAssignees` computes its add/remove diff inside the transaction but notifies
  after commit, for the same reason.

A ledger write that fails is logged and swallowed; the worst case is a reminder sent twice.

## Testing

`src/test/lib/notifications.test.ts` (extend)
- copy for all thirteen new types in EN and FR
- `isChannelEnabled` falls back to `DEFAULT_CHANNELS`, not blanket `true`
- the five existing types resolve to `{ email: true, in_app: true }` — no behaviour change
- `CHAT_BROADCAST_TYPES` contains exactly six types

`src/test/server/audience.test.ts` (new)
- each event type resolves to its documented role set
- overlapping groups dedupe by `userId`
- actor suppression, including the `change_submitted` receipt exception
- inactive users excluded from every group
- `approversPending` excludes users who have already voted

`src/test/server/reminders.test.ts` (new)
- nudge fires past the SLA midpoint, not before
- nudge suppressed within 24h of the last ledger row
- nudge suppressed once the change has breached SLA
- `retro_overdue` fires inside the 12h window and when already past due
- `retro_overdue` does not fire once `retroApprovedAt` is set
- ledger rows written with the right `(userId, changeId, type)`

`src/test/emails/change-event.test.tsx` (new)
- renders EN and FR without throwing
- CTA href is `/changes/<id>`

Existing action suites (extend) — `changes.test.ts`, `approvals.test.ts`, `pir.test.ts`,
`assignees.test.ts`, `reschedule.test.ts`: assert `notifyChange` is called with the correct
type on each transition, and that a throwing `notifyChange` does not fail the action.

## Scope

~13 files, one additive migration, no backfill. Excluded: digest/batching, SMS or push
channels, per-OpCo notification policy, and migrating the five existing call sites off
`notifyEvent` (they keep working; migration is optional follow-up).
