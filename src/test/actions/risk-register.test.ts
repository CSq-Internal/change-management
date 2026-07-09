// src/test/actions/risk-register.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const session = {
  keycloakId: 'kc-admin', email: 'admin@csquared.com', name: 'Admin',
  organizations: [{ id: 'org-gh', name: 'Ghana', alias: 'ghana', roles: ['admin'] }],
  realmRoles: [],
}
vi.mock('@/lib/session', () => ({ getAppSession: vi.fn(async () => session) }))
// listRisks now reads the active-OpCo cookie; default to none set (no narrowing).
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))

const tx = {
  user: { findUnique: vi.fn(async () => ({ id: 'user-admin' })) },
  adminAuditLog: { create: vi.fn(async () => ({})) },
  riskRegister: { create: vi.fn(async () => ({ id: 'r1' })), update: vi.fn(async () => ({ id: 'r1' })) },
}
const mockDb = {
  opCo: { findUnique: vi.fn(async () => ({ id: 'opco-gh', slug: 'ghana' })) },
  riskRegister: {
    findMany: vi.fn(async () => []),
    findUnique: vi.fn(async () => ({ id: 'r1', opcoId: 'opco-gh', opco: { slug: 'ghana' } })),
  },
  $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
}
vi.mock('@/server/db', () => ({ getPrisma: () => mockDb }))

import { createRisk, listRisks } from '@/server/actions/risk-register'

const validInput = {
  title: 'Power instability', description: 'Grid drops', category: 'operational' as const,
  likelihood: 3, impact: 4, owner: 'Ops', mitigationPlan: 'Generators', status: 'open' as const,
  reviewDate: null, opcoSlug: 'ghana' as string | null,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.opCo.findUnique.mockResolvedValue({ id: 'opco-gh', slug: 'ghana' })
})

describe('createRisk', () => {
  it('creates an OpCo risk for an OpCo admin and writes an admin-audit row', async () => {
    await createRisk(validInput)
    expect(tx.riskRegister.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ title: 'Power instability', opcoId: 'opco-gh' }) })
    )
    expect(tx.adminAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'risk_created' }) })
    )
  })

  it('rejects an out-of-range likelihood', async () => {
    await expect(createRisk({ ...validInput, likelihood: 9 })).rejects.toThrow(/1.*5/)
  })

  it('forbids an OpCo admin creating a group-scoped risk', async () => {
    await expect(createRisk({ ...validInput, opcoSlug: null })).rejects.toThrow(/Forbidden/i)
  })
})

describe('listRisks', () => {
  it('scopes an OpCo user to their OpCos plus group-wide risks', async () => {
    await listRisks()
    expect(mockDb.riskRegister.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ opcoId: null }, { opco: { slug: { in: ['ghana'] } } }] },
      })
    )
  })
})
