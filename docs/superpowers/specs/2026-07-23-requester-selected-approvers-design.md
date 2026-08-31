# Requester-selected approvers — design

Date: 2026-07-23

Spec A of two. Spec B (`2026-07-23-notification-expansion-design.md`) depends on this
one, because this spec changes *who* the approval notifications reach. Build this first.

## Problem

Requesters cannot choose their approvers during the request flow, and the one picker that
does exist offers the wrong people.

1. **The picker is on the wrong page.** `AssigneesDialog` lives on the change *detail*
   page (`changes/[id]/`), reachable only after the change exists. A requester filling in
   `/requests/new` never sees it.

2. **The candidate list ignores the eligibility rule.** `changes/[id]/page.tsx:105`
   builds `assigneeCandidates` from *every active user in the change's OpCo*, regardless
   of role. `setChangeAssignees` then rejects the ineligible ones server-side, so the
   dropdown offers people the save will refuse with
   `"Assignee is not an eligible approver for this change's scope"`.

3. **The Equiano exception is unreachable from the UI.** For `Equiano Optics` / `Equiano
   IP`, `routedCabOpcoId()` returns `null`, routing approval to the **group** CAB. Group
   CAB members are generally not in the change's OpCo, so the all-OpCo-users dropdown
   does not list them at all.

4. **Equiano routing leaks.** `approver-routing.ts:3` documents Equiano as group-level,
   and `getRoutedApprovers` honours that. But the private `isEligibleApprover` in
   `assignees.ts:13-18` also accepts any `approver`/`admin` **in the change's OpCo**. A
   requester could therefore name an OpCo approver on an Equiano change, and
   `canUserApproveChange` would authorise them — quietly defeating group-level routing.

5. **The eligibility rule is duplicated.** It exists as a private function in
   `assignees.ts` and, incorrectly, as an inline query in `changes/[id]/page.tsx`. Two
   copies, already divergent.

## Decisions

- Requester-named approvers are **additive, not replacing**. The routed CAB keeps its
  authority and is still notified. A requester can add approvers; they can never remove a
  routed one. This preserves ISO 27001 A.5.3 — a requester cannot narrow their own
  approval pool to the most lenient approver.
- Named approvers **do count toward CAB quorum**. This is already the behaviour
  (`submitApproval:51` sets `isCab: true` on every approval row); the spec makes it
  explicit and tests it rather than leaving it incidental.
- **Equiano is group-only.** For `Equiano Optics` / `Equiano IP`, eligible approvers are
  group CAB members *and nothing else*. The OpCo `approver`/`admin` clause is dropped for
  group-level infra.
- Eligibility gets **one implementation**, in `approval-authority.ts`, used by the picker,
  by `setChangeAssignees`, and by `createChange`. The picker can then never offer someone
  the server will reject.
- The picker moves into the request form and naming at least one approver is
  **mandatory at submit**. Drafts may still be saved without approvers, so a requester can
  fill the form in stages, but `submitChange` refuses a change with no named approver.
  See *Risks* for the operational consequence.

## Eligibility rule

Single source of truth:

```
cabOpcoId = routedCabOpcoId(infraType, opcoId)   // null for Equiano Optics/IP

if (isGroupLevelInfra(infraType)):
    eligible = active members of the group CAB (CABMembership where opcoId IS NULL)
else:
    eligible = active users who are EITHER
                 UserOpCoAssignment in the change's OpCo with role in (approver, admin)
               OR CABMembership with opcoId = cabOpcoId
```

In both branches the requester themselves is excluded — `submitApproval` already rejects
self-approval (SoD), so offering it would be a dead end.

Delegations are **not** included in the picker. A delegate derives authority from the
routed approver they act for; `getRoutedApprovers` already resolves them at notification
time, and `canUserApproveChange` already honours them. Naming a delegate directly would
create a second, non-expiring grant that outlives the delegation window.

## Architecture

```
src/lib/approver-routing.ts          unchanged — EQUIANO_INFRA_TYPES, routedCabOpcoId
src/server/approval-authority.ts     + listEligibleApproversForScope()
                                     + isEligibleApprover()  (moved from assignees.ts)
src/server/actions/approvals.ts      + duplicate-vote guard
src/server/actions/changes.ts        createChange accepts approverIds (transactional)
src/server/actions/assignees.ts      uses the shared rule; private copy deleted
src/app/(dashboard)/requests/new/    approver picker in the request form
src/app/(dashboard)/changes/[id]/    assigneeCandidates uses the shared rule (bug fix)
```

New action, in `approval-authority.ts`:

```ts
listEligibleApproversForScope(
  opcoSlug: string,
  infrastructureType: string,
  excludeUserId?: string,
): Promise<ApproverUser[]>
```

Eligibility depends only on OpCo + infrastructure type, never on a change, so the picker
works before the change exists. `isEligibleApprover(userId, …)` becomes a membership test
against the same query, so list and check can never diverge.

### Request-form integration

`createChange` gains an optional `approverIds: string[]`. It validates every id against
the eligibility rule and writes `ChangeRequest` + `ChangeAssignee[]` inside one
`$transaction`, so a request can never be created with approvers half-applied.

The picker re-queries whenever the **infrastructure type** field changes. Selecting
*Equiano Optics* or *Equiano IP* live-swaps the list from OpCo approvers to the group CAB.
Any already-selected approvers that are not in the new list are cleared, with a visible
notice — silently dropping them would let a requester believe they had nominated someone.

### Mandatory selection

The invariant is *a change in `pending` or beyond has at least one named approver*. It is
enforced at three points:

