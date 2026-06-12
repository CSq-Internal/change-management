// src/test/helpers.ts
import type { AppSession } from '@/lib/session'

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
