# Change Lifecycle Repair + Change Detail Hub — Design

**Date:** 2026-06-01
**Status:** Approved (design); pending implementation plan
**Area:** Core operational pages and flows (CSquared CMS)

## Problem

The change-management lifecycle is `draft → pending → approved → implemented → verified → closed` (with `pending → rejected`, and `rejected → draft`). The server actions enforce every transition, but the UI severs the lifecycle at the first joint:

- `createChange` always saves a change as **`draft`**, and **no UI control moves it `draft → pending`**. The Approvals queue only has data because the seed inserted a `pending` change directly. A self-created change cannot be driven through approval in the live app.
- The Requests form has dead/disconnected fields: the `country` radio is ignored (the change uses the session's first OpCo), the `approvers` free-text field is collected and discarded, there is no `emergency` option (though the schema and blackout-override logic support it), and the "My Requests" sidebar is hardcoded to "none".
- There is no per-change detail view; list cards show only title + status, so full details, approvals, and a change's own audit history are not viewable.

## Goal

Restore the end-to-end lifecycle in the UI and introduce a **change detail page** that serves as the hub where full information, approvals, the audit timeline, and the contextual lifecycle actions live.

No database schema changes. Transitions remain enforced server-side.

## Decisions

- **Submit model — Hybrid.** The Requests form has **Save draft** and **Submit for approval**. Drafts can also be submitted later from the detail page.
- **OpCo selection — in-form selector.** A real dropdown constrained to the user's OpCo memberships; group-level users (`group_admin` / `group_auditor`) see all 6. Default = the active OpCo from the header switcher.
- **Detail page layout — two-column with a sticky right action rail.**
- **Remove the `approvers` field.** Approval routing is automatic and role-based (`createChange` already emails OpCo approvers). (Considered: keep it as an optional "suggested approvers" note — rejected as YAGNI.)
- **Edit draft — included.** A draft-only `updateChange` plus an edit mode on the form. (Flagged during design as optional/stretch; retained.)

## Components

### 1. Requests form — `src/app/(dashboard)/requests/page.tsx`
- Replace the ignored `country` radio with an **OpCo selector**: options = user's memberships; group-level sees all 6 (`OPCO_SLUGS`). Default = active OpCo from the switcher/session.
- **Remove** the `approvers` field and its state.
- Add **Emergency** as a fourth option in the risk-level group (alongside low/medium/high). Selecting it sets `riskLevel = "emergency"` and `isEmergency = true`. Effects: bypasses blackout windows, 1h SLA, requires CAB quorum at approval. Show an inline warning describing these effects.
- Two actions:
  - **Save draft** → `createChange(...)` (status `draft`).
  - **Submit for approval** → `createChange(...)` then `updateChangeStatus(id, "pending")`. Produces `created` and `submitted` audit entries. On success, route to the change's detail page.
- Wire the **"My Requests"** sidebar to the requester's recent changes (title, status, updatedAt), each linking to `/changes/[id]`.

### 2. Change detail page — new route `src/app/(dashboard)/changes/[id]/page.tsx` (+ client)
- **Server:** new `getChange(id)` action — OpCo authorization (group-level OR member of the change's OpCo, else throw/404). Returns the full change + `requester` + `opco` + `approvals` (with approver name/email) + `auditTrail` (with actor), serialized for the client.
- **Left column:** all change fields — description, category, risk level, infrastructure type, impact scope, implementation/testing/backout plans, change window, planned start/end, SLA deadline, requester, contact email, created/updated. Below: the **Timeline** rendered from the change's `AuditLog` entries (action, from→to status, actor, timestamp, note).
- **Sticky right rail:** status badge · CAB quorum progress (shown for `high`/`emergency`) · approvals summary (each decision + comment) · the valid actions for the current status and the viewer's role.
- **Contextual actions** (render only when valid; server re-checks):
  - `draft` + requester/admin → **Submit for approval**, **Edit draft**
  - `pending` + approver (and not the requester — SoD) → **Approve** / **Reject** (comment required to reject)
  - `approved` + authorized → **Mark implemented**
  - `implemented` → **Mark verified**
  - `verified` → **Close**
  - `rejected` + requester/admin → **Return to draft**

### 3. Edit draft
- Reuse the Requests form in an **edit mode**, prefilled, available only for `draft` changes.
- New `updateChange(id, input)` server action: authorization = requester or admin; **guard that status is `draft`** (reject otherwise).

### 4. List page integration
- **Changes** list (`changes/changes-client.tsx`): cards link to `/changes/[id]`; the implement/verify/close buttons **move to** the detail rail (single home for those actions).
- **Approvals** queue (`approvals/approvals-client.tsx`): **keep inline Approve/Reject** for fast triage; link the title to `/changes/[id]`. This is the one deliberate exception to "actions live on detail" — triaging a queue should not require opening each item.

### 5. Server actions — `src/server/actions/changes.ts`
- **Reused as-is:** `updateChangeStatus` (already supports `draft → pending` and the rest), `submitApproval`.
- **New:** `getChange(id)` (single read + OpCo authz, includes requester/opco/approvals/auditTrail); `updateChange(id, input)` (edit, draft-only guard, requester/admin authz).
- `createChange`: already accepts `isEmergency` and `riskLevel` — the form simply passes `emergency` through. SLA map already covers `emergency`.

## Data flow

1. Requester fills the form → picks OpCo → **Save draft** or **Submit**.
2. Save draft → `createChange` (draft). Submit → `createChange` (draft) + `updateChangeStatus(pending)`; approvers in that OpCo are emailed.
3. Approver opens Approvals queue (inline) or the detail page → Approve/Reject. CAB quorum (2 distinct CAB approvers) required for `high`/`emergency`; SoD blocks self-approval.
4. On approval → status `approved`; requester emailed. Implementer drives `implemented → verified → closed` from the detail rail.
5. Every transition writes an immutable `AuditLog` entry, surfaced in the detail Timeline and the Audits page.

## Error handling
- Authorization failures (wrong OpCo, not an approver, SoD, non-draft edit) throw on the server and surface as toast errors in the client; the detail page returns not-found for unauthorized/missing changes.
- Invalid transitions are rejected by the existing `VALID_TRANSITIONS` guard.
- Emergency override is explicit (the only way past an active blackout).

## Testing
- Submit flow: a created draft, once submitted, appears in the Approvals queue (`draft → pending`).
- `getChange` enforces OpCo isolation (a Ghana viewer cannot load a Uganda change).
- `updateChange` rejects edits when status ≠ `draft`.
- Emergency submission sets `isEmergency` and overrides an active blackout; non-emergency is blocked.
- Action gating: each contextual action renders only for the correct status + role, and the server re-rejects spoofed calls.

## Out of scope (backlog)
The 7 still-static pages (audit-exports, calendar, risk-register, approval-matrix, notifications/history, settings/profile, settings/approvers), users/teams admin (deactivate/edit, team create/edit, multi-OpCo assignment), reports visualization polish, attachment uploads, approver delegation.
