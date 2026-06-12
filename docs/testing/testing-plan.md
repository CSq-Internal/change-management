# How I'm approaching this

Your goal has two parts that pull in slightly different directions, and a good plan has to serve both:

1. **A secure and robust application** — the engineering goal. This is about defect prevention and confidence in behaviour.
2. **ISO 27001 certification (specifically A.12.1.2 / the change-management control set, plus A.14 secure development controls)** — the *evidence* goal. ISO auditors don't just want a working app; they want to see that you have a *defined, repeatable, documented process* for verifying security, and that you can produce records proving it ran. A passing test is engineering; a recorded, traceable, reviewable test result is compliance.

That second point is the one most testing plans miss. For your purposes, the testing plan is itself an ISO artifact. So I've designed it so that every layer produces evidence, and security testing is embedded in the SDLC rather than bolted on at the end (this directly maps to ISO 27001:2022 Annex A 8.25–8.29, the secure-development control family, which is what an auditor will actually ask you about when you say "security is in our dev cycle").

The second thing worth flagging up front: **this PRD has a specific, unusually testable security model**, and that should drive your priorities. The three highest-risk areas, where a single defect is both a security incident *and* a certification failure, are:

- **OpCo data isolation** (Section 4) — "zero cross-OpCo data leakage," enforced only in the Prisma query layer. This is the single most dangerous class of bug in the system. There's no database-level row security mentioned, no Keycloak UMA — isolation lives entirely in application code, which means a forgotten `WHERE opcoId IN (...)` clause is a tenant breach. This deserves the most aggressive testing of anything.
- **Audit log immutability** (Section 10, 11) — "append-only *by API convention*." The phrase "by convention" is a red flag for an auditor. Nothing in the schema or DB enforces it; it's a discipline. Your tests have to prove the convention holds and that violations are detected.
- **RBAC + Segregation of Duties** (Section 5, 7) — enforced "at the API layer; UI is secondary." The self-approval prohibition (A.12.1.2 SoD) and the CAB quorum are the kind of control logic auditors love to probe.

I'm going to weight the plan toward these. Now the plan itself.

---

## CSquared CMS — Testing & Verification Plan

### 1. Testing pyramid and ownership

A layered model, fastest/cheapest at the base. Each layer states what it covers, where it runs, and what evidence it leaves.

| Layer | Scope | Tooling (TS-native) | Gate |
|---|---|---|---|
| **Static analysis** | Types, lint, secret scanning, dependency CVEs | `tsc --noEmit`, ESLint (+ `eslint-plugin-security`), `gitleaks`, `npm audit` / Dependabot / Snyk | Every push; blocks merge |
| **Unit** | Pure logic: SLA calc, quorum counting, risk routing, blackout date math, delegation validity windows | Vitest / Jest | Every push |
| **Integration** | API route handlers + middleware + Prisma against a real Postgres (Testcontainers) | Vitest + Testcontainers + Supertest | Every push |
| **Contract / Authz** | RBAC matrix, OpCo isolation, SoD — the security-critical suite (see §3) | Vitest, table-driven | Every push; **hard gate** |
| **E2E** | Full workflows through the UI incl. SSO, switcher, approvals | Playwright | Pre-merge to main + nightly |
| **Non-functional** | Performance, a11y, DAST | k6, axe-core/Lighthouse CI, OWASP ZAP | Nightly + pre-release |
| **Manual / exploratory** | Pen test, audit-evidence walkthrough | Human + checklist | Per release / quarterly |

A practical note on the database layers: **do not mock Prisma for the isolation and RBAC tests.** Mocking the ORM is exactly how cross-tenant bugs slip through — the mock returns what you told it to, so the missing `WHERE` clause never surfaces. Run those suites against a real Postgres in a container with seeded multi-OpCo data. This is the most important single decision in the plan.

### 2. Requirements traceability matrix (the ISO backbone)

Before writing tests, build a traceability matrix — a living document (a sheet or a checked-in `traceability.md`) mapping every PRD requirement and every Annex A control to the test(s) that verify it. This is the artifact your ISO auditor will ask for first. It answers: *"Show me that this control is tested."*

Minimum columns: `Req ID | PRD section | ISO control | Test ID(s) | Test type | Last run | Result | Evidence link`.

Seed it with the non-negotiables:

