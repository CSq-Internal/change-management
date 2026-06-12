# v1.0 Completion — Bundle 4: Approval Completeness — Design

**Date:** 2026-06-08
**Branch:** `feat/v1-approval-completeness` (off `dev`)
**Source:** PRD v1.0 gap analysis — the final v1.0 bundle. Configurable approver matrix, requester-named assignees (the unused `ChangeAssignee` model), and pending-approval handling on deactivation.

## Goal

1. **Configurable approver matrix** — per (infrastructure type × OpCo) explicit approver overrides that replace CAB routing when present; editable on `/approval-matrix`.
2. **Requester-named assignees** — `ChangeAssignee` gains a role (`approver` | `implementer`); approver-role assignees may also approve (validated), implementer-role are surfaced on the change.
3. **Deactivation handling** — deactivating a user ends their CAB/override approver roles, notifies remaining routed approvers of their pending changes, and warns the admin (non-blocking) about any change left with zero eligible approvers.

## Locked decisions (confirmed 2026-06-08)

- **Matrix:** full per-(infra × opco) approver overrides; **opt-in** — a change with no override for its (infra, routing-level) falls back to today's CAB routing. Nothing is seeded; existing behaviour is unchanged.
- **Assignees:** both roles (`approver` and `implementer`). Approver-role assignees must already hold approver/admin authority (or CAB membership / group) in the change's scope — naming directs + authorizes them for *this* change, it does not grant power to arbitrary users.
- **Deactivation:** end CAB + deactivate overrides, notify remaining approvers (reusing the existing `approval_requested` notification — no new event type), and return orphaned pending changes for a non-blocking admin warning.
- **Quorum is unchanged.** `submitApproval` already records `isCab: true` for every authorized approval, so override and named approvers already count toward the existing risk-based quorum — **no quorum/isCab code change is needed.**

## Backward-compatibility guarantee

All three parts are additive. The routing *level* rule (`isGroupLevelInfra`/Equiano) stays. CAB routing remains the default. The existing approval tests must stay green; new behaviour only activates when an override or assignee exists.

---

## Part A — Configurable approver matrix

### Schema (`prisma/schema.prisma`)

```prisma
model ApproverAssignment {
  id                 String   @id @default(cuid())
  infrastructureType String
  opcoId             String?  // null = the group-level routing slot (Equiano-type infra)
  opco               OpCo?    @relation(fields: [opcoId], references: [id])
  userId             String
  user               User     @relation("ApproverAssignments", fields: [userId], references: [id])
  isActive           Boolean  @default(true)
  createdById        String
  createdAt          DateTime @default(now())

  @@unique([infrastructureType, opcoId, userId])
  @@index([infrastructureType, opcoId])
  @@index([userId])
}
```

Back-relations: `User.approverAssignments`, `OpCo.approverAssignments`.

### Routing change (`src/server/approval-authority.ts`)

`getRoutedApprovers(change)` — compute `cabOpcoId = routedCabOpcoId(infra, opcoId)` (unchanged), then:
- Query active `ApproverAssignment` for `(infrastructureType, opcoId = cabOpcoId)`. **If any exist**, the routed approvers are those assigned users (active only) — the override replaces CAB. **Else**, the existing CAB-membership lookup (unchanged).
- Active delegations from the routed approver ids still apply on top, in both branches (keep the existing delegation logic, sourced from whichever set is routed).

This keeps `canUserApproveChange` and `listApprovableChanges` correct automatically (they call `getRoutedApprovers`).

### Editable matrix (`src/server/actions/approval-matrix.ts` + page)

- `listApproverAssignments()` — all active assignments grouped for the admin's manageable scopes (group_admin: all; OpCo admin: their opcos + group-level rows? — OpCo admins manage only their OpCo's per-infra rows; group-level (opcoId null) rows require group_admin).
- `addApproverAssignment({ infrastructureType, opcoSlug | null, userId })` / `removeApproverAssignment(id)` — permission: group-level (opcoSlug null) → group_admin; OpCo row → group_admin or that OpCo admin. Validate the user is an active member/approver of the scope. Audited to `AdminAuditLog` (`approver_assignment_added`/`approver_assignment_removed`).
- `/approval-matrix` page becomes interactive: the existing read-only routing table stays; a new "Approver overrides" card lets admins pick infra type + scope + user and add/remove. With no override for a slot, the page still shows the CAB default (as today).

---

## Part B — Requester-named assignees (`ChangeAssignee` + role)

### Schema

```prisma
enum AssigneeRole {
  approver
  implementer
}
```
Add to `model ChangeAssignee`: `role AssigneeRole @default(implementer)`, and a `user User @relation("ChangeAssignments", fields: [userId], references: [id])` relation (back-relation `User.changeAssignments`).

### Authorization (`src/server/approval-authority.ts`)

- New `getNamedApprovers(changeId)` — active users with an `approver`-role `ChangeAssignee` on the change.
- `canUserApproveChange` gains an optional `changeId`; returns true if group_admin **or** in `getRoutedApprovers(change)` **or** (changeId given) in `getNamedApprovers(changeId)`.
- `submitApproval` passes the `changeId` through (it already has it). `listApprovableChanges` also passes `c.id`, so a named approver sees the change in their `/approvals` queue.
- `submitChange` notification recipients = `getRoutedApprovers(change)` ∪ `getNamedApprovers(change.id)` (deduped) for `approval_requested`.

