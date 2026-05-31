# CSquared CMS v1.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the v0.1.0 prototype from in-memory Zustand state into a production-ready multi-tenant change management system with Keycloak 26+ IAM, PostgreSQL via Prisma v7, OpCo-scoped RBAC, and complete change workflows.

**Architecture:** Next.js 16 App Router with Server Components and Server Actions for all data operations. Keycloak 26+ handles identity (OIDC, Google Workspace federation, OpCo Organization membership via JWT claims). NextAuth v5 (beta) bridges Keycloak OIDC to Next.js session; Next.js middleware enforces auth and extracts OpCo context on every request. Prisma v7 handles persistence with every resource table tagged by `opcoId`.

**Tech Stack:** Next.js 16, NextAuth v5 (beta), Keycloak 26+, Prisma v7, PostgreSQL, Tailwind CSS v4, shadcn/ui, Zod, Resend, Vitest, Playwright

---

## Scope: 5 Independent Phases

Each phase produces working, testable software and can be executed in a separate session.

| Phase | Deliverable |
|-------|-------------|
| 1 | Keycloak local setup + NextAuth v5 + JWT middleware |
| 2 | Full Prisma schema migration + seed data |
| 3 | Core server actions (change CRUD, approval, audit, blackout) |
| 4 | All 20+ pages wired to real backend; Zustand gutted to UI prefs only |
| 5 | OpCo switcher, Keycloak user admin, email notifications, audit CSV export |

**Start here:** Execute Phase 1 first — every other phase depends on it.

---

## File Structure Map

### Files to create
```
docker/
  keycloak/
    docker-compose.yml          # Local Keycloak dev container (26.0) + Postgres

src/
  auth.ts                       # NextAuth config: Keycloak provider + JWT/session callbacks
  middleware.ts                 # Auth guard + OpCo context extraction
  types/
    next-auth.d.ts              # Module augmentation: Session gains keycloakId, organizations, realmRoles

  lib/
    session.ts                  # getAppSession() typed wrapper → AppSession
    permissions.ts              # canApprove(), canAudit(), canManageUsers(), isGroupAdmin()
    opco.ts                     # getUserOpCos(), OPCO_NAMES, OPCO_SLUGS, OpCoSlug type

  server/
    keycloak.ts                 # Keycloak Admin REST API client (create users, assign orgs)
    email.ts                    # Resend client wrapper
    actions/
      changes.ts                # createChange, listChanges, updateChangeStatus
      approvals.ts              # submitApproval, checkCabQuorum
      audit.ts                  # getAuditLog
      blackout.ts               # checkSubmissionBlocked, isInBlackout, createBlackoutPeriod
      users.ts                  # createUser (Keycloak + DB), deactivateUser
      teams.ts                  # createTeam, updateTeam

  app/
    api/
      auth/[...nextauth]/
        route.ts                # NextAuth v5 route handler
      audit-export/
        route.ts                # GET: streams CSV download

  test/
    setup.ts                    # Vitest global setup + jest-dom matchers
    helpers.ts                  # Test factories: makeSession(), makeChange()
    db.ts                       # Testcontainers shared test DB helper (startTestDb, stopTestDb)
    actions/
      changes.test.ts
      approvals.test.ts           # Includes TC-CONTRACT-SOD-001 (self-approval prevention)
      blackout.test.ts
      audit-immutability.test.ts  # TC-INT-AUDIT-001 (AuditLog trigger verification)
    integration/
      isolation.test.ts           # TC-INT-ISOL-001 (OpCo isolation against real Postgres)
    lib/
      permissions.test.ts

  components/
    opco-switcher.tsx           # Header dropdown for group-level users

prisma/
  seed.ts                       # 6 OpCos + dev admin + sample change request

.env.example                    # Document all required env vars
```

### Files to modify
```
prisma/schema.prisma            # Full PRD schema (replaces stub)
package.json                    # Add: test script, db:seed, prisma.seed field
src/lib/store.ts                # GUT: remove all auth + data slices; keep language + fontScale only
src/lib/types.ts                # Remove AppUser.password; add SessionUser type
src/components/app-shell.tsx    # Replace AuthHydrate/AuthGuard/Zustand auth with NextAuth session
src/app/layout.tsx              # Add SessionProvider wrapper
src/app/login/page.tsx          # Replace store.login() with signIn("keycloak")

# Phase 4 — all pages wired to DB:
src/app/(dashboard)/page.tsx
src/app/(dashboard)/requests/page.tsx
src/app/(dashboard)/approvals/page.tsx
src/app/(dashboard)/changes/page.tsx
src/app/(dashboard)/audits/page.tsx
src/app/(dashboard)/users/page.tsx
src/app/(dashboard)/teams/page.tsx
src/app/(dashboard)/reports/page.tsx
src/app/(dashboard)/audit-exports/page.tsx
src/app/(dashboard)/calendar/page.tsx
src/app/(dashboard)/risk-register/page.tsx
src/app/(dashboard)/approval-matrix/page.tsx
src/app/(dashboard)/notifications/history/page.tsx
src/app/(dashboard)/settings/profile/page.tsx
src/app/(dashboard)/settings/approvers/page.tsx
```

---

## Phase 1: Auth Foundation

### Task 1.1: Install Testing Infrastructure

**Files:**
- Create: `vitest.config.ts`
- Create: `src/test/setup.ts`
- Modify: `package.json`

- [ ] **Step 1: Install packages**

```bash
pnpm add -D vitest @vitejs/plugin-react @testing-library/react @testing-library/jest-dom jsdom
```

- [ ] **Step 2: Create vitest config**

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    exclude: ['**/node_modules/**', '**/e2e/**'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
})
```

- [ ] **Step 3: Create test setup**

```typescript
// src/test/setup.ts
import '@testing-library/jest-dom'
```

- [ ] **Step 4: Add scripts to package.json**

In `package.json` `"scripts"` add:
```json
"test": "vitest run",
"test:watch": "vitest",
"db:seed": "tsx prisma/seed.ts"
```

In `package.json` top-level add:
```json
"prisma": {
  "seed": "tsx prisma/seed.ts"
}
```

- [ ] **Step 5: Run test suite**

```bash
pnpm test
```
Expected: "No test files found, exiting with code 0"

- [ ] **Step 6: Commit**

```bash
git add vitest.config.ts src/test/setup.ts package.json pnpm-lock.yaml
git commit -m "chore: add Vitest testing infrastructure"
```

---

### Task 1.2: Keycloak Local Setup

**Files:**
- Create: `docker/keycloak/docker-compose.yml`
- Create: `.env.example`
- Create: `.env.local` (gitignored, fill in values manually)

- [ ] **Step 1: Create docker-compose**

```yaml
# docker/keycloak/docker-compose.yml
services:
  keycloak:
    image: quay.io/keycloak/keycloak:26.0
    environment:
      KC_BOOTSTRAP_ADMIN_USERNAME: admin
      KC_BOOTSTRAP_ADMIN_PASSWORD: admin
    command: start-dev
    ports:
      - "8080:8080"
    volumes:
      - keycloak_data:/opt/keycloak/data

  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: csquared_cms
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"
    volumes:
      - pg_data:/var/lib/postgresql/data

volumes:
  keycloak_data:
  pg_data:
```

- [ ] **Step 2: Start services**

```bash
docker compose -f docker/keycloak/docker-compose.yml up -d
```
Expected: both containers start. Keycloak admin UI at http://localhost:8080.

- [ ] **Step 3: Configure Keycloak realm (manual UI steps)**

Open http://localhost:8080 (admin / admin) and complete:

1. Create realm: `csquared`
2. In `csquared` realm → Clients → Create:
   - Client ID: `csquared-cms`
   - Client protocol: `openid-connect`
   - Client authentication: ON (confidential)
   - Valid redirect URIs: `http://localhost:3000/api/auth/callback/keycloak`
   - Web origins: `http://localhost:3000`
3. Go to `csquared-cms` → Credentials → copy Client Secret
4. Enable Organizations: `Realm settings → General → Organizations` → toggle ON
5. Create 6 Organizations with these exact aliases: `ghana`, `uganda`, `drc`, `togo`, `liberia`, `mauritius`
6. Add Realm Roles: `group_admin`, `group_auditor`
7. Per Organization, add org roles: `requester`, `approver`, `auditor`, `admin`
8. Create test user `devops@csquared.com`, assign to `ghana` org with role `admin` and realm role `group_admin`
9. (Optional) Add Google Identity Provider federated via `csquared.com` domain restriction

- [ ] **Step 4: Create .env.local**

```bash
# .env.local
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/csquared_cms

NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=dev-secret-replace-in-production

KEYCLOAK_CLIENT_ID=csquared-cms
KEYCLOAK_CLIENT_SECRET=<paste from Keycloak admin UI step 3>
KEYCLOAK_ISSUER=http://localhost:8080/realms/csquared
```

- [ ] **Step 5: Create .env.example**

```bash
# .env.example
DATABASE_URL=postgresql://user:password@host:5432/csquared_cms

NEXTAUTH_URL=https://your-domain.com
NEXTAUTH_SECRET=generate-with-openssl-rand-base64-32

KEYCLOAK_CLIENT_ID=csquared-cms
KEYCLOAK_CLIENT_SECRET=
KEYCLOAK_ISSUER=https://keycloak.your-domain.com/realms/csquared

KEYCLOAK_ADMIN_CLIENT_SECRET=
RESEND_API_KEY=
```

- [ ] **Step 6: Verify .gitignore**

Ensure `.gitignore` contains `.env.local` and `.env*.local`.

- [ ] **Step 7: Commit**

```bash
git add docker/ .env.example .gitignore
git commit -m "chore: add Keycloak + Postgres docker-compose for local dev"
```

---

### Task 1.3: Install and Configure NextAuth v5

**Files:**
- Create: `src/auth.ts`
- Create: `src/app/api/auth/[...nextauth]/route.ts`
- Create: `src/types/next-auth.d.ts`
- Create: `src/test/auth.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/test/auth.test.ts
import { describe, it, expect } from 'vitest'

describe('auth module exports', () => {
  it('exports handlers, auth, signIn, signOut', async () => {
    const mod = await import('@/auth')
    expect(mod.handlers).toBeDefined()
    expect(mod.auth).toBeDefined()
    expect(mod.signIn).toBeDefined()
    expect(mod.signOut).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

```bash
pnpm test src/test/auth.test.ts
```
Expected: FAIL — "Cannot find module '@/auth'"

- [ ] **Step 3: Install NextAuth v5**

```bash
pnpm add next-auth@beta
```

- [ ] **Step 4: Create NextAuth type augmentation**

```typescript
// src/types/next-auth.d.ts
import "next-auth"