| Req | PRD | ISO control | Priority |
|---|---|---|---|
| Zero cross-OpCo leakage | §4, §11 | A.8.3 (info access restriction) | **Critical** |
| Audit log append-only | §10, §11 | A.8.15 (logging), A.5.28 (evidence) | **Critical** |
| No self-approval (SoD) | §5, §7 | A.5.3 (segregation of duties) | **Critical** |
| RBAC enforced at API | §5 | A.8.2/A.8.3 | **Critical** |
| CAB quorum ≥2 for high-risk | §7 | A.8.32 (change mgmt) | High |
| Blackout hard-block + emergency override | §7 | A.8.32 | High |
| @csquared.com SSO only | §8 | A.8.5 (secure auth) | High |
| Session expiry / revocation on offboard | §6, §11 | A.8.5, A.5.18 (access rights) | High |
| Secrets not in source | §11 | A.8.24 / A.5.10 | High |
| Signed-URL-only attachment access | §10 | A.8.3 | Medium |

### 3. The security-critical test suite (where most effort goes)

These are the suites I'd write *first* and gate the hardest. I'll give concrete cases rather than vague intent, because the value is in the adversarial cases.

**OpCo data isolation.** For every resource type (change requests, audit logs, attachments, users, teams, blackouts, KPIs), and for every read *and* every mutation endpoint:

- A user scoped to Ghana requesting a Uganda resource by ID gets `404`/`403` — *never* the resource, and never a `403` that confirms existence when a `404` is more appropriate (resource enumeration leak).
- A user scoped to Ghana querying a list endpoint never receives a single Uganda-tagged row, even with crafted query params, pagination, or filter injection.
- The multi-OpCo user (Alice: approver-Ghana, auditor-Uganda) sees exactly her two OpCos and nothing more — this is the case that catches over-broad claim parsing.
- A direct-object-reference attempt: take a valid Uganda change ID and POST an approval to it as a Ghana approver → rejected.
- After an OpCo transfer (Section 6: `endedAt` set, `isActive=false`), the old assignment grants no new access but historical records remain attributable.

Build this **table-driven**: enumerate `(role × opco × resource × action)` and assert the expected allow/deny against the RBAC matrix in Section 5. The matrix in the PRD is literally your test oracle — encode it as data and loop. This single technique gives you near-complete RBAC coverage and a self-documenting test that an auditor can read alongside the matrix.

**Segregation of duties (self-approval).** Requester submits → same user attempts approve via API directly (not UI) → `403`. Test the delegation edge case too: if A delegates to B, and B submitted the change, can B approve it under the delegation? Per A.12.1.2 intent, no — verify the SoD check compares against `requesterId` regardless of delegation path.

**Audit immutability.** Because it's "append-only by convention," test the convention *and* add a defence-in-depth recommendation:

- After each state transition, assert exactly one new `AuditLog` row with correct `actorId`, `from/toStatus`, timestamp, and `metadata` (IP, UA).
- Attempt every mutation/delete path against audit rows through the API → all must fail or not exist.
- **Recommendation to feed back to the team:** "by convention" won't satisfy a strict auditor. Add a DB-level guard — a Postgres rule/trigger that raises on `UPDATE`/`DELETE` of `AuditLog`, plus the alerting the PRD already mentions. Then write a test that the trigger fires. This converts a soft control into evidenced technical enforcement (much stronger A.8.15 evidence).

**CAB quorum & approval state machine.** High-risk change cannot reach `approved` with 1 CAB approval; can with 2; non-CAB approvals don't count toward quorum; emergency path needs exactly CAB-Chair-or-Group-Admin and bypasses quorum. Model the full lifecycle (`draft→pending→approved/rejected→implemented→verified→closed`) as a state-machine test and assert every *illegal* transition is rejected (e.g., `draft→approved` directly, `closed→pending`).

**Blackout enforcement.** Standard change during active blackout → blocked with the end-date in the error. Emergency flag during blackout → allowed, routes to CAB Chair, alert fired. Boundary cases on the window edges (starts-at, ends-at inclusivity). Group-wide vs per-OpCo blackout scoping.

**Auth & session.** Non-`@csquared.com` token rejected; expired/8h-idle session rejected; offboarded user's existing session is actually dead on next request (Section 6 claims immediate revocation — verify it, don't trust it); JWT with tampered `organizations` claim rejected (signature verification); JWT with valid signature but role escalation in claims is still bounded by server-side checks.

### 4. Security testing embedded in the SDLC (the part you specifically asked for)

This is what makes the "security in the dev cycle" claim real and auditable under A.8.25–8.29. Each item is a *recurring, evidence-producing* activity, not a one-off:

