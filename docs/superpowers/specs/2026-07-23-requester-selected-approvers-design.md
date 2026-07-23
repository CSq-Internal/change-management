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
- The picker moves into the request form and is **optional**. Submission is not blocked
  when no approver is named, because an OpCo with no configured eligible approver would
  otherwise be unable to raise a request at all.

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
- The picker failing to load (network/DB) → renders empty with an inline error, and the
  form still submits. Approver nomination is optional, so it must never block a request.

## Testing

`src/test/server/approval-authority.test.ts` (extend)
- OpCo infra: returns OpCo `approver` + `admin` + OpCo CAB members
- Equiano infra: returns group CAB members **only** — asserts an OpCo approver is absent
- inactive users excluded; `excludeUserId` (the requester) excluded
- delegates are absent from the eligible list but still present in `getRoutedApprovers`
- `isEligibleApprover` agrees with `listEligibleApproversForScope` for the same inputs

`src/test/actions/changes.test.ts` (extend)
- `createChange` with `approverIds` writes `ChangeAssignee` rows with `role: "approver"`
- an ineligible id throws and writes no `ChangeRequest`
- an OpCo approver id on an Equiano change throws

`src/test/actions/assignees.test.ts` (extend)
- the eligibility rule still holds after the refactor to the shared function
- Equiano change rejects an OpCo approver (regression test for the leak in Problem #4)

`src/test/actions/approvals.test.ts` (extend)
- a second vote from the same user on a pending change is rejected
- a retrospective vote from a user who already voted normally is **allowed**
- two distinct named (non-CAB-member) approvers satisfy quorum on a high-risk change

Request-form render test
- changing infrastructure type to `Equiano IP` re-queries the picker
- selected approvers not in the refreshed list are cleared and a notice is shown

## Scope

~6 files, no migration. Excluded: any change to quorum size, delegation semantics, or the
approval-matrix admin UI.