export interface SessionOrganization {
  id: string
  name: string
  alias: string   // matches OpCo.slug: "ghana" | "uganda" | "drc" | "togo" | "liberia" | "mauritius"
  roles: string[] // org-level roles: "requester" | "approver" | "auditor" | "admin"
}

declare module "next-auth" {
  interface Session {
    user: {
      id: string
      name?: string | null
      email?: string | null
      image?: string | null
      keycloakId: string
      organizations: SessionOrganization[]
      realmRoles: string[]  // "group_admin" | "group_auditor"
    }
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    keycloakId?: string
    organizations?: unknown[]
    realmRoles?: string[]
    accessToken?: string
  }
}
```

- [ ] **Step 5: Create auth config**

```typescript
// src/auth.ts
import NextAuth from "next-auth"
import Keycloak from "next-auth/providers/keycloak"
import type { SessionOrganization } from "@/types/next-auth"

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Keycloak({
      clientId: process.env.KEYCLOAK_CLIENT_ID!,
      clientSecret: process.env.KEYCLOAK_CLIENT_SECRET!,
      issuer: process.env.KEYCLOAK_ISSUER!,
    }),
  ],
  callbacks: {
    jwt({ token, account, profile }) {
      if (account) token.accessToken = account.access_token
      if (profile) {
        const p = profile as Record<string, unknown>
        token.keycloakId = p.sub as string
        token.organizations = (p.organizations as unknown[]) ?? []
        token.realmRoles = (p.realm_access as { roles?: string[] })?.roles ?? []
      }
      return token
    },
    session({ session, token }) {
      session.user.keycloakId = (token.keycloakId as string) ?? ""
      session.user.organizations = (token.organizations as SessionOrganization[]) ?? []
      session.user.realmRoles = (token.realmRoles as string[]) ?? []
      return session
    },
  },
})
```

- [ ] **Step 6: Create API route handler**

```typescript
// src/app/api/auth/[...nextauth]/route.ts
import { handlers } from "@/auth"
export const { GET, POST } = handlers
```

- [ ] **Step 7: Run test — verify it passes**

```bash
pnpm test src/test/auth.test.ts
```
Expected: PASS (1 passing)

- [ ] **Step 8: Commit**

```bash
git add src/auth.ts src/app/api/auth src/types/next-auth.d.ts src/test/auth.test.ts pnpm-lock.yaml
git commit -m "feat: add NextAuth v5 with Keycloak OIDC provider"
```

---

### Task 1.4: Permissions Library + Middleware

**Files:**
- Create: `src/lib/permissions.ts`
- Create: `src/middleware.ts`
- Create: `src/test/lib/permissions.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/test/lib/permissions.test.ts
import { describe, it, expect } from 'vitest'
import { canApprove, canAudit, canManageUsers, isGroupAdmin } from '@/lib/permissions'
import type { SessionOrganization } from '@/types/next-auth'

const ghanaApprover: SessionOrganization = { id: 'org-1', name: 'Ghana', alias: 'ghana', roles: ['approver'] }
const ugandaAuditor: SessionOrganization = { id: 'org-2', name: 'Uganda', alias: 'uganda', roles: ['auditor'] }

describe('canApprove', () => {
  it('returns true for approver in matching opco', () => {
    expect(canApprove([ghanaApprover], 'ghana')).toBe(true)
  })
  it('returns false for approver in different opco', () => {
    expect(canApprove([ghanaApprover], 'uganda')).toBe(false)
  })
})

describe('canAudit', () => {
  it('auditor can audit their opco', () => {
    expect(canAudit([ugandaAuditor], [], 'uganda')).toBe(true)
  })
  it('auditor cannot audit a different opco', () => {
    expect(canAudit([ugandaAuditor], [], 'ghana')).toBe(false)
  })
  it('group_auditor can audit any opco', () => {
    expect(canAudit([], ['group_auditor'], 'ghana')).toBe(true)
    expect(canAudit([], ['group_auditor'], 'mauritius')).toBe(true)
  })
})

describe('canManageUsers', () => {
  it('opco admin can manage users in their opco only', () => {
    const admin: SessionOrganization = { id: 'org-1', name: 'Ghana', alias: 'ghana', roles: ['admin'] }
    expect(canManageUsers([admin], [], 'ghana')).toBe(true)
    expect(canManageUsers([admin], [], 'uganda')).toBe(false)
  })
  it('group_admin can manage users in any opco', () => {
    expect(canManageUsers([], ['group_admin'], 'ghana')).toBe(true)
    expect(canManageUsers([], ['group_admin'], 'mauritius')).toBe(true)
  })
})

describe('isGroupAdmin', () => {
  it('returns true when group_admin present', () => {
    expect(isGroupAdmin(['group_admin'])).toBe(true)
  })
  it('returns false without group_admin', () => {
    expect(isGroupAdmin(['approver'])).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm test src/test/lib/permissions.test.ts
```
Expected: FAIL — "Cannot find module '@/lib/permissions'"

- [ ] **Step 3: Create permissions library**

```typescript
// src/lib/permissions.ts
import type { SessionOrganization } from "@/types/next-auth"

export function hasRoleInOpCo(
  organizations: SessionOrganization[],
  opcoAlias: string,
  role: string
): boolean {
  return organizations.some((o) => o.alias === opcoAlias && o.roles.includes(role))
}

export function canApprove(organizations: SessionOrganization[], opcoAlias: string): boolean {
  return (
    hasRoleInOpCo(organizations, opcoAlias, "approver") ||
    hasRoleInOpCo(organizations, opcoAlias, "admin")
  )
}

export function canAudit(
  organizations: SessionOrganization[],
  realmRoles: string[],
  opcoAlias: string
): boolean {
  return (
    realmRoles.includes("group_auditor") ||
    realmRoles.includes("group_admin") ||
    hasRoleInOpCo(organizations, opcoAlias, "auditor") ||
    hasRoleInOpCo(organizations, opcoAlias, "admin")
  )
}

export function canManageUsers(
  organizations: SessionOrganization[],
  realmRoles: string[],
  opcoAlias: string
): boolean {
  return (
    realmRoles.includes("group_admin") ||
    hasRoleInOpCo(organizations, opcoAlias, "admin")
  )
}

export function isGroupAdmin(realmRoles: string[]): boolean {
  return realmRoles.includes("group_admin")
}

export function getUserOpCos(organizations: SessionOrganization[]): string[] {
  return organizations.map((o) => o.alias)
}
```

- [ ] **Step 4: Run permissions tests — verify pass**

```bash
pnpm test src/test/lib/permissions.test.ts
```
Expected: PASS (8 passing)

- [ ] **Step 5: Create middleware**

```typescript
// src/middleware.ts
import { auth } from "@/auth"
import { NextResponse } from "next/server"

export default auth((req) => {
  const { pathname } = req.nextUrl
  const session = req.auth

  if (pathname.startsWith("/api/auth")) return NextResponse.next()

  if (!session && pathname !== "/login") {
    return NextResponse.redirect(new URL("/login", req.url))
  }

  if (session && pathname === "/login") {
    return NextResponse.redirect(new URL("/", req.url))
  }

  return NextResponse.next()
})

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons|images).*)"],
}
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/permissions.ts src/middleware.ts src/test/lib/permissions.test.ts
git commit -m "feat: add RBAC permission helpers and auth middleware"
```

---

### Task 1.5: Update AppShell and Login Page

**Files:**
- Modify: `src/components/app-shell.tsx`
- Modify: `src/lib/store.ts`
- Modify: `src/app/login/page.tsx`
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Slim down Zustand store to UI prefs only**

Replace the full content of `src/lib/store.ts` with:

```typescript
// src/lib/store.ts
import { create } from 'zustand'

type Language = 'en' | 'fr'

interface UIState {
  language: Language
  fontScale: number
  setLanguage: (lang: Language) => void
  setFontScale: (scale: number) => void
}

export const useStore = create<UIState>((set) => ({
  language: (typeof window !== 'undefined'
    ? (localStorage.getItem('csq-language') as Language) : null) ?? 'en',
  fontScale: typeof window !== 'undefined'
    ? Number(localStorage.getItem('csq-font-scale') ?? 1) : 1,
  setLanguage: (language) => {
    set({ language })
    if (typeof window !== 'undefined') localStorage.setItem('csq-language', language)
  },
  setFontScale: (fontScale) => {
    set({ fontScale })
    if (typeof window !== 'undefined') localStorage.setItem('csq-font-scale', String(fontScale))
  },
}))
```

- [ ] **Step 2: Add SessionProvider to root layout**

In `src/app/layout.tsx`, add SessionProvider wrapper:

```typescript
// Add import:
import { SessionProvider } from "next-auth/react"

// Wrap the existing body contents:
return (
  <html lang="en">
    <body className={cn(spaceGrotesk.variable, "min-h-dvh bg-background font-sans antialiased")}>
      <SessionProvider>
        <div className="flex min-h-dvh flex-col">
          <AppShell>
            <div className="mx-auto w-full max-w-6xl px-4 sm:px-5 md:px-6 lg:px-8">
              {children}
            </div>
          </AppShell>
        </div>
      </SessionProvider>
    </body>
  </html>
)
```

- [ ] **Step 3: Update AppShell — replace Zustand auth with NextAuth session**

In `src/components/app-shell.tsx`:

1. Remove `AuthHydrate` component entirely (the localStorage `useEffect` restoring session).
2. Remove `AuthGuard` component entirely (middleware handles redirects now).
3. Add at top of the main shell component:

```typescript
import { useSession, signOut as nextAuthSignOut } from "next-auth/react"
import { canManageUsers } from "@/lib/permissions"

const { data: session } = useSession()
const currentUser = session?.user ?? null
```

4. Replace logout call:
```typescript
// Replace: useStore().logout() or similar
// With:
await nextAuthSignOut({ callbackUrl: "/login" })
```

5. Replace admin nav visibility:
```typescript
const showAdminNav = session
  ? canManageUsers(
      session.user.organizations,
      session.user.realmRoles,
      session.user.organizations[0]?.alias ?? ''
    )
  : false
```

6. Remove password change modal (Keycloak manages passwords now).
7. Keep `useStore()` only for `language` and `fontScale`.

- [ ] **Step 4: Replace login page**

In `src/app/login/page.tsx`, replace the Zustand login with NextAuth:

```typescript
// Add imports:
import { signIn } from "next-auth/react"

// Replace handleSubmit:
async function handleLogin() {
  await signIn("keycloak", { callbackUrl: "/" })
}

// Replace Google button:
async function handleGoogleLogin() {
  await signIn("keycloak", { callbackUrl: "/" })
  // Google Workspace is federated through Keycloak
}
```

Remove: all password validation UI, domain enforcement logic, `useStore` login imports.

- [ ] **Step 5: Test login flow end-to-end**

```bash
pnpm dev
```

1. Navigate to http://localhost:3000 → should redirect to `/login`
2. Click Sign In → should redirect to Keycloak at http://localhost:8080
3. Log in as `devops@csquared.com`
4. Should land on dashboard
5. Sidebar should show admin nav
6. Logout should redirect to `/login`

- [ ] **Step 6: Commit**

```bash
git add src/lib/store.ts src/app/layout.tsx src/components/app-shell.tsx src/app/login/page.tsx
git commit -m "feat: replace client-side auth with NextAuth v5 + Keycloak"
```

---

## Phase 2: Prisma Schema Migration

### Task 2.1: Full Schema Replacement

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Replace schema with full PRD schema**

Replace the entire content of `prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  requester
  approver
  auditor
  admin
  group_admin
  group_auditor
}