### Action (`src/server/actions/assignees.ts`)

- `setChangeAssignees(changeId, assignees: { userId: string; role: "approver" | "implementer" }[])` — permission: the change's requester or an OpCo/group admin. For each `approver`-role entry, **validate** the user holds approver authority in the change's scope: `isGroupAdmin` OR `hasRoleInOpCo(orgs, opcoSlug, "approver"|"admin")` OR an active CAB membership for the routed opco. Reject if not eligible. Replace the change's assignees (delete existing for the change, recreate). Audit (`assignees_set`).
- `listChangeAssignees(changeId)` — for rendering.

### UI (change detail)

Serialize the change's assignees (role + user name/email) into the detail page. Add an **"Assigned to"** card listing implementer-role assignees and a **"Named approvers"** card listing approver-role assignees. Requester/admin gets a small **manage dialog** (add a user with a role, remove). Reuse the custom-modal pattern.

---

## Part C — Deactivation handling

### `src/server/approver-reassign.ts` (new, db-mocked test)

```ts
type FootprintChange = { id: string; reference: number; title: string; infrastructureType: string; opcoId: string }

// Pending changes the user is a routed/named approver of. Called BEFORE deactivation,
// while the user is still in routing.
export async function approverPendingFootprint(userId: string): Promise<FootprintChange[]>

// Called AFTER the deactivation transaction commits (user already removed from CAB/overrides).
// For each footprint change, recompute the remaining routed+named approvers, notify them via
// notifyEvent(approval_requested), and collect the changes left with zero approvers.
export async function notifyRemainingAndDetectOrphans(
  footprint: FootprintChange[]
): Promise<{ orphaned: { id: string; reference: number; title: string }[] }>
```

### `deactivateUser` change (`src/server/actions/users.ts`)

1. Before the transaction: `const footprint = await approverPendingFootprint(userId)`.
2. Inside the existing `$transaction`: additionally `cABMembership.updateMany({ where: { userId, isActive: true }, data: { isActive: false, endedAt: now } })` and `approverAssignment.updateMany({ where: { userId, isActive: true }, data: { isActive: false } })`.
3. After commit: `const { orphaned } = await notifyRemainingAndDetectOrphans(footprint)` (best-effort; never throws into the deactivation).
4. Return `{ orphanedChanges: orphaned }`. (Existing callers that ignore the return value keep working.)

### UI (`user-management` client)

`deactivateUser` now returns `{ orphanedChanges }`. The deactivate confirm/handler shows a **non-blocking warning toast/dialog** when `orphanedChanges.length > 0`, listing the references (e.g. "Deactivated. ⚠ 2 pending changes now have no approver: #12, #15 — assign an approver.").

---

## Files

**Create:**
- `src/server/actions/approval-matrix.ts` (+test) — assignment CRUD.
- `src/server/actions/assignees.ts` (+test) — `setChangeAssignees`/`listChangeAssignees`.
- `src/server/approver-reassign.ts` (+test) — footprint + reassignment/orphan detection.
- `src/app/(dashboard)/approval-matrix/approval-matrix-client.tsx` — override editor.
- `src/app/(dashboard)/changes/[id]/assignees-dialog.tsx` — manage assignees.
- `prisma/migrations/<ts>_approval_completeness/migration.sql`

**Modify:**
- `prisma/schema.prisma` — `ApproverAssignment`, `AssigneeRole`, `ChangeAssignee.role` + relation, back-relations.
- `src/server/approval-authority.ts` — override-aware `getRoutedApprovers`, `getNamedApprovers`, `canUserApproveChange(changeId?)`.
- `src/server/actions/changes.ts` — `submitChange` notifies routed ∪ named approvers.
- `src/server/actions/approvals.ts` — pass `changeId` to `canUserApproveChange`.
- `src/server/actions/users.ts` — `deactivateUser` footprint + end CAB/overrides + notify + return orphans.
- `src/app/(dashboard)/approval-matrix/page.tsx` — load assignments + render client.
- `src/app/(dashboard)/changes/[id]/page.tsx` + `change-detail-client.tsx` — assignees cards + dialog.
- relevant user-management client — orphan warning.
- `src/lib/i18n.ts` — strings (en + fr).

## Testing

- **Unit/action (db-mocked):** `getRoutedApprovers` returns overrides when present, CAB fallback otherwise; `getNamedApprovers`; `canUserApproveChange` true for named approver-role; `setChangeAssignees` validates approver eligibility + rejects ineligible; `addApproverAssignment` permission (group vs opco) + audit; `reassignOnDeactivation` notifies remaining + flags orphans.
- **Regression:** the existing `approvals.test.ts` / `changes.test.ts` quorum + SoD + routing tests stay green (override/named paths are inert without data).
- **Playwright smoke:** add an approver override for an (infra, opco) and confirm that approver appears in the change's approvals authority + a non-CAB override approver can approve; name an implementer + an approver on a change and see both on detail; deactivate an approver who is the sole approver of a pending change and confirm the orphan warning.

## Out of scope (this bundle)

Configurable quorum thresholds (stay code-based); reassigning *already-cast* approvals; approver workload balancing; bulk matrix import. The `/settings/alerts` and `/automation` stubs remain placeholders.
