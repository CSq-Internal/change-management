# ISO 27001:2022 — P0 Hardening Design

**Date:** 2026-06-06
**Branch:** `feat/iso-p0-pir-sod-emergency` (off `dev`)
**Source plan:** `docs/iso27001-implementation-plan.html` (P0 items 1–3)

## Goal

Close the three highest-value, most ISO-explicit gaps in the change-management workflow:

1. **Implementer Segregation of Duties (A.5.3)** — record who implemented a change and stop the *sole* approver from also implementing it.
2. **Post-Implementation Review (A.8.32)** — require a structured review on every change before it can reach `verified`.
3. **Emergency expedited workflow (A.8.32)** — let emergency changes be implemented under emergency authority, then require retrospective approval **and** a PIR within 48 hours.

All three sit on top of the existing lifecycle in `src/server/actions/changes.ts` and the immutable `AuditLog`.

## Locked decisions (confirmed with stakeholder, 2026-06-06)

- **SoD strictness:** *lenient* — block implementation only when the actor is the **sole** approver of that change.
- **Emergency model:** *true expedited* — implement first under emergency authority, then mandatory retrospective approval + PIR.
- **Retrospective window:** **48 hours**.
- **PIR scope:** **all** changes require a PIR before `verified`.
- **Emergency entry point:** an emergency must still be **submitted** (so the 5 required planning/backout documents exist) before the expedited implement. Emergencies defer the *approval* step, not the *evidence*.

## Existing lifecycle (unchanged shape)

```
draft → pending → approved → implemented → verified → closed
                → rejected → (reopen) draft
```

`submitApproval` drives `pending → approved|rejected`. `updateChangeStatus` drives `approved→implemented→verified→closed` and the reopen. Transitions are guarded by `VALID_TRANSITIONS` + RBAC.

## Schema changes (`prisma/schema.prisma`)

Add to `model ChangeRequest`:

```prisma
  implementedById   String?
  implementedBy     User?      @relation("Implementer", fields: [implementedById], references: [id])
  implementedAt     DateTime?
  expedited         Boolean    @default(false)   // emergency implemented before approval
  retroApprovalDueAt DateTime?                    // 48h deadline for retrospective approval
  pir               PostImplementationReview?
```

Add the back-relation on `model User`: `implementedChanges ChangeRequest[] @relation("Implementer")`.

New enum + model:

```prisma
enum PirOutcome { success partial failed }

model PostImplementationReview {
  id          String        @id @default(cuid())
  changeId    String        @unique
  change      ChangeRequest @relation(fields: [changeId], references: [id])
  outcome     PirOutcome
  summary     String
  backoutUsed Boolean       @default(false)
  authorId    String
  author      User          @relation("PirAuthor", fields: [authorId], references: [id])
  createdAt   DateTime      @default(now())

  @@index([changeId])
}
```

(+ `pirReviews PostImplementationReview[] @relation("PirAuthor")` back-relation on `User`.)

**Migration:** one additive migration `prisma/migrations/<ts>_iso_p0_pir_sod_emergency/migration.sql`, applied with `migrate deploy` (TTY-free, per repo convention). Additive only — no data backfill needed.

## Feature 1 — Implementer SoD

In `updateChangeStatus`, for `approved → implemented`:

- Load the change's distinct **approve** voters (`Approval` where `decision = "approve"`).
- If that set equals `{ actor.id }` (the actor is the only approver) → throw `Forbidden: the sole approver cannot also implement this change (SoD — ISO 27001 A.5.3)`.
- Otherwise set `implementedById = actor.id`, `implementedAt = now`.

Emergencies are unaffected (0 approvers ⇒ never a "sole approver"). Existing RBAC (approver/admin/group_admin) still gates who may implement.

## Feature 2 — Post-Implementation Review

New action `submitPostImplementationReview(changeId, { outcome, summary, backoutUsed })` in `src/server/actions/pir.ts`:

- Authorised to the **implementer**, an approver, or an admin/group_admin for the change's OpCo.
- Allowed only when status is `implemented`.
- In one `$transaction`: create the `PostImplementationReview`, advance `implemented → verified`, and write an `AuditLog` (`action: "pir_recorded"`, plus the status transition).
- `summary` is required; `outcome` required; `backoutUsed` defaults false.

**Backstop:** `updateChangeStatus` rejects any `implemented → verified` when no PIR exists, so `verified` is reachable only through the PIR action.

## Feature 3 — Emergency expedited + retrospective

**Expedited implement** — in `updateChangeStatus`, allow `pending → implemented` **only when `isEmergency`**:

- Requires approver/admin/group_admin authority (same gate as normal implement).
- Sets `expedited = true`, `retroApprovalDueAt = now + 48h`, plus the implementer stamps from Feature 1.
- `VALID_TRANSITIONS.pending` gains `implemented`, guarded so non-emergency changes still cannot skip approval.

**Retrospective approval** — extend `submitApproval` to also accept a change that is `isEmergency && status === "implemented" && expedited` and has no post-implementation approval yet:

- A single `approve` suffices (emergency) and records an `Approval { isCab: true }` after the fact (sanctioning the change). Status stays `implemented`.
- A retrospective `reject` is recorded as a governance note (does **not** auto-rollback; out-of-band handling). Audited either way.

**Verify gate** — for an `expedited` change, the PIR action's `implemented → verified` additionally requires that a retrospective approval exists; otherwise it throws.

**Visibility** — `src/lib/dashboard-metrics.ts` gains a metric: expedited emergencies where `retroApprovalDueAt < now` and no retrospective approval exists ("overdue emergency review"), surfaced on the dashboard status bar / triage.

## UI (`src/app/(dashboard)/changes/[id]/...`)

- Implementer line + `implementedAt` on the detail overview/timeline.
- PIR form shown when status is `implemented` (outcome select, summary, backout-used checkbox) → calls the PIR action.
- For expedited emergencies: a "retrospective approval due by …" badge and a retro-approve action for routed approvers; verify is blocked until both retro approval + PIR exist (with a clear message).

## Audit & evidence

Every new step writes immutable `AuditLog` rows (`implemented`, `pir_recorded`, retrospective `approved`/`rejected`, `verified`), which already flow into the CSV export at `src/app/api/audit-export/route.ts`.

## Testing

Unit (Vitest, db mocked) + one integration/E2E:

- **SoD:** sole-approver blocked; multi-approver or non-approver allowed; implementer recorded.
- **PIR:** `verified` blocked without PIR; PIR action records + advances; authz enforced; only at `implemented`.
- **Emergency:** non-emergency cannot `pending → implemented`; emergency expedited sets `expedited` + `retroApprovalDueAt`; retrospective `submitApproval` accepted on implemented expedited change; verify blocked for expedited until retro approval + PIR.
- **Dashboard metric:** overdue-retro detection.
- **Playwright smoke:** approve → implement → PIR → verified happy path on the running app.

## Components & boundaries

- `src/server/actions/changes.ts` — `updateChangeStatus` (SoD, expedited implement, verify-needs-PIR gate).
- `src/server/actions/pir.ts` *(new)* — `submitPostImplementationReview` (record + verify, transactional).
- `src/server/actions/approvals.ts` — `submitApproval` retrospective path.
- `src/lib/dashboard-metrics.ts` — overdue-retro metric (pure, unit-tested).
- `prisma/schema.prisma` + migration — additive.
- Change-detail page/client — PIR form, implementer line, retro badge/action.

## Out of scope (deferred to v2.0)

Structured risk/impact assessment and CMDB/configuration-item linkage (items 7–8 of the implementation plan).