1. **`submitChange`** — refuses when the change has no `ChangeAssignee` with
   `role: "approver"`, alongside the existing required-field and required-document checks.
   This is the authoritative gate; it holds regardless of which client submitted.
2. **`setChangeAssignees`** — refuses to remove the last named approver when the change's
   status is not `draft`. Without this, a requester could submit with an approver and then
   strip it back out.
3. **The request form** — marks Approvers required and disables Submit until one is
   chosen. Client-side only; a convenience, not the guarantee.

`createChange` deliberately does **not** require `approverIds`. Blocking draft creation
would prevent a requester from saving partial work, and the draft state is not yet subject
to approval.

Because selection is now mandatory, the picker's empty state carries weight. When
`listEligibleApproversForScope` returns nobody, the form shows an explicit blocking
message naming the scope — *"No eligible approvers are configured for Ghana. Contact your
OpCo administrator."*, or for Equiano infra *"No group CAB members are configured."* — so
the requester is told what is wrong and who fixes it, rather than facing a Submit button
that silently refuses.

### Duplicate-vote guard

`ChangeAssignee` already has `@@unique([changeId, userId])`, so the same person cannot be
named twice as approver on a request. `checkCabQuorum` already dedupes by `approverId`
through a `Set`, so two votes from one person cannot satisfy quorum alone.

What is missing is a guard on writing duplicate `Approval` rows — `Approval` has only
`@@index([changeId])`. A DB unique constraint on `(changeId, approverId)` is **rejected**:
an emergency change can legitimately collect a normal approval, be expedited-implemented,
then receive a *retrospective* approval from the same person, and the constraint would
throw on that valid flow.

Instead, `submitApproval` gains an application-level guard: reject a second vote on the
same change from the same user, **unless** this is the retrospective stage
(`isRetrospective === true`). No migration, no edge-case breakage.

## Error handling

- Ineligible `approverId` in `createChange` → throw before the transaction opens; nothing
  is written, so no orphaned draft.
- An approver deactivated between picker load and submit → caught by the same validation;
  the error names the user so the requester can correct it.
- The picker failing to load (network/DB) → renders an inline error with a retry, and
  Submit stays disabled. Since selection is mandatory, a failed load must not be
  indistinguishable from "this scope genuinely has no approvers".
- `submitChange` with no named approver → throws
  `"Cannot submit: at least one approver must be named"`, matching the existing
  `"Cannot submit: required field(s) missing: …"` phrasing so the form surfaces it the
  same way.

## Risks

**Mandatory selection can block an urgent submission.** If an OpCo has no eligible
approver configured — no `approver`/`admin` assignment and an empty OpCo CAB — nobody in
that OpCo can submit a change at all, including an emergency during a live incident. The
same applies to Equiano infra if the group CAB is empty.

This is the accepted trade-off of the mandatory rule, and it is arguably correct: a change
with no possible approver cannot progress anyway, so failing loudly at submit beats
sitting in `pending` unnoticed. Two mitigations are in scope:

- the blocking empty-state message above names the scope and the responsible admin, so the
  fix is obvious rather than mysterious;
- an OpCo with zero eligible approvers is a pre-existing configuration fault that this
  change makes visible rather than creates.

If the incident risk proves unacceptable in practice, the escape hatch is a one-line
exemption in `submitChange` for `isEmergency` changes, which already route to a CAB
automatically. It is deliberately **not** included now.

## Testing

`src/test/server/approval-authority.test.ts` (extend)
- OpCo infra: returns OpCo `approver` + `admin` + OpCo CAB members
- Equiano infra: returns group CAB members **only** — asserts an OpCo approver is absent
- inactive users excluded; `excludeUserId` (the requester) excluded
- delegates are absent from the eligible list but still present in `getRoutedApprovers`
- `isEligibleApprover` agrees with `listEligibleApproversForScope` for the same inputs

`src/test/actions/changes.test.ts` (extend)
- `createChange` with `approverIds` writes `ChangeAssignee` rows with `role: "approver"`
- `createChange` **without** `approverIds` still succeeds — drafts are exempt
- an ineligible id throws and writes no `ChangeRequest`
- an OpCo approver id on an Equiano change throws
- `submitChange` throws when the change has no named approver
- `submitChange` succeeds with one named approver
- an emergency change with no named approver is **also** blocked (documents the
  deliberate absence of an emergency exemption — see *Risks*)

`src/test/actions/assignees.test.ts` (extend)
- the eligibility rule still holds after the refactor to the shared function
- Equiano change rejects an OpCo approver (regression test for the leak in Problem #4)
- removing the last named approver is rejected when status is `pending`
- removing the last named approver is allowed when status is `draft`

`src/test/actions/approvals.test.ts` (extend)
- a second vote from the same user on a pending change is rejected
- a retrospective vote from a user who already voted normally is **allowed**
- two distinct named (non-CAB-member) approvers satisfy quorum on a high-risk change

Request-form render test
- changing infrastructure type to `Equiano IP` re-queries the picker
- selected approvers not in the refreshed list are cleared and a notice is shown
- Submit is disabled with no approver selected, enabled with one
- an empty eligible list renders the scope-specific blocking message
- a failed picker load renders an error with retry, and Submit stays disabled

## Scope

~7 files, no migration. New user-visible strings (picker label, required-approver error,
empty-state messages, picker-cleared notice) go through `src/lib/i18n.ts` in EN and FR
like every other string in the app.

Excluded: any change to quorum size, delegation semantics, or the approval-matrix admin UI.