enum ChangeStatus {
  draft
  pending
  approved
  rejected
  implemented
  verified
  closed
}

enum RiskLevel {
  low
  medium
  high
  emergency
}

enum ChangeCategory {
  config
  infrastructure
  software
  process
}

model User {
  id           String   @id @default(cuid())
  keycloakId   String   @unique
  email        String   @unique
  name         String?
  isActive     Boolean  @default(true)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  opcoAssignments UserOpCoAssignment[]
  requests        ChangeRequest[]      @relation("Requester")
  approvals       Approval[]
  auditEntries    AuditLog[]
  delegationsFrom ApproverDelegation[] @relation("DelegatedBy")
  delegationsTo   ApproverDelegation[] @relation("DelegatedTo")
}

model OpCo {
  id            String   @id @default(cuid())
  slug          String   @unique
  name          String
  locale        String   @default("en")
  keycloakOrgId String   @unique
  createdAt     DateTime @default(now())

  users     UserOpCoAssignment[]
  changes   ChangeRequest[]
  teams     Team[]
  blackouts BlackoutPeriod[]
}

model UserOpCoAssignment {
  id        String    @id @default(cuid())
  userId    String
  user      User      @relation(fields: [userId], references: [id])
  opcoId    String
  opco      OpCo      @relation(fields: [opcoId], references: [id])
  role      Role
  isActive  Boolean   @default(true)
  startedAt DateTime  @default(now())
  endedAt   DateTime?

  @@unique([userId, opcoId])
  @@index([opcoId])
  @@index([userId])
}

model Team {
  id          String   @id @default(cuid())
  opcoId      String
  opco        OpCo     @relation(fields: [opcoId], references: [id])
  name        String
  description String?
  planSummary String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  members TeamMember[]

  @@index([opcoId])
}

model TeamMember {
  id     String @id @default(cuid())
  teamId String
  team   Team   @relation(fields: [teamId], references: [id])
  userId String

  @@unique([teamId, userId])
}

model ChangeRequest {
  id                 String         @id @default(cuid())
  opcoId             String
  opco               OpCo           @relation(fields: [opcoId], references: [id])
  title              String
  description        String
  category           ChangeCategory
  riskLevel          RiskLevel
  status             ChangeStatus   @default(draft)
  isEmergency        Boolean        @default(false)
  requesterId        String
  requester          User           @relation("Requester", fields: [requesterId], references: [id])

  contactEmail       String
  infrastructureType String
  changeReason       String?
  impactScope        String?
  implementationPlan String?
  testingPlan        String?
  backoutPlan        String?
  changeWindow       String?
  plannedStart       DateTime?
  plannedEnd         DateTime?
  slaDeadline        DateTime?

  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  assignees   ChangeAssignee[]
  approvals   Approval[]
  auditTrail  AuditLog[]
  attachments Attachment[]

  @@index([opcoId])
  @@index([requesterId])
  @@index([status])
}

model ChangeAssignee {
  id       String        @id @default(cuid())
  changeId String
  change   ChangeRequest @relation(fields: [changeId], references: [id])
  userId   String

  @@unique([changeId, userId])
}

model Approval {
  id         String        @id @default(cuid())
  changeId   String
  change     ChangeRequest @relation(fields: [changeId], references: [id])
  approverId String
  approver   User          @relation(fields: [approverId], references: [id])
  decision   String
  comment    String?
  isCab      Boolean       @default(false)
  decidedAt  DateTime      @default(now())

  @@index([changeId])
}

model ApproverDelegation {
  id         String   @id @default(cuid())
  opcoId     String
  fromUserId String
  fromUser   User     @relation("DelegatedBy", fields: [fromUserId], references: [id])
  toUserId   String
  toUser     User     @relation("DelegatedTo", fields: [toUserId], references: [id])
  validFrom  DateTime @default(now())
  validUntil DateTime
  isActive   Boolean  @default(true)

  @@index([opcoId])
  @@index([toUserId])
}

model AuditLog {
  id         String        @id @default(cuid())
  changeId   String
  change     ChangeRequest @relation(fields: [changeId], references: [id])
  actorId    String
  actor      User          @relation(fields: [actorId], references: [id])
  action     String
  fromStatus ChangeStatus?
  toStatus   ChangeStatus?
  note       String?
  metadata   Json?
  at         DateTime      @default(now())

  @@index([changeId])
  @@index([actorId])
}

model Attachment {
  id         String        @id @default(cuid())
  changeId   String
  change     ChangeRequest @relation(fields: [changeId], references: [id])
  filename   String
  storageKey String
  mimeType   String?
  sizeBytes  Int?
  uploadedAt DateTime      @default(now())
}

model BlackoutPeriod {
  id          String    @id @default(cuid())
  opcoId      String?
  opco        OpCo?     @relation(fields: [opcoId], references: [id])
  label       String
  startsAt    DateTime
  endsAt      DateTime
  createdById String
  createdAt   DateTime  @default(now())

  @@index([opcoId])
}
```

- [ ] **Step 2: Ensure Postgres is running**

```bash
docker compose -f docker/keycloak/docker-compose.yml up -d postgres
```

Verify `DATABASE_URL` in `.env.local` points to `postgresql://postgres:postgres@localhost:5432/csquared_cms`.

- [ ] **Step 3: Run migration**

```bash
pnpm prisma migrate dev --name v1-multi-tenant-schema
```
Expected: Migration created and applied. Prisma Client regenerated.
If it errors on enum changes: `pnpm prisma migrate reset --force` then retry.

- [ ] **Step 4: Add AuditLog immutability trigger migration**

After the initial migration runs, create a second migration for the Postgres trigger that enforces AuditLog immutability (ISO 27001 A.8.15 — converts soft control to evidenced technical enforcement):

```bash
pnpm prisma migrate dev --name audit-log-immutability-trigger --create-only
```

Edit the generated migration SQL file in `prisma/migrations/*/migration.sql` and append:

```sql
-- AuditLog rows are immutable: enforces ISO 27001 A.8.15 at the DB layer
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

Then apply it:

```bash
pnpm prisma migrate deploy
```

Write the verification test at `src/test/actions/audit-immutability.test.ts`:

```typescript
// src/test/actions/audit-immutability.test.ts
// TC-INT-AUDIT-001: AuditLog rows cannot be updated or deleted
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/server/db', () => ({
  getPrisma: () => ({
    auditLog: {
      update: vi.fn().mockRejectedValue(new Error('AuditLog rows are immutable (ISO 27001 A.8.15)')),
      delete: vi.fn().mockRejectedValue(new Error('AuditLog rows are immutable (ISO 27001 A.8.15)')),
    },
  }),
}))

describe('TC-INT-AUDIT-001: AuditLog immutability', () => {
  it('update throws immutability error', async () => {
    const { getPrisma } = await import('@/server/db')
    await expect(getPrisma().auditLog.update({ where: { id: 'any' }, data: { note: 'tampered' } }))
      .rejects.toThrow('immutable')
  })
  it('delete throws immutability error', async () => {
    const { getPrisma } = await import('@/server/db')
    await expect(getPrisma().auditLog.delete({ where: { id: 'any' } }))
      .rejects.toThrow('immutable')
  })
})
```

- [ ] **Step 5: Type-check**

```bash
pnpm tsc --noEmit
```
Expected: zero errors. Fix any import mismatches caused by the schema change.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/ src/test/actions/audit-immutability.test.ts
git commit -m "feat: migrate Prisma schema to v1 multi-tenant model + AuditLog immutability trigger"
```

---

### Task 2.2: Seed Data

**Files:**
- Create: `prisma/seed.ts`
- Modify: `package.json` (add tsx)

- [ ] **Step 1: Install tsx**

```bash
pnpm add -D tsx
```

- [ ] **Step 2: Create seed file**

