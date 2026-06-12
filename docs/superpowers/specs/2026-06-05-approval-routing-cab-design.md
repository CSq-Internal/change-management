# Approval Routing via CAB — Design

**Date:** 2026-06-05
**Status:** Approved (design) — supersedes the demo-deadline `isGroupCto` shortcut
**Branch:** `feat/approval-routing-by-infra`

## Summary

Route change approvals by **infrastructure type** to the correct **CAB**, and make **CAB
membership the single source of approval authority**. This replaces the demo-era
`User.isGroupCto` flag and its ad-hoc checks with the existing, DB-backed CAB model.
Delegations provide temporary stand-in authority (CTO on leave / unseated).

## Domain model (confirmed with stakeholder)

- **Group CTO (Samuel Yeboah)** is, organizationally, a **group admin**, sits on the
  **group CAB** and on **every OpCo CAB** (as secondee).
- **Resident / country CTO** is an **OpCo admin** and sits on that **OpCo's CAB**.
- The **CAB *is* the set of approvers** — there is no approver who isn't on a CAB.
- An admin (group or OpCo) already implies approver capability (`canApprove` includes
  `admin`; `group_admin` is a global override) — so role alone cannot gate approvals
  (an OpCo admin would otherwise be able to approve an Equiano change). Authority is
  therefore **CAB membership**, not role.

## Routing rule (infra type → which CAB)

| Infrastructure type | Routed CAB |
|---|---|
| Equiano Optics, Equiano IP | **Group CAB** (`CABMembership.opcoId = null`) |
| Backbone Transport, Metro Transport, Wifi, Internal IT, Backbone IP | The change's **OpCo CAB** (`opcoId = change.opcoId`) |

`isGroupLevelInfra(infraType)` (already in `src/lib/approver-routing.ts`) selects the group CAB.

## Authority model

A user may **approve** a change iff **any** of:
1. They are an **active member of the routed CAB** (group CAB for Equiano; the change's
   OpCo CAB otherwise), **or**
2. They hold an **active delegation** (within `validFrom`/`validUntil`, `isActive`) from a
   member of the routed CAB, **or**
3. They are `group_admin` (global break-glass override; what `devops` uses).

Segregation of Duties is retained: a requester can never approve their own change
(ISO 27001 A.5.3).

### Quorum (how many approvals advance `pending → approved`)

- **Equiano** → **single approval** (Samuel is the sole group-CAB approver); quorum rules
  do not apply, regardless of risk.
- **Non-Equiano** → existing **risk-based** rule, evaluated over the routed OpCo CAB:
  - low / medium → **1** approval from a CAB member,
  - high / emergency → **CAB quorum** = **2 distinct** CAB approvers (`checkCabQuorum`).
- A CAB member's approval is recorded with `isCab = true` so it counts toward quorum.
- A **delegate's** approval counts as the delegating member's CAB vote (one vote, not two).

## Delegation

- `ApproverDelegation` becomes usable for approvals (currently the model exists but is not
  wired into `submitApproval`).
- **Schema change:** make `ApproverDelegation.opcoId` **nullable** to support **group-level
  delegation** (so Equiano remains approvable when Samuel is away). `opcoId = null` ⇒
  delegation of group-CAB authority; `opcoId = X` ⇒ delegation of OpCo-X-CAB authority.
- Authorization resolves delegations active **now** whose `fromUser` is a member of the
  routed CAB.

## Visibility (approvals queue + change detail)

- The **approvals queue** lists pending changes whose **routed CAB the caller belongs to**
  (or that they hold an active delegation into). Samuel sees all (group CAB + every OpCo
  CAB); a resident CTO sees their OpCo's. `group_admin` sees everything.
- Change-detail `caps.canApprove` uses the same authority predicate.

## What is removed (the shortcut)

- `User.isGroupCto` column (**drop-column migration**).
- The `isGroupCto` query in `resolveApproverUsers`.
- The `isGroupCto` checks in `submitApproval`, `getChange`, the approvals page, and the
  change-detail page — all replaced by the CAB-membership authority predicate.

## CAB seating

- `addCabMember` currently requires the user to already hold an **`approver`** assignment.
  Relax it to also accept **`admin`** (admin ⊇ approver), so resident-CTO admins can be
  seated directly.
- The `approver` role is **kept** in the schema: it is the CAB-seating eligibility and is
  still used by lifecycle actions (e.g. advancing `approved → implemented`). The collapse
  is scoped to the **approval decision** only; lifecycle-advancement authorization remains
  role-based (out of scope to change here).

## Notifications / email

- `submitChange` notifies the **routed CAB's members** (group CAB for Equiano; OpCo CAB
  otherwise) plus any active delegates standing in for them.
- Email transport (already added, to be **kept and formalized**, not reverted):
  - **Resend** primary (when `RESEND_API_KEY` set),
  - **Gmail app-password via nodemailer** fallback (`SMTP_USER` / `APP_PASSWORD`) —
    Workspace-friendly, avoids Resend domain config,
  - **`TEST_EMAIL_RECIPIENT`** redirect in dev to avoid spamming real users,
  - mock `console.log` when neither is configured.
  - Document these env vars; tidy the dev `from`.

## Seed

- Remove `isGroupCto` seeding.
- Seed Samuel: OpCo/group **admin**, seated on the **group CAB** and **every OpCo CAB**.
- Seed each resident CTO: **OpCo admin**, seated on that **OpCo CAB**.
- Optionally seed one sample delegation (resident CTO → deputy) to exercise the path.
- Use the existing CAB-assignment flow semantics (so seed and UI stay consistent).

## Cleanup

- Delete throwaway root scripts `fix-email.ts` (breaks `pnpm tsc`/`build`) and
  `update-keycloak-id.ts`.
- Decide `.codex/` and `AGENTS.md`: gitignore or remove (do not ship loose).
- Consolidate the branch into coherent commits.

## Testing

- Routing: Equiano → group CAB; others → OpCo CAB (unit on the resolver).
- Authority: CAB member can approve; non-CAB approver cannot; delegate can; requester
  cannot (SoD); `group_admin` override.
- Quorum: Equiano single approval advances; non-Equiano low/med single; high/emergency
  needs 2 distinct CAB votes; delegate's vote counts once.
- Visibility: queue scoped to routed CABs.
- `addCabMember` accepts admin.
- Keep the suite green; update `changes.test` / `approvals.test` to the new model.

## Out of scope (future)

- Changing lifecycle-advancement (`updateChangeStatus`) to CAB-based authority.
- Multi-level / sequential approval chains beyond the risk-based quorum.
- Group-level delegation UI (schema supports it; admin UI can come later).
