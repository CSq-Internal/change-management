# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev          # start dev server
pnpm build        # prisma generate + next build
pnpm lint         # eslint
pnpm test         # vitest run (one-shot)
pnpm test:watch   # vitest watch mode
```

Type-check without building:

```bash
pnpm tsc --noEmit
```

Tests run on Vitest (jsdom + React Testing Library; config in `vitest.config.ts`, setup in
`src/test/setup.ts`). Coverage spans auth/enrichment (`src/test/auth*.test.ts`), permissions
(`src/test/lib/permissions.test.ts`), the server actions (`src/test/actions/*` — ~20 suites:
changes, approvals, CAB routing, approval-matrix, assignees, blackout/authz, delegations,
notifications + prefs, chat webhooks, opcos, teams, users-authz, risk register, reschedule,
and audit immutability), and the dashboard (`src/lib/dashboard-metrics.test.ts` pure logic +
`src/app/dashboard-client.test.tsx` render smoke test). `src/test/integration/isolation.test.ts` spins up a real Postgres via
Testcontainers and therefore needs Docker running — it fails (rather than skips) without it.

Use `pnpm` — `package-lock.json` has been deleted and the project uses `pnpm-lock.yaml`.

## Architecture

**State layer (`src/lib/store.ts`)** — A small Zustand store holds **UI-only** preferences (language, font scale, theme), persisted to `localStorage`. Toasts use a separate `useToastStore` in `src/components/ui/toaster.tsx`. All domain data (users, teams, change requests, CAB, approvals, attachments, notifications, etc.) is persisted in Postgres via Prisma, fetched in server components, and passed to client components as props — there is no domain state in Zustand.

**Auth** is server-side via NextAuth v5 (Auth.js) with a Keycloak OIDC provider. `src/auth.config.ts` is the edge-safe config (providers + token extraction only; it is imported by middleware and must NOT import the DB/pg layer). `src/auth.ts` composes that with DB-backed callbacks from `src/lib/auth-callbacks.ts` (`enrichedJwt` / `sessionFromToken`) which attach the user's OpCo assignments and realm roles to the session. The NextAuth route handler is `src/app/api/auth/[...nextauth]/route.ts`. The root `layout.tsx` provides `SessionProvider`; client code reads the user via `useSession()`, server code via `auth()`. The seeded admin account is `devops@csquared.com` / `Admin2025$`.

**Routing** uses Next.js App Router. All feature pages sit inside the `(dashboard)` route group, which applies no extra layout — the group exists purely to separate the login page from authenticated pages. The root `layout.tsx` wraps everything in `AppShell`.

**AppShell (`src/components/app-shell.tsx`)** owns the sidebar, top header, breadcrumbs, mobile nav drawer, password-change modal, and preferences modal. It reads the user from the NextAuth session and `language`/`theme`/`fontScale` from the Zustand UI store; badge counts (pending approvals, my requests, unread notifications) come from the `getNavCounts()` server action. The sidebar nav is filtered by `canManageUsers` (admin permission) so the User Management group is hidden from non-admins.

**i18n (`src/lib/i18n.ts`)** — A flat key→string map for English and French. All user-visible strings go through `t(language, key)`. Language and font scale are persisted to `localStorage`.

**Database layer (`src/server/db.ts` + `prisma/schema.prisma`)** — Prisma v7 with the `@prisma/adapter-pg` driver adapter. A singleton `getPrisma()` function initialises the client from `PRISMA_ACCELERATE_URL` (preferred) or `DATABASE_URL`. The primary data path is the server actions in `src/server/actions/*` (backed by services in `src/server/*`: `drive`, `email`, `notify`, `sla`, `pdf`, `approval-authority`, etc.). The app needs a running database to function; local development uses a Postgres + Keycloak docker-compose stack (migrate + seed, then `pnpm dev`). Without a database URL, DB-backed routes/actions return errors (e.g. `GET /api/changes` responds 500). Run `pnpm prisma migrate dev` against a database URL.

**Domain types (`src/lib/types.ts`)** — `AppUser`, `ChangeRequest`, and `Team` are the core TypeScript interfaces, but `prisma/schema.prisma` is the source of truth and additionally models CAB membership, approver delegations/overrides, change assignees, approvals, attachments, notifications + preferences, PIR records, blackout periods, and the systemic risk register. `ChangeRequest.details` holds telecom-specific fields (country, infrastructure type, impact scope, etc.) from the CSquared paper change-request form.

**Stub pages** — The earlier placeholder/duplicate pages have been triaged and removed (`/automation`, `/settings/alerts`, `/audit-exports`, `/change-details`, `/settings/approvers`, `/settings/preferences`). See `docs/superpowers/specs/2026-06-08-v2-mockup-pages-triage.md` for the verdicts. The live Settings sub-pages are `profile` (read-only account card), `notifications` (preference matrix), `security` (Keycloak Account-Console deep-link), and `integrations` (Google Chat webhooks) — all functional, no stubs remain.

## Key conventions

- Path alias `@/*` maps to `src/*`.
- shadcn/ui components are in `src/components/ui/`. Add new primitives with `pnpm dlx shadcn@latest add <component>`.
- The `pnpm-workspace.yaml` is present but defines no workspaces — the project is a single package.
- `next.config.ts` whitelists two localtunnel dev origins (`allowedDevOrigins`); update or remove these as needed.

## Coding Agent behavorial guidlines

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to over complication, and clarifying questions come before implementation rather than after mistakes.