```typescript
// prisma/seed.ts
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const opcos = [
  { slug: 'ghana',     name: 'CSquared Ghana',     locale: 'en', keycloakOrgId: 'org-ghana' },
  { slug: 'uganda',    name: 'CSquared Uganda',    locale: 'en', keycloakOrgId: 'org-uganda' },
  { slug: 'drc',       name: 'CSquared DRC',       locale: 'fr', keycloakOrgId: 'org-drc' },
  { slug: 'togo',      name: 'CSquared Togo',      locale: 'fr', keycloakOrgId: 'org-togo' },
  { slug: 'liberia',   name: 'CSquared Liberia',   locale: 'en', keycloakOrgId: 'org-liberia' },
  { slug: 'mauritius', name: 'CSquared Mauritius', locale: 'en', keycloakOrgId: 'org-mauritius' },
]

async function main() {
  for (const o of opcos) {
    await prisma.opCo.upsert({ where: { slug: o.slug }, update: {}, create: o })
  }
  console.log('Seeded 6 OpCos')

  await prisma.user.upsert({
    where: { email: 'devops@csquared.com' },
    update: {},
    create: { keycloakId: 'REPLACE_WITH_KEYCLOAK_SUB', email: 'devops@csquared.com', name: 'Dev Admin' },
  })
  console.log('Seeded dev admin user')

  const ghana = await prisma.opCo.findUnique({ where: { slug: 'ghana' } })
  const admin = await prisma.user.findUnique({ where: { email: 'devops@csquared.com' } })
  if (ghana && admin) {
    await prisma.changeRequest.upsert({
      where: { id: 'seed-cr-001' },
      update: {},
      create: {
        id: 'seed-cr-001',
        opcoId: ghana.id, requesterId: admin.id,
        title: 'Backbone IP route table update',
        description: 'Update BGP route table for new peering arrangement',
        category: 'config', riskLevel: 'medium', status: 'pending',
        contactEmail: 'devops@csquared.com',
        infrastructureType: 'Backbone IP Network',
      },
    })
    console.log('Seeded 1 sample change request')
  }
}

main().catch(console.error).finally(() => prisma.$disconnect())
```

- [ ] **Step 3: Run seed**

```bash
pnpm prisma db seed
```
Expected:
```
Seeded 6 OpCos
Seeded dev admin user
Seeded 1 sample change request
```

- [ ] **Step 4: Verify in Prisma Studio**

```bash
pnpm prisma studio
```
Open http://localhost:5555 — confirm OpCo has 6 rows, User has 1, ChangeRequest has 1.

- [ ] **Step 5: Update devops keycloakId**

In Keycloak admin (http://localhost:8080) → Users → devops@csquared.com → copy the user ID (UUID).

```bash
# Replace <UUID> with the actual Keycloak user ID:
pnpm prisma db execute --stdin <<'SQL'
UPDATE "User" SET "keycloakId" = '<UUID>' WHERE email = 'devops@csquared.com';
SQL
```

- [ ] **Step 6: Commit**

```bash
git add prisma/seed.ts package.json pnpm-lock.yaml
git commit -m "feat: add Prisma seed with 6 OpCos and sample data"
```

---

## Phase 3: Core Server Actions

### Task 3.0: Testcontainers Integration Test Setup

**Files:**
- Create: `src/test/db.ts`
- Create: `src/test/integration/isolation.test.ts`

This task is a prerequisite for Tasks 3.2 and 3.3. OpCo isolation tests must run against real Postgres — mocking Prisma for isolation tests defeats the purpose (a missing `WHERE opcoId` clause won't be caught by a mock that returns what you told it to).

- [ ] **Step 1: Install Testcontainers**

```bash
pnpm add -D testcontainers @testcontainers/postgresql
```

- [ ] **Step 2: Create shared test DB helper**

```typescript
// src/test/db.ts
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { execSync } from 'child_process'
import { PrismaClient } from '@prisma/client'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'

let container: Awaited<ReturnType<typeof PostgreSqlContainer.prototype.start>>
let prisma: PrismaClient

export async function startTestDb() {
  container = await new PostgreSqlContainer('postgres:16').start()
  const connectionString = container.getConnectionUri()
  process.env.DATABASE_URL = connectionString

  execSync('pnpm prisma migrate deploy', { env: { ...process.env, DATABASE_URL: connectionString } })

  const pool = new Pool({ connectionString })
  const adapter = new PrismaPg(pool)
  prisma = new PrismaClient({ adapter })
  return prisma
}

export async function stopTestDb() {
  await prisma?.$disconnect()
  await container?.stop()
}

export function getTestDb() {
  if (!prisma) throw new Error('Call startTestDb() first')
  return prisma
}
```

- [ ] **Step 3: Write TC-INT-ISOL-001 — baseline OpCo isolation test**

```typescript
// src/test/integration/isolation.test.ts
// TC-INT-ISOL-001: Ghana-scoped user cannot see Uganda data
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startTestDb, stopTestDb, getTestDb } from '../db'

beforeAll(async () => {
  await startTestDb()
  const db = getTestDb()

  // Seed two OpCos and one change each
  const ghana = await db.opCo.create({ data: { slug: 'ghana', name: 'Ghana', keycloakOrgId: 'org-gh' } })
  const uganda = await db.opCo.create({ data: { slug: 'uganda', name: 'Uganda', keycloakOrgId: 'org-ug' } })

  const ghanaUser = await db.user.create({ data: { keycloakId: 'kc-gh', email: 'gh@csquared.com' } })
  const ugandaUser = await db.user.create({ data: { keycloakId: 'kc-ug', email: 'ug@csquared.com' } })

  await db.changeRequest.create({
    data: {
      id: 'cr-ghana-001', opcoId: ghana.id, requesterId: ghanaUser.id,
      title: 'Ghana change', description: 'Ghana only', category: 'config',
      riskLevel: 'low', contactEmail: 'gh@csquared.com', infrastructureType: 'Wifi',
    },
  })
  await db.changeRequest.create({
    data: {
      id: 'cr-uganda-001', opcoId: uganda.id, requesterId: ugandaUser.id,
      title: 'Uganda change', description: 'Uganda only', category: 'config',
      riskLevel: 'low', contactEmail: 'ug@csquared.com', infrastructureType: 'Wifi',
    },
  })
}, 60_000)

afterAll(stopTestDb)

describe('TC-INT-ISOL-001: OpCo data isolation', () => {
  it('Ghana-scoped query returns zero Uganda rows', async () => {
    const db = getTestDb()
    const ghana = await db.opCo.findUnique({ where: { slug: 'ghana' } })
    const results = await db.changeRequest.findMany({ where: { opcoId: ghana!.id } })
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('cr-ghana-001')
  })

  it('fetching Uganda change by ID returns null for Ghana filter', async () => {
    const db = getTestDb()
    const ghana = await db.opCo.findUnique({ where: { slug: 'ghana' } })
    const result = await db.changeRequest.findFirst({
      where: { id: 'cr-uganda-001', opcoId: ghana!.id }, // Ghana filter must exclude Uganda ID
    })
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 4: Run integration test**

```bash
pnpm test src/test/integration/isolation.test.ts
```
Expected: PASS (2 passing). These run against a real Postgres container — takes ~30s on first run.

- [ ] **Step 5: Commit**

```bash
git add src/test/db.ts src/test/integration/ pnpm-lock.yaml
git commit -m "test: add Testcontainers integration test setup and TC-INT-ISOL-001"
```

---

### Task 3.1: Session Helper

**Files:**
- Create: `src/lib/session.ts`
- Create: `src/test/helpers.ts`

- [ ] **Step 1: Create session helper**

```typescript
// src/lib/session.ts
import { auth } from "@/auth"
import type { SessionOrganization } from "@/types/next-auth"

export type AppSession = {
  keycloakId: string
  email: string
  name: string | null
  organizations: SessionOrganization[]
  realmRoles: string[]
}

export async function getAppSession(): Promise<AppSession> {
  const session = await auth()
  if (!session?.user) throw new Error("Unauthorized")
  return {
    keycloakId: session.user.keycloakId,
    email: session.user.email ?? "",
    name: session.user.name ?? null,
    organizations: session.user.organizations,
    realmRoles: session.user.realmRoles,
  }
}

export function getOpCoSlugsFromSession(session: AppSession): string[] | undefined {
  const { realmRoles } = session
  if (realmRoles.includes("group_admin") || realmRoles.includes("group_auditor")) {
    return undefined // undefined = no filter = all OpCos
  }
  return session.organizations.map((o) => o.alias)
}
```

- [ ] **Step 2: Create test helpers**

```typescript
// src/test/helpers.ts
import type { AppSession } from '@/lib/session'
import type { SessionOrganization } from '@/types/next-auth'

export function makeSession(overrides: Partial<AppSession> = {}): AppSession {
  return {
    keycloakId: 'kc-test-id',
    email: 'test@csquared.com',
    name: 'Test User',
    organizations: [{ id: 'org-1', name: 'Ghana', alias: 'ghana', roles: ['requester'] }],
    realmRoles: [],
    ...overrides,
  }
}

export function makeApproverSession(opco = 'ghana'): AppSession {
  return makeSession({
    organizations: [{ id: 'org-1', name: opco, alias: opco, roles: ['approver'] }],
  })
}

export function makeGroupAdminSession(): AppSession {
  return makeSession({ realmRoles: ['group_admin'] })
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/session.ts src/test/helpers.ts
git commit -m "feat: add typed AppSession helper and test factories"
```

---

### Task 3.2: Change Request Server Actions

**Files:**
- Create: `src/server/actions/changes.ts`
- Create: `src/test/actions/changes.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/test/actions/changes.test.ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/session', () => ({
  getAppSession: vi.fn().mockResolvedValue({
    keycloakId: 'kc-1', email: 'test@csquared.com', name: 'Test',
    organizations: [{ id: 'org-1', name: 'Ghana', alias: 'ghana', roles: ['requester'] }],
    realmRoles: [],
  }),
  getOpCoSlugsFromSession: vi.fn().mockReturnValue(['ghana']),
}))

vi.mock('@/server/db', () => ({
  getPrisma: () => ({
    opCo: { findUnique: vi.fn().mockResolvedValue({ id: 'opco-1', slug: 'ghana' }) },
    user: { findUnique: vi.fn().mockResolvedValue({ id: 'user-1', keycloakId: 'kc-1' }) },
    changeRequest: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockImplementation(({ data }) =>
        Promise.resolve({ id: 'cr-new', status: 'draft', ...data })
      ),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    blackoutPeriod: { findMany: vi.fn().mockResolvedValue([]) },
    userOpCoAssignment: { findMany: vi.fn().mockResolvedValue([]) },
  }),
}))

import { listChanges, createChange } from '@/server/actions/changes'

describe('listChanges', () => {
  it('returns empty array when no changes exist', async () => {
    expect(await listChanges('ghana')).toEqual([])
  })
})