- **Pre-commit:** secret scanning (`gitleaks`) and lint hooks, so secrets never enter history (A.8.24).
- **On every PR (CI gates that block merge):** static analysis, the full security-critical suite from §3, dependency vulnerability scan (fail on high/critical CVEs). A PR cannot merge red. The CI run *is* the evidence record — retain logs.
- **PR review checklist:** a required reviewer checklist item — "Does any new Prisma query include the OpCo filter? Does any new route assert role?" Threat-modelling-lite at review time catches the isolation bug before it's written. Keep the checklist as a template in the repo.
- **Nightly:** DAST (OWASP ZAP baseline scan against a deployed preview), full E2E, performance smoke.
- **Per release:** dependency SBOM generation, a manual exploratory/abuse-case session, and a sign-off against the traceability matrix (someone confirms all Critical/High rows are green). This sign-off is a dated, named record — gold for auditors.
- **Quarterly / pre-certification:** third-party or internal penetration test focused on the multi-tenancy boundary and authz. Track findings to closure in a register (A.8.8 vulnerability management).
- **Per change to the app itself:** note the lovely recursion — your CMS manages change control, so its *own* development should follow a documented change process. Using the tool's own discipline (or a documented Git/PR process) on itself is a strong story to tell the auditor.

### 5. Non-functional verification against the PRD targets

Section 11 gives you exact numbers — turn each into a pass/fail assertion:

- Approve/reject mutation `< 500ms` server response (k6 load test at expected concurrency).
- Page load `< 2s`; audit CSV export of 10,000 records `< 10s` (this one's notable — the PRD says CSV is generated *client-side*; test it with a realistic 10k dataset on a mid-range machine, because client-side generation of 10k rows can blow the budget and freeze the tab. Flag if it does).
- WCAG 2.1 AA via axe-core in CI plus a manual screen-reader pass on the core flows.
- French localization (DRC, Togo) — verify no untranslated keys and no layout breakage on the approval/rejection flows specifically, since those carry legal/audit weight.
- Backup/restore drill: actually exercise RTO 4h / RPO 24h once before certification — a restore you've never tested is not evidence.

### 6. Test data & environments

- A seed script producing a deterministic multi-OpCo fixture: all 6 OpCos, users in every role including the multi-OpCo and group-scoped cases, changes in every status and risk tier, active and expired blackouts, active and revoked delegations. This fixture is the backbone of the isolation and RBAC suites.
- **No production data in test environments**, and no real PII in fixtures (itself an ISO expectation, A.8.10/A.8.11). Synthetic data only.
- Ephemeral Postgres per CI run via Testcontainers; a stable staging environment mirroring prod config for DAST/E2E.

---

### 7. Additions and amendments (2026-05-31)

The following items were identified during implementation planning review. They are listed here as formal amendments to the plan above.

#### 7.1 Test ID naming convention

All test IDs must follow the format `TC-{LAYER}-{AREA}-{NNN}` where:
- `LAYER` = `UNIT` | `INT` (integration) | `CONTRACT` | `E2E` | `NFT` (non-functional)
- `AREA` = `ISOL` (OpCo isolation) | `RBAC` | `SOD` (segregation of duties) | `AUDIT` | `CAB` | `BLK` (blackout) | `AUTH` | `PERF` | `A11Y`
- `NNN` = zero-padded sequence within that combination

Examples: `TC-CONTRACT-ISOL-001`, `TC-INT-RBAC-003`, `TC-UNIT-CAB-002`.

Update the traceability matrix (`docs/testing/csquared-cms-traceability-matrix.xlsx`) to use these IDs as the primary key. The matrix must be updated on every PR that touches a mapped requirement.

#### 7.2 Self-approval (SoD) — primary test case

Add to §3 under Segregation of Duties:

The primary case (not just the delegation edge case): requester submits a change → same `keycloakId` calls the approval endpoint directly (not via UI) → must receive `403`. This must be tested at the API layer, not the UI layer, because UI gating is not a control.

Implementation note: `submitApproval` in `src/server/actions/approvals.ts` must include:
```typescript
if (change.requesterId === user.id) throw new Error("Approvers cannot approve their own requests (SoD violation)")
```
This check is required in Phase 3 Task 3.3 and is a **hard gate** — no approval action may ship without it.

#### 7.3 AuditLog Postgres trigger (mandatory, not optional)

The "append-only by convention" formulation in §3 is a soft control. Per the recommendation already in §3, a Postgres-level guard must be added in the Phase 2 migration:

```sql
CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog rows are immutable (ISO 27001 A.8.15)';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_immutable
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();
```

Write a test that attempts a direct DB `UPDATE` on an `AuditLog` row and asserts the trigger fires. This converts the control from "soft (A.8.15 partial)" to "evidenced technical enforcement (A.8.15 full)."

#### 7.4 Testcontainers integration test setup

The OpCo isolation tests in §3 must run against a real Postgres, not a mocked Prisma client. A new implementation task is required before Phase 3 tests are written:

- Install `@testcontainers/postgresql` and `testcontainers`
- Create `src/test/db.ts` — a shared test helper that starts a Postgres container, runs `prisma migrate deploy`, seeds the security fixture (§7.6), and tears down after the suite
- Write one baseline isolation test (`TC-INT-ISOL-001`): Ghana-scoped user queries `GET /changes` → zero Uganda rows returned, even with crafted `?opcoId=uganda` query param

This setup task is a prerequisite for Phase 3 Tasks 3.2 and 3.3.

#### 7.5 CI/CD pipeline specification

The gates described in §4 cannot block merges until the pipeline is wired. The `.github/workflows/ci-cd.yml` file in the repository is currently empty. A pipeline task is required in Phase 5 that implements:

```
on: [pull_request, push to main/dev]
jobs:
  quality:
    - pnpm tsc --noEmit
    - pnpm lint
    - gitleaks detect
  test:
    - pnpm test (unit + integration via Testcontainers)
    - pnpm test:coverage (fail if security-critical paths < 100% branch)
  e2e:
    - Playwright (pre-merge to prod only)
  security:
    - pnpm audit --audit-level=high
    - OWASP ZAP baseline (nightly only)
```

All `quality` and `test` jobs must pass before merge. `e2e` and `security` run on a schedule or pre-release.

#### 7.6 Comprehensive security test seed fixture

The Phase 2 seed in the implementation plan (6 OpCos + 1 user + 1 change request) is insufficient for the security-critical test suite. The seed must be expanded to include:

**Users (minimum):**
- One user per role per OpCo (6 OpCos × 4 opco-level roles = 24 users)
- One multi-OpCo user: `approver` in Ghana, `auditor` in Uganda (tests over-broad claim parsing)
- One `group_admin` user (cross-OpCo)
- One `group_auditor` user (cross-OpCo)
- One deactivated user (tests session revocation)

**Changes:**
- One change in every status (`draft`, `pending`, `approved`, `rejected`, `implemented`, `verified`, `closed`) per OpCo
- One `high` risk change with 1 CAB approval (quorum not met) and one with 2 (quorum met)
- One emergency change submitted during an active blackout

**Blackouts:**
- One active group-wide blackout
- One active Ghana-only blackout
- One expired blackout (tests boundary conditions)

**Delegations:**
- One active valid delegation
- One expired delegation (tests that expired grants no access)

This fixture is the shared oracle for all isolation and RBAC tests. It must be deterministic (fixed IDs for the entities tests reference by ID).

#### 7.7 Test result retention policy

For ISO evidence purposes:
- CI test run artifacts (JUnit XML + HTML reports) retained for **minimum 12 months**
- A committed `test-results/latest/` directory updated on each release with the final run report (human-readable HTML)
- The traceability matrix `Result` and `Last run` columns updated before each certification review
- The per-release manual sign-off (§4) recorded as a dated commit message or tagged release note, naming the reviewer

#### 7.8 Coverage thresholds for security-critical paths

Minimum coverage requirements (enforced in CI via `--coverage` flag):
- `src/lib/permissions.ts` — **100% branch coverage** (every permission decision must be tested)
- `src/server/actions/approvals.ts` — **100% branch coverage** (CAB quorum + SoD)
- `src/middleware.ts` — **100% branch coverage** (auth guard paths)
- `src/server/actions/changes.ts` — **100% branch coverage** (blackout + state machine)
- Overall project minimum — **80% line coverage**

#### 7.9 French locale test cases (DRC and Togo)

Add to §5 under WCAG/localization:

- Submit a change as a DRC (`locale: fr`) user; verify the approval request email arrives in French with no untranslated `[key]` placeholder strings
- Approve/reject as a Togo approver; verify the status-change email is in French
- Render the audit export for DRC/Togo; verify no English-only strings appear in localizable fields
- Visual regression: run the change request form in French and assert no layout overflow on label fields (French strings are typically 20–30% longer than English)

#### 7.10 Traceability matrix reference

The traceability matrix file is at `docs/testing/csquared-cms-traceability-matrix.xlsx`. It must be treated as a living document:
- Add a row for every new requirement or ISO control identified
- Update `Test ID(s)` as tests are written
- Update `Last run` and `Result` after every CI run targeting a mapped test
- Assign a named owner to the matrix who signs off before certification review
