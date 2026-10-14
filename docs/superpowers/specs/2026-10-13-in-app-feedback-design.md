# In-app feedback (port of the csq-dmp feedback ledger)

Date: 2026-10-13. Replaces the third-party Feedbucket widget for the group rollout (OpCos trained
14-16 Oct 2026). Source of the pattern: `~/csq-dmp` — `src/modules/feedback/*`,
`src/app/api/v1/feedback/**`, `src/app/(sysadmin)/feedback/page.tsx`,
`prisma/migrations/20260803124441_feedback` + `20260830073459_feedback_outcome`,
`docs/agents/feedback-ledger.md`.

## Why

Feedbucket stores reports outside our systems with no link to who/where, and nothing records what
happened to a report. The DMP lesson: an untriaged ledger only ever overstates what is open, and a
bare "triaged" flag cannot tell "fixed in #155" from "won't fix". Every report gets an OUTCOME.

## Data model — `Feedback` (table `feedback`)

| Field | Type | Notes |
|---|---|---|
| id | String cuid | CMS convention |
| userId | String → User (onDelete Restrict) | author |
| category | enum FeedbackCategory: bug, confusing, missing, praise | reporter-chosen, so unreliable — the triager reads the body |
| severity | enum FeedbackSeverity? : blocker, major, minor | only meaningful for bug; the action forces null for other categories |
| body | Text | trimmed, 1–4000 chars |
| **Context snapshot — copied at submit, never joined** | | what the writer could SEE then, not what their account looks like now |
| route | VarChar(200) | pathname |
| roles | VarChar(300) | e.g. `group_admin` or `ghana:approver, uganda:requester`; from the session, never the payload |
| opcoSlugs | VarChar(200) | comma list of the session's OpCo slugs |
| locale | VarChar(5) | `en`/`fr`, from the UI language store (validated) |
| changeId | String? | the change on screen when on `/changes/[id]`; deliberately NOT an FK |
| appVersion | VarChar(40) | `process.env.K_REVISION ?? "local"` (Cloud Run revision) |
| viewport | VarChar(20) | `1280x800` |
| userAgent | VarChar(300) | from the request header, sliced |
| **Triage** | | |
| triagedAt | DateTime? | |
| outcome | VarChar(20)? | NOT an enum (new values need no ALTER TYPE) |
| triageNote | Text? | |
| triagedById | String? | no FK |
| createdAt | DateTime default now | |

CHECK constraint (hand-added to the migration): `feedback_triage_needs_outcome`:
`"triagedAt" IS NULL OR "outcome" IS NOT NULL`. Indexes: (category, createdAt), (triagedAt, createdAt).

Outcome vocabulary (`src/lib/feedback-outcome.ts`): `fixed`, `wont_fix`, `deferred`, `duplicate`,
`by_design`. A note is REQUIRED for `wont_fix`, `deferred`, `by_design`; optional for `fixed`
(should name the release/PR) and `duplicate`. Whitespace-only notes are rejected; notes are trimmed;
empty → null. (No `unknown`: there is no legacy data to describe.)

## Submission

- `FeedbackWidget` in the AppShell header for every signed-in user: ghost icon button (flag icon,
  label hidden on phones), opens a modal built like the existing AppShell modals.
- Fields: category select (no default — placeholder), severity select only when category = bug
  (default major), body textarea (4 rows), a hint that the screen and role are recorded.
- Submit disabled until category chosen and trimmed body non-empty. States: idle → pending →
  sent (form replaced by a thank-you) | failed (error text, form kept). Closing resets.
- Server action `submitFeedback({category, severity, body, route, changeId, viewport, locale})`:
  zod-validated; roles/opcoSlugs/userId from the session, userAgent from `headers()`, appVersion
  from env. Returns `{ id }`. No audit row (feedback is not a change-control act). No rate limit.
- If `FEEDBACK_INBOX` is set, email that one address after insert (`[CMS feedback] {category} —
  {route}`, escaped name/roles/OpCos/screen/body) via the existing email transport; failures are
  logged and swallowed — the row always stays.

## Triage

- Page `/feedback` (dashboard group), server component, **group_admin only** (others redirected
  to `/`), checks the role itself before querying. Nav item visible to group admins only.
- Table newest first: When, Category, Severity (— if none), Comment, Screen, Change (— / link),
  From, Roles, OpCos, Outcome. Client-side filters: category, OpCo, and "untriaged only" (default on).
- Untriaged row: outcome select + note input (shown when the outcome needs one) + "Mark triaged"
  (disabled until an outcome is chosen); server error shown inline; row updates on success.
  Triaged row: outcome label + note.
- Server action `triageFeedback(id, outcome, note)`: group_admin only, validates via the outcome
  module, sets triagedAt/outcome/triageNote/triagedById; refuses re-triage of an already-triaged row
  and a missing id with clear errors.

## i18n

All strings via `t(language, key)` with EN + FR (`feedback.*`, plus `nav.feedback`).

## Out of scope

Screenshots/attachments, CSV export, pagination, re-triage/editing outcomes, Chat notifications.

## Remove

The Feedbucket `<script>` in `src/app/layout.tsx`.