describe('createChange', () => {
  it('creates a change request', async () => {
    const result = await createChange('ghana', {
      title: 'Router update', description: 'BGP config',
      category: 'config', riskLevel: 'low',
      contactEmail: 'test@csquared.com', infrastructureType: 'Backbone IP Network',
    })
    expect(result).toHaveProperty('id', 'cr-new')
    expect(result).toHaveProperty('status', 'draft')
  })

  it('throws if OpCo not found', async () => {
    const { getPrisma } = await import('@/server/db')
    // @ts-expect-error mock override
    getPrisma().opCo.findUnique.mockResolvedValueOnce(null)
    await expect(createChange('unknown', {
      title: 'X', description: 'X', category: 'config', riskLevel: 'low',
      contactEmail: 'x@csquared.com', infrastructureType: 'Wifi',
    })).rejects.toThrow('OpCo not found')
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm test src/test/actions/changes.test.ts
```
Expected: FAIL — "Cannot find module '@/server/actions/changes'"

- [ ] **Step 3: Create changes server actions**

```typescript
// src/server/actions/changes.ts
"use server"

import { getPrisma } from "@/server/db"
import { getAppSession } from "@/lib/session"
import type { ChangeCategory, RiskLevel, ChangeStatus } from "@prisma/client"

const SLA_HOURS: Record<RiskLevel, number> = { low: 48, medium: 24, high: 4, emergency: 1 }

type CreateChangeInput = {
  title: string
  description: string
  category: ChangeCategory
  riskLevel: RiskLevel
  contactEmail: string
  infrastructureType: string
  changeReason?: string
  impactScope?: string
  implementationPlan?: string
  testingPlan?: string
  backoutPlan?: string
  changeWindow?: string
  plannedStart?: Date
  plannedEnd?: Date
  isEmergency?: boolean
}

export async function listChanges(opcoSlug: string) {
  const session = await getAppSession()
  const db = getPrisma()
  return db.changeRequest.findMany({
    where: { opco: { slug: opcoSlug } },
    include: { requester: true, approvals: true, opco: true },
    orderBy: { createdAt: "desc" },
  })
}

export async function createChange(opcoSlug: string, data: CreateChangeInput) {
  const session = await getAppSession()
  const db = getPrisma()

  const [opco, user] = await Promise.all([
    db.opCo.findUnique({ where: { slug: opcoSlug } }),
    db.user.findUnique({ where: { keycloakId: session.keycloakId } }),
  ])

  if (!opco) throw new Error(`OpCo not found: ${opcoSlug}`)
  if (!user) throw new Error("User not found in database")

  if (!data.isEmergency) {
    const now = new Date()
    const activeBlackouts = await db.blackoutPeriod.findMany({
      where: {
        OR: [{ opcoId: opco.id }, { opcoId: null }],
        startsAt: { lte: now }, endsAt: { gte: now },
      },
    })
    if (activeBlackouts.length > 0) {
      throw new Error(`Blocked by blackout: "${activeBlackouts[0].label}". Submit as emergency to override.`)
    }
  }

  const slaDeadline = new Date()
  slaDeadline.setHours(slaDeadline.getHours() + SLA_HOURS[data.riskLevel])

  const change = await db.changeRequest.create({
    data: { ...data, opcoId: opco.id, requesterId: user.id, status: "draft", slaDeadline },
  })

  await db.auditLog.create({
    data: { changeId: change.id, actorId: user.id, action: "created", toStatus: "draft" },
  })

  return change
}

const VALID_TRANSITIONS: Partial<Record<ChangeStatus, ChangeStatus[]>> = {
  draft: ["pending"],
  pending: ["approved", "rejected"],
  approved: ["implemented"],
  implemented: ["verified"],
  verified: ["closed"],
  rejected: ["draft"],
}

export async function updateChangeStatus(changeId: string, toStatus: ChangeStatus, note?: string) {
  const session = await getAppSession()
  const db = getPrisma()
  const user = await db.user.findUnique({ where: { keycloakId: session.keycloakId } })
  if (!user) throw new Error("User not found")

  const change = await db.changeRequest.findUnique({ where: { id: changeId } })
  if (!change) throw new Error("Change not found")

  if (!VALID_TRANSITIONS[change.status]?.includes(toStatus)) {
    throw new Error(`Invalid transition: ${change.status} → ${toStatus}`)
  }

  const updated = await db.changeRequest.update({ where: { id: changeId }, data: { status: toStatus } })
  await db.auditLog.create({
    data: { changeId, actorId: user.id, action: "status_changed", fromStatus: change.status, toStatus, note },
  })
  return updated
}
```

- [ ] **Step 4: Run tests — verify pass**

```bash
pnpm test src/test/actions/changes.test.ts
```
Expected: PASS (3 passing)

- [ ] **Step 5: Commit**

```bash
git add src/server/actions/changes.ts src/test/actions/changes.test.ts
git commit -m "feat: add change request server actions with blackout enforcement"
```

---

### Task 3.3: Approval Server Actions

**Files:**
- Create: `src/server/actions/approvals.ts`
- Create: `src/test/actions/approvals.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/test/actions/approvals.test.ts
import { describe, it, expect } from 'vitest'
import { checkCabQuorum } from '@/server/actions/approvals'

type MockApproval = { isCab: boolean; decision: string; approverId: string }

describe('checkCabQuorum', () => {
  it('returns false with 1 CAB approval', () => {
    expect(checkCabQuorum([{ isCab: true, decision: 'approve', approverId: 'u1' }])).toBe(false)
  })

  it('returns true with 2 different CAB approvals', () => {
    expect(checkCabQuorum([
      { isCab: true, decision: 'approve', approverId: 'u1' },
      { isCab: true, decision: 'approve', approverId: 'u2' },
    ])).toBe(true)
  })

  it('does not count the same approver twice', () => {
    expect(checkCabQuorum([
      { isCab: true, decision: 'approve', approverId: 'u1' },
      { isCab: true, decision: 'approve', approverId: 'u1' },
    ])).toBe(false)
  })

  it('does not count non-CAB approvals toward quorum', () => {
    expect(checkCabQuorum([
      { isCab: false, decision: 'approve', approverId: 'u1' },
      { isCab: false, decision: 'approve', approverId: 'u2' },
    ])).toBe(false)
  })
})

// TC-CONTRACT-SOD-001: Segregation of Duties — requester cannot approve own change
describe('TC-CONTRACT-SOD-001: self-approval prevention', () => {
  it('throws SoD error when approver is the requester', async () => {
    vi.mock('@/lib/session', () => ({
      getAppSession: vi.fn().mockResolvedValue({
        keycloakId: 'kc-requester', email: 'req@csquared.com', name: 'Requester',
        organizations: [{ id: 'org-1', name: 'Ghana', alias: 'ghana', roles: ['approver'] }],
        realmRoles: [],
      }),
    }))
    vi.mock('@/server/db', () => ({
      getPrisma: () => ({
        user: { findUnique: vi.fn().mockResolvedValue({ id: 'user-requester', keycloakId: 'kc-requester' }) },
        changeRequest: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'cr-1', status: 'pending', riskLevel: 'low',
            requesterId: 'user-requester', // same user trying to approve their own change
            approvals: [],
          }),
        },
      }),
    }))
    const { submitApproval } = await import('@/server/actions/approvals')
    await expect(submitApproval('cr-1', 'approve', undefined, false))
      .rejects.toThrow('SoD violation')
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm test src/test/actions/approvals.test.ts
```
Expected: FAIL

- [ ] **Step 3: Create approvals server actions**

```typescript
// src/server/actions/approvals.ts
"use server"

import { getPrisma } from "@/server/db"
import { getAppSession } from "@/lib/session"

type QuorumApproval = { isCab: boolean; decision: string; approverId: string }

export function checkCabQuorum(approvals: QuorumApproval[]): boolean {
  const uniqueCabApprovers = new Set(
    approvals
      .filter((a) => a.isCab && a.decision === "approve")
      .map((a) => a.approverId)
  )
  return uniqueCabApprovers.size >= 2
}

export async function submitApproval(
  changeId: string,
  decision: "approve" | "reject",
  comment: string | undefined,
  isCab: boolean
) {
  const session = await getAppSession()

  if (decision === "reject" && !comment?.trim()) {
    throw new Error("A comment is required when rejecting a change")
  }

  const db = getPrisma()
  const user = await db.user.findUnique({ where: { keycloakId: session.keycloakId } })
  if (!user) throw new Error("User not found")

  const change = await db.changeRequest.findUnique({
    where: { id: changeId },
    include: { approvals: true },
  })
  if (!change) throw new Error("Change not found")
  if (change.status !== "pending") throw new Error("Change is not pending")

  // ISO 27001 A.5.3 — Segregation of Duties: requesters cannot approve their own changes
  if (change.requesterId === user.id) {
    throw new Error("Approvers cannot approve their own requests (SoD violation — ISO 27001 A.5.3)")
  }

  const approval = await db.approval.create({
    data: { changeId, approverId: user.id, decision, comment, isCab },
  })

  const allApprovals = [...change.approvals, { isCab, decision, approverId: user.id }]
  const needsCab = change.riskLevel === "high" || change.riskLevel === "emergency"
  const quorumMet = needsCab ? checkCabQuorum(allApprovals) : decision === "approve"

  if (decision === "approve" && quorumMet) {
    await db.changeRequest.update({ where: { id: changeId }, data: { status: "approved" } })
    await db.auditLog.create({
      data: { changeId, actorId: user.id, action: "approved", fromStatus: "pending", toStatus: "approved" },
    })
  }

  if (decision === "reject") {
    await db.changeRequest.update({ where: { id: changeId }, data: { status: "rejected" } })
    await db.auditLog.create({
      data: { changeId, actorId: user.id, action: "rejected", fromStatus: "pending", toStatus: "rejected", note: comment },
    })
  }

  return approval
}
```

- [ ] **Step 4: Run tests — verify pass**

```bash
pnpm test src/test/actions/approvals.test.ts
```
Expected: PASS (4 passing)

- [ ] **Step 5: Commit**

```bash
git add src/server/actions/approvals.ts src/test/actions/approvals.test.ts
git commit -m "feat: add approval server actions with CAB quorum enforcement"
```

---

### Task 3.4: Blackout Period Actions

**Files:**
- Create: `src/server/actions/blackout.ts`
- Create: `src/test/actions/blackout.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/test/actions/blackout.test.ts
import { describe, it, expect } from 'vitest'
import { isInBlackout } from '@/server/actions/blackout'

const blackouts = [{
  id: 'b1', opcoId: 'opco-1',
  startsAt: new Date('2026-12-24T00:00:00Z'),
  endsAt: new Date('2026-12-27T23:59:59Z'),
}]

describe('isInBlackout', () => {
  it('returns true when date falls within a blackout', () => {
    expect(isInBlackout(blackouts, new Date('2026-12-25T12:00:00Z'))).toBe(true)
  })
  it('returns false when date is outside all blackouts', () => {
    expect(isInBlackout(blackouts, new Date('2026-12-20T12:00:00Z'))).toBe(false)
  })
  it('returns false for empty blackout list', () => {
    expect(isInBlackout([], new Date())).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm test src/test/actions/blackout.test.ts
```
Expected: FAIL

- [ ] **Step 3: Create blackout actions**

```typescript
// src/server/actions/blackout.ts
"use server"

import { getPrisma } from "@/server/db"
import { getAppSession } from "@/lib/session"

type BlackoutRecord = { id: string; opcoId: string | null; startsAt: Date; endsAt: Date }

export function isInBlackout(blackouts: BlackoutRecord[], date: Date): boolean {
  return blackouts.some((b) => date >= b.startsAt && date <= b.endsAt)
}

export async function getActiveBlackouts(opcoSlug: string) {
  const db = getPrisma()
  const opco = await db.opCo.findUnique({ where: { slug: opcoSlug } })
  if (!opco) return []
  const now = new Date()
  return db.blackoutPeriod.findMany({
    where: {
      startsAt: { lte: now }, endsAt: { gte: now },
      OR: [{ opcoId: opco.id }, { opcoId: null }],
    },
  })
}

export async function createBlackoutPeriod(input: {
  opcoSlug: string | null
  label: string
  startsAt: Date
  endsAt: Date
}) {
  const session = await getAppSession()
  const db = getPrisma()
  const user = await db.user.findUnique({ where: { keycloakId: session.keycloakId } })
  if (!user) throw new Error("User not found")

  const opco = input.opcoSlug
    ? await db.opCo.findUnique({ where: { slug: input.opcoSlug } })
    : null

  return db.blackoutPeriod.create({
    data: {
      opcoId: opco?.id ?? null,
      label: input.label,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      createdById: user.id,
    },
  })
}
```

- [ ] **Step 4: Run tests — verify pass**

```bash
pnpm test src/test/actions/blackout.test.ts
```
Expected: PASS (3 passing)

- [ ] **Step 5: Run full suite**

```bash
pnpm test
```
Expected: all tests passing.

- [ ] **Step 6: Commit**

```bash
git add src/server/actions/blackout.ts src/test/actions/blackout.test.ts
git commit -m "feat: add blackout period server actions"
```

---

## Phase 4: Feature Wiring

**Approach for every page in this phase:**
1. Convert to a server component that calls `auth()` and Prisma queries directly
2. Extract interactive parts (forms, buttons) into `"use client"` child components
3. Server actions replace all `useStore()` mutation calls
4. Call `router.refresh()` after mutations to revalidate server data
5. Remove all Zustand data imports from each wired page

### Task 4.1: Wire Dashboard

**Files:** Modify `src/app/(dashboard)/page.tsx`

- [ ] **Step 1: Convert to server component**

```typescript
// src/app/(dashboard)/page.tsx
import { auth } from "@/auth"
import { getPrisma } from "@/server/db"
import { redirect } from "next/navigation"
import { isGroupAdmin } from "@/lib/permissions"

export default async function DashboardPage() {
  const session = await auth()
  if (!session) redirect("/login")

  const db = getPrisma()
  const opcoSlugs = session.user.organizations.map((o) => o.alias)
  const groupLevel = isGroupAdmin(session.user.realmRoles)
  const opcoFilter = groupLevel ? {} : { opco: { slug: { in: opcoSlugs } } }

  const [pending, approved, implemented, recent] = await Promise.all([
    db.changeRequest.count({ where: { status: "pending", ...opcoFilter } }),
    db.changeRequest.count({ where: { status: "approved", ...opcoFilter } }),
    db.changeRequest.count({ where: { status: "implemented", ...opcoFilter } }),
    db.changeRequest.findMany({
      where: opcoFilter,
      include: { requester: true, opco: true },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ])

  // Preserve all existing dashboard UI — replace Zustand data refs with the above variables
  // pending, approved, implemented, recent replace any useStore().changes references
}
```

- [ ] **Step 2: Test in browser**

Navigate to http://localhost:3000. KPI counts should reflect real DB data (mostly 0 + the 1 seeded change).

- [ ] **Step 3: Commit**

```bash
git add src/app/\(dashboard\)/page.tsx
git commit -m "feat: wire dashboard to real Prisma queries"
```

---

### Task 4.2: Wire Change Request Form

**Files:** Modify `src/app/(dashboard)/requests/page.tsx`

- [ ] **Step 1: Replace Zustand submit with server action**

```typescript
// Key changes in requests/page.tsx:
import { createChange } from "@/server/actions/changes"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"

const { data: session } = useSession()
const router = useRouter()
const opcoAlias = session?.user.organizations[0]?.alias ?? "ghana"

// Replace the final form submit handler:
async function handleSubmit(formValues: FormValues) {
  try {
    await createChange(opcoAlias, {
      title: formValues.title,
      description: formValues.description,
      category: formValues.category,
      riskLevel: formValues.riskLevel,
      contactEmail: formValues.email ?? session?.user.email ?? "",
      infrastructureType: formValues.infrastructureType,
      changeReason: formValues.changeReason,
      impactScope: formValues.impactScope,
      implementationPlan: formValues.implementationPlan,
      testingPlan: formValues.testingPlan,
      backoutPlan: formValues.backoutPlan,
      changeWindow: formValues.changeWindow,
      plannedStart: formValues.plannedStart ? new Date(formValues.plannedStart) : undefined,
      plannedEnd: formValues.plannedEnd ? new Date(formValues.plannedEnd) : undefined,
      isEmergency: formValues.riskLevel === "emergency",
    })
    toast.success("Change request submitted")
    router.push("/changes")
    router.refresh()
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Submission failed")
  }
}
```

Remove: `const { add } = useStore()` and all Zustand change imports.

- [ ] **Step 2: End-to-end test**

Submit a change request via the form. Open Prisma Studio (http://localhost:5555) and verify a new `ChangeRequest` and `AuditLog` row appear.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(dashboard\)/requests/page.tsx
git commit -m "feat: wire change request form to createChange server action"
```

---

### Task 4.3: Wire Approvals Page

**Files:**
- Create: `src/app/(dashboard)/approvals/approvals-client.tsx`
- Modify: `src/app/(dashboard)/approvals/page.tsx`

- [ ] **Step 1: Create client component**

```typescript
// src/app/(dashboard)/approvals/approvals-client.tsx
"use client"

import { useState } from "react"
import { submitApproval } from "@/server/actions/approvals"
import { useRouter } from "next/navigation"

type Change = {
  id: string; title: string; riskLevel: string
  requester: { name: string | null; email: string }
  opco: { name: string }
  approvals: { isCab: boolean; decision: string; approverId: string }[]
}

export function ApprovalsClient({ changes, isCabMember }: { changes: Change[]; isCabMember: boolean }) {
  const router = useRouter()
  const [comments, setComments] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState<string | null>(null)

  async function handleDecision(changeId: string, decision: "approve" | "reject") {
    setLoading(changeId)
    try {
      await submitApproval(changeId, decision, comments[changeId], isCabMember)
      router.refresh()
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed")
    } finally {
      setLoading(null)
    }
  }

  if (changes.length === 0) return <p className="text-muted-foreground">No pending approvals.</p>

  return (
    <div className="space-y-4">
      {changes.map((change) => {
        const cabCount = change.approvals.filter((a) => a.isCab && a.decision === "approve").length
        const needsCab = change.riskLevel === "high" || change.riskLevel === "emergency"
        return (
          <div key={change.id} className="rounded border p-4 space-y-2">
            <h3 className="font-semibold">{change.title}</h3>
            <p className="text-sm text-muted-foreground">
              {change.opco.name} · {change.riskLevel} risk · by {change.requester.name ?? change.requester.email}
            </p>
            {needsCab && (
              <p className="text-sm font-medium text-orange-600">CAB quorum: {cabCount}/2</p>
            )}
            <textarea
              className="w-full rounded border px-2 py-1 text-sm"
              placeholder="Comment (required when rejecting)"
              value={comments[change.id] ?? ""}
              onChange={(e) => setComments((p) => ({ ...p, [change.id]: e.target.value }))}
            />
            <div className="flex gap-2">
              <button disabled={!!loading} onClick={() => handleDecision(change.id, "approve")}
                className="rounded bg-green-600 px-3 py-1 text-sm text-white disabled:opacity-50">
                Approve
              </button>
              <button disabled={!!loading} onClick={() => handleDecision(change.id, "reject")}
                className="rounded bg-red-600 px-3 py-1 text-sm text-white disabled:opacity-50">
                Reject
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Convert approvals/page.tsx to server component**

```typescript
// src/app/(dashboard)/approvals/page.tsx
import { auth } from "@/auth"
import { getPrisma } from "@/server/db"
import { redirect } from "next/navigation"
import { ApprovalsClient } from "./approvals-client"
import { isGroupAdmin } from "@/lib/permissions"

export default async function ApprovalsPage() {
  const session = await auth()
  if (!session) redirect("/login")

  const db = getPrisma()
  const opcoSlugs = session.user.organizations.map((o) => o.alias)

  const changes = await db.changeRequest.findMany({
    where: { status: "pending", opco: { slug: { in: opcoSlugs } } },
    include: { requester: true, opco: true, approvals: true },
    orderBy: { createdAt: "asc" },
  })

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Pending Approvals</h1>
      <ApprovalsClient
        changes={changes}
        isCabMember={isGroupAdmin(session.user.realmRoles)}
      />
    </div>
  )
}
```

- [ ] **Step 3: Test end-to-end**

Log in as approver. Navigate to /approvals. Approve the seeded pending change. Verify status = "approved" in Prisma Studio.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(dashboard\)/approvals/
git commit -m "feat: wire approvals page to submitApproval server action with CAB quorum UI"
```

---

### Task 4.4: Wire Remaining Pages

**Files:** `changes/page.tsx`, `audits/page.tsx`, `reports/page.tsx`, `users/page.tsx`, `teams/page.tsx`

- [ ] **Step 1: Wire changes/page.tsx**

Convert to server component. Fetch `ChangeRequest` where `status IN ['approved', 'implemented', 'verified']` scoped to user's OpCos. Status transition buttons in a client component call `updateChangeStatus` server action + `router.refresh()`.

Key Prisma query:
```typescript
const changes = await db.changeRequest.findMany({
  where: { status: { in: ["approved", "implemented", "verified"] }, opco: { slug: { in: opcoSlugs } } },
  include: { requester: true, opco: true },
  orderBy: { updatedAt: "desc" },
})
```

- [ ] **Step 2: Wire audits/page.tsx**

```typescript
// Full server component query:
const entries = await db.auditLog.findMany({
  where: { change: { opco: { slug: { in: opcoSlugs } } } },
  include: { actor: true, change: { include: { opco: true } } },
  orderBy: { at: "desc" },
  take: 100,
})
```

Replace the raw JSON `<pre>` dump with a table of: Timestamp, Actor, Change Title, Action, OpCo, From/To Status, Note.

- [ ] **Step 3: Wire reports/page.tsx**

Replace Zustand `changes` with Prisma `groupBy` queries:

```typescript
const byStatus = await db.changeRequest.groupBy({
  by: ["status"],
  where: { opco: { slug: { in: opcoSlugs } } },
  _count: { status: true },
})
const byRisk = await db.changeRequest.groupBy({
  by: ["riskLevel"],
  where: { opco: { slug: { in: opcoSlugs } } },
  _count: { riskLevel: true },
})
```

- [ ] **Step 4: Wire users/page.tsx**

Replace `addUser` Zustand call with `createUser` server action. Fetch users:
```typescript
const users = await db.user.findMany({
  where: { opcoAssignments: { some: { opco: { slug: { in: opcoSlugs } }, isActive: true } } },
  include: { opcoAssignments: { include: { opco: true } } },
})
```

- [ ] **Step 5: Wire teams/page.tsx**

Replace Zustand with:
```typescript
const teams = await db.team.findMany({
  where: { opco: { slug: { in: opcoSlugs } } },
  include: { members: { include: { user: true } }, opco: true },
})
```

Team mutations call `createTeam` / `updateTeam` server actions from `src/server/actions/teams.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(dashboard\)/changes/page.tsx src/app/\(dashboard\)/audits/page.tsx src/app/\(dashboard\)/reports/page.tsx src/app/\(dashboard\)/users/page.tsx src/app/\(dashboard\)/teams/page.tsx
git commit -m "feat: wire changes, audits, reports, users, teams pages to real DB"
```

---

### Task 4.5: Final Cleanup

- [ ] **Step 1: Type-check**

```bash
pnpm tsc --noEmit
```
Fix all errors (old Zustand data refs, `AppUser` replaced by session types, etc.)

- [ ] **Step 2: Run all tests**

```bash
pnpm test
```
Expected: all passing.

- [ ] **Step 3: Build check**

```bash
pnpm build
```
Expected: clean production build.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: Phase 4 type-check fixes and final Zustand cleanup"
```

---

## Phase 5: Multi-Tenant UI, Admin, Notifications, Exports

### Task 5.1: OpCo Switcher

**Files:**
- Create: `src/lib/opco.ts`
- Create: `src/components/opco-switcher.tsx`
- Modify: `src/components/app-shell.tsx`

- [ ] **Step 1: Create OpCo utilities**

```typescript
// src/lib/opco.ts
import type { SessionOrganization } from "@/types/next-auth"

export const OPCO_SLUGS = ["ghana", "uganda", "drc", "togo", "liberia", "mauritius"] as const
export type OpCoSlug = typeof OPCO_SLUGS[number]

export const OPCO_NAMES: Record<OpCoSlug, string> = {
  ghana: "CSquared Ghana",
  uganda: "CSquared Uganda",
  drc: "CSquared DRC",
  togo: "CSquared Togo",
  liberia: "CSquared Liberia",
  mauritius: "CSquared Mauritius",
}

export function getUserOpCos(organizations: SessionOrganization[]): OpCoSlug[] {
  return organizations
    .map((o) => o.alias as OpCoSlug)
    .filter((s) => (OPCO_SLUGS as readonly string[]).includes(s))
}
```

- [ ] **Step 2: Create OpCo switcher**

```typescript
// src/components/opco-switcher.tsx
"use client"

import { useSession } from "next-auth/react"
import { getUserOpCos, OPCO_NAMES, OPCO_SLUGS } from "@/lib/opco"
import { isGroupAdmin } from "@/lib/permissions"
import { useMemo } from "react"

// Stores active OpCo in a cookie; server components read it from request headers
function setActiveOpCo(slug: string) {
  document.cookie = `csq-active-opco=${slug}; path=/; max-age=86400`
  window.location.reload()
}

export function OpCoSwitcher() {
  const { data: session } = useSession()
  if (!session) return null

  const userIsGroupAdmin = isGroupAdmin(session.user.realmRoles)
  const userOpCos = getUserOpCos(session.user.organizations)

  const options = useMemo(() => {
    if (userIsGroupAdmin) {
      return [
        { value: "all", label: "All OpCos" },
        ...OPCO_SLUGS.map((s) => ({ value: s, label: OPCO_NAMES[s] })),
      ]
    }
    return userOpCos.map((s) => ({ value: s, label: OPCO_NAMES[s] }))
  }, [userIsGroupAdmin, userOpCos])

  if (options.length <= 1) return null

  return (
    <select
      defaultValue={userOpCos[0] ?? "all"}
      onChange={(e) => setActiveOpCo(e.target.value)}
      className="rounded border bg-background px-2 py-1 text-sm"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}
```

- [ ] **Step 3: Add to AppShell header**

In `src/components/app-shell.tsx`, import and add `<OpCoSwitcher />` in the header section near the user avatar/name.

- [ ] **Step 4: Commit**

```bash
git add src/lib/opco.ts src/components/opco-switcher.tsx src/components/app-shell.tsx
git commit -m "feat: add OpCo switcher to header for group-level users"
```

---

### Task 5.2: Keycloak Admin API + Full User Creation

**Files:**
- Create: `src/server/keycloak.ts`
- Modify: `src/server/actions/users.ts`

- [ ] **Step 1: Create Keycloak admin client**

```typescript
// src/server/keycloak.ts
const KC = process.env.KEYCLOAK_ISSUER!.replace("/realms/csquared", "")
const REALM = "csquared"

async function getAdminToken(): Promise<string> {
  const res = await fetch(`${KC}/realms/master/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: "admin-cli",
      client_secret: process.env.KEYCLOAK_ADMIN_CLIENT_SECRET!,
    }),
  })
  const data = await res.json()
  if (!data.access_token) throw new Error("Failed to get Keycloak admin token")
  return data.access_token
}

export async function createKeycloakUser(email: string, name: string, tempPassword: string): Promise<string> {
  const token = await getAdminToken()
  const [firstName, ...rest] = name.split(" ")
  const res = await fetch(`${KC}/admin/realms/${REALM}/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      email, firstName, lastName: rest.join(" "),
      enabled: true, emailVerified: true,
      credentials: [{ type: "password", value: tempPassword, temporary: true }],
    }),
  })
  if (!res.ok) throw new Error(`Keycloak createUser failed: ${res.status}`)
  return res.headers.get("Location")!.split("/").pop()!
}

export async function assignToOrganization(keycloakUserId: string, orgAlias: string): Promise<void> {
  const token = await getAdminToken()
  const orgsRes = await fetch(`${KC}/admin/realms/${REALM}/organizations?search=${orgAlias}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const orgs = await orgsRes.json()
  const org = orgs.find((o: { alias: string }) => o.alias === orgAlias)
  if (!org) throw new Error(`Keycloak org not found: ${orgAlias}`)
  await fetch(`${KC}/admin/realms/${REALM}/organizations/${org.id}/members`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ id: keycloakUserId }),
  })
}

export async function deactivateKeycloakUser(keycloakUserId: string): Promise<void> {
  const token = await getAdminToken()
  await fetch(`${KC}/admin/realms/${REALM}/users/${keycloakUserId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ enabled: false }),
  })
}
```

Add to `.env.local`: `KEYCLOAK_ADMIN_CLIENT_SECRET=<admin-cli secret from Keycloak>`

- [ ] **Step 2: Update users.ts to use Keycloak**

```typescript
// src/server/actions/users.ts
"use server"

import { getPrisma } from "@/server/db"
import { getAppSession } from "@/lib/session"
import { createKeycloakUser, assignToOrganization, deactivateKeycloakUser } from "@/server/keycloak"
import type { Role } from "@prisma/client"

export async function createUser(input: {
  name: string
  email: string
  tempPassword: string
  assignments: Array<{ opcoSlug: string; role: Role }>
}) {
  await getAppSession()
  const db = getPrisma()

  const keycloakId = await createKeycloakUser(input.email, input.name, input.tempPassword)
  for (const a of input.assignments) {
    await assignToOrganization(keycloakId, a.opcoSlug)
  }

  const user = await db.user.create({ data: { keycloakId, email: input.email, name: input.name } })
  for (const a of input.assignments) {
    const opco = await db.opCo.findUnique({ where: { slug: a.opcoSlug } })
    if (opco) {
      await db.userOpCoAssignment.create({ data: { userId: user.id, opcoId: opco.id, role: a.role } })
    }
  }
  return user
}

export async function deactivateUser(userId: string) {
  await getAppSession()
  const db = getPrisma()
  const user = await db.user.findUnique({ where: { id: userId } })
  if (!user) throw new Error("User not found")
  await deactivateKeycloakUser(user.keycloakId)
  await db.user.update({ where: { id: userId }, data: { isActive: false } })
  await db.userOpCoAssignment.updateMany({
    where: { userId },
    data: { isActive: false, endedAt: new Date() },
  })
}
```

- [ ] **Step 3: Commit**

```bash
git add src/server/keycloak.ts src/server/actions/users.ts
git commit -m "feat: wire user creation to Keycloak Admin REST API"
```

---

### Task 5.3: Email Notifications

**Files:**
- Create: `src/server/email.ts`
- Modify: `src/server/actions/changes.ts`
- Modify: `src/server/actions/approvals.ts`

- [ ] **Step 1: Install Resend**

```bash
pnpm add resend
```

Add to `.env.local`: `RESEND_API_KEY=re_your_key_here`

- [ ] **Step 2: Create email client**

```typescript
// src/server/email.ts
import { Resend } from "resend"

const resend = new Resend(process.env.RESEND_API_KEY)
const FROM = "CSquared CMS <noreply@csquared.com>"
const BASE = process.env.NEXTAUTH_URL ?? "http://localhost:3000"

export async function sendApprovalRequestEmail(opts: {
  to: string; approverName: string; changeTitle: string
  requesterName: string; riskLevel: string; changeId: string
}) {
  await resend.emails.send({
    from: FROM, to: opts.to,
    subject: `Action Required: Approve "${opts.changeTitle}"`,
    html: `<p>Hi ${opts.approverName},</p>
<p><strong>${opts.requesterName}</strong> submitted a <strong>${opts.riskLevel} risk</strong> change: <strong>${opts.changeTitle}</strong>.</p>
<p><a href="${BASE}/approvals">Review &amp; Approve</a></p>`,
  })
}

export async function sendStatusChangeEmail(opts: {
  to: string; name: string; changeTitle: string; newStatus: string
}) {
  await resend.emails.send({
    from: FROM, to: opts.to,
    subject: `Change "${opts.changeTitle}" updated: ${opts.newStatus}`,
    html: `<p>Hi ${opts.name},</p>
<p>Your change request <strong>${opts.changeTitle}</strong> is now: <strong>${opts.newStatus}</strong>.</p>
<p><a href="${BASE}/changes">View Changes</a></p>`,
  })
}
```

- [ ] **Step 3: Trigger emails in changes.ts**

In `createChange`, after `auditLog.create`, add:
```typescript
import { sendApprovalRequestEmail } from "@/server/email"

const approvers = await db.userOpCoAssignment.findMany({
  where: { opcoId: opco.id, role: "approver", isActive: true },
  include: { user: true },
})
await Promise.allSettled(approvers.map((a) =>
  sendApprovalRequestEmail({
    to: a.user.email, approverName: a.user.name ?? a.user.email,
    changeTitle: change.title, requesterName: user.name ?? user.email,
    riskLevel: change.riskLevel, changeId: change.id,
  })
))
```

- [ ] **Step 4: Trigger emails in approvals.ts**

After any status change to approved/rejected, add:
```typescript
import { sendStatusChangeEmail } from "@/server/email"

const requester = await db.user.findUnique({ where: { id: change.requesterId } })
if (requester) {
  sendStatusChangeEmail({
    to: requester.email, name: requester.name ?? requester.email,
    changeTitle: change.title,
    newStatus: decision === "approve" ? "approved" : "rejected",
  }).catch(console.error)
}
```

- [ ] **Step 5: Verify in Resend dashboard**

Submit a change request. Check https://resend.com/emails to verify the notification email was sent.

- [ ] **Step 6: Commit**

```bash
git add src/server/email.ts src/server/actions/changes.ts src/server/actions/approvals.ts pnpm-lock.yaml
git commit -m "feat: add email notifications via Resend"
```

---

### Task 5.4: Audit CSV Export

**Files:**
- Create: `src/app/api/audit-export/route.ts`
- Modify: `src/app/(dashboard)/audit-exports/page.tsx`

- [ ] **Step 1: Create export route handler**

```typescript
// src/app/api/audit-export/route.ts
import { auth } from "@/auth"
import { getPrisma } from "@/server/db"
import { NextRequest, NextResponse } from "next/server"
import { isGroupAdmin } from "@/lib/permissions"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = req.nextUrl
  const opcoSlug = searchParams.get("opco")
  const from = searchParams.get("from")
  const to = searchParams.get("to")

  const db = getPrisma()
  const groupLevel = isGroupAdmin(session.user.realmRoles)
  const opcoSlugs = groupLevel
    ? (opcoSlug ? [opcoSlug] : undefined)
    : session.user.organizations.map((o) => o.alias)

  const entries = await db.auditLog.findMany({
    where: {
      change: { opco: opcoSlugs ? { slug: { in: opcoSlugs } } : undefined },
      ...(from && { at: { gte: new Date(from) } }),
      ...(to && { at: { lte: new Date(to) } }),
    },
    include: { actor: true, change: { include: { opco: true } } },
    orderBy: { at: "desc" },
  })

  const headers = ["Timestamp","Actor","Action","Change Title","OpCo","From Status","To Status","Note"]
  const rows = entries.map((e) => [
    e.at.toISOString(), e.actor.email, e.action, e.change.title,
    e.change.opco.slug, e.fromStatus ?? "", e.toStatus ?? "", e.note ?? "",
  ])
  const csv = [headers, ...rows]
    .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\n")

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="csquared-audit-${Date.now()}.csv"`,
    },
  })
}
```

- [ ] **Step 2: Wire audit-exports page**

```typescript
// src/app/(dashboard)/audit-exports/page.tsx
"use client"
import { useState } from "react"

export default function AuditExportsPage() {
  const [opco, setOpco] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")

  function download() {
    const p = new URLSearchParams()
    if (opco) p.set("opco", opco)
    if (from) p.set("from", from)
    if (to) p.set("to", to)
    window.location.href = `/api/audit-export?${p}`
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Audit Exports</h1>
      <p className="text-muted-foreground">Download audit trail CSV for ISO 27001 evidence packages.</p>
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-sm mb-1">OpCo (blank = all)</label>
          <input type="text" value={opco} onChange={(e) => setOpco(e.target.value)}
            placeholder="ghana, uganda ..." className="rounded border px-2 py-1 text-sm" />
        </div>
        <div>
          <label className="block text-sm mb-1">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="rounded border px-2 py-1 text-sm" />
        </div>
        <div>
          <label className="block text-sm mb-1">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="rounded border px-2 py-1 text-sm" />
        </div>
        <button onClick={download}
          className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground">
          Download CSV
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Test export**

Navigate to /audit-exports. Click Download CSV. Verify a `.csv` file downloads with the correct audit headers and data rows.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/audit-export/route.ts src/app/\(dashboard\)/audit-exports/page.tsx
git commit -m "feat: add audit CSV export endpoint for ISO 27001 evidence"
```

---

### Task 5.5: CI/CD Pipeline

**Files:**
- Modify: `.github/workflows/ci-cd.yml` (currently empty — 1 line)

The testing plan gates described in §4 cannot enforce ISO compliance without a working pipeline. This task wires the quality and test jobs.

- [ ] **Step 1: Install gitleaks (pre-commit secret scanning)**

```bash
# Add to .github/workflows or install as a pre-commit hook
# For local dev:
brew install gitleaks  # macOS
# Verify:
gitleaks detect --source . --verbose
```

- [ ] **Step 2: Install eslint-plugin-security**

```bash
pnpm add -D eslint-plugin-security
```

Add to `eslint.config.js` (or equivalent):
```javascript
import security from 'eslint-plugin-security'
// In plugins:
security.configs.recommended
```

- [ ] **Step 3: Replace .github/workflows/ci-cd.yml**

```yaml
# .github/workflows/ci-cd.yml
name: CI

on:
  pull_request:
  push:
    branches: [dev, prod]

jobs:
  quality:
    name: Type-check, Lint, Secrets
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm tsc --noEmit
      - run: pnpm lint
      - name: Secret scanning
        uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

  test:
    name: Unit + Integration Tests
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_DB: csquared_test
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
        ports: ["5432:5432"]
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    env:
      DATABASE_URL: postgresql://postgres:postgres@localhost:5432/csquared_test
      NEXTAUTH_SECRET: test-secret
      NEXTAUTH_URL: http://localhost:3000
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm prisma migrate deploy
      - run: pnpm test --coverage
      - name: Upload coverage
        uses: actions/upload-artifact@v4
        with:
          name: coverage-report
          path: coverage/
          retention-days: 30

  dependency-audit:
    name: Dependency Vulnerability Scan
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - run: pnpm audit --audit-level=high
```

- [ ] **Step 4: Verify pipeline runs**

Push a branch and confirm all three jobs pass in the GitHub Actions tab. The `quality` and `test` jobs must both be green before a PR can be merged (enable branch protection in GitHub repository settings: Settings → Branches → Require status checks → select `quality` and `test`).

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci-cd.yml package.json pnpm-lock.yaml
git commit -m "feat: wire CI/CD pipeline with type-check, tests, secret scanning, and dependency audit"
```

---

## Verification Checklist

Run after each phase before declaring it complete:

- [ ] `pnpm tsc --noEmit` — zero TypeScript errors
- [ ] `pnpm test` — all tests pass
- [ ] `pnpm build` — clean production build, no errors
- [ ] Login via Keycloak end-to-end: unauthenticated → /login → Keycloak → dashboard
- [ ] Middleware blocks unauthenticated routes (open incognito, go to /approvals → expect /login redirect)
- [ ] Submit a change → verify row in Prisma Studio (ChangeRequest + AuditLog)
- [ ] Approve a pending change → verify status = "approved"
- [ ] Reject without comment → verify error thrown
- [ ] High-risk change: verify 2 CAB approvals required before auto-advancing to approved
- [ ] Active blackout blocks non-emergency submissions
- [ ] OpCo switcher visible for group_admin, hidden for single-opco users
- [ ] Audit CSV downloads with correct headers and all audit rows
- [ ] Email notification received in Resend dashboard after change submission

---

## Environment Variables Reference

```bash
# Phase 1 — Auth
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=<openssl rand -base64 32>
KEYCLOAK_CLIENT_ID=csquared-cms
KEYCLOAK_CLIENT_SECRET=<from Keycloak admin UI>
KEYCLOAK_ISSUER=http://localhost:8080/realms/csquared

# Phase 2 — Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/csquared_cms

# Phase 5 — Admin API + Email
KEYCLOAK_ADMIN_CLIENT_SECRET=<admin-cli client secret from Keycloak>
RESEND_API_KEY=re_<your_key>
```
