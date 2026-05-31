# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev          # start dev server
pnpm build        # prisma generate + next build
pnpm lint         # eslint
```

Type-check without building:

```bash
pnpm tsc --noEmit
```

There are no tests yet. The README roadmap lists them as a future item.

Use `pnpm` — `package-lock.json` has been deleted and the project uses `pnpm-lock.yaml`.

## Architecture

**State layer (`src/lib/store.ts`)** — All application state (users, teams, change requests) lives in a single Zustand store. There is no real persistence; everything resets on page refresh. The store is the source of truth for every page.

**Auth** is entirely client-side. On login, the user's ID is written to `localStorage` under the key `csq-session-user`. Two render-only components in `app-shell.tsx` handle hydration (`AuthHydrate`) and redirect-on-unauthenticated (`AuthGuard`). The seeded admin account is `devops@csquared.com` / `Admin2025$`.

**Routing** uses Next.js App Router. All feature pages sit inside the `(dashboard)` route group, which applies no extra layout — the group exists purely to separate the login page from authenticated pages. The root `layout.tsx` wraps everything in `AppShell`.

**AppShell (`src/components/app-shell.tsx`)** owns the sidebar, top header, breadcrumbs, mobile nav drawer, password-change modal, and preferences modal. It reads `currentUser` and `changes` from the store to compute badge counts. The sidebar nav is filtered by `canManageUsers` (admin permission) so the User Management group is hidden from non-admins.

**i18n (`src/lib/i18n.ts`)** — A flat key→string map for English and French. All user-visible strings go through `t(language, key)`. Language and font scale are persisted to `localStorage`.

**Database layer (`src/server/db.ts` + `prisma/schema.prisma`)** — Prisma v7 with the `@prisma/adapter-pg` driver adapter. A singleton `getPrisma()` function initialises the client from `PRISMA_ACCELERATE_URL` (preferred) or `DATABASE_URL`. Neither env var is set in development, so the only wired API route (`GET /api/changes`) returns a 500 with an explanatory message. Run `pnpm prisma migrate dev` once a database URL is available.

**Domain types (`src/lib/types.ts`)** — `AppUser`, `ChangeRequest`, and `Team` are the three core interfaces. `ChangeRequest.details` is a nested object holding telecom-specific fields (country, infrastructure type, impact scope, etc.) that correspond to the CSquared paper change-request form.

**Stub pages** — The following pages render static placeholder data and have no real logic yet: `/risk-register`, `/calendar`, `/audit-exports`, `/approval-matrix`, `/automation`, `/change-details`, `/notifications/history`, and all `/settings/*` sub-pages.

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
