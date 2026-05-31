// src/test/actions/approvals.test.ts
import { describe, it, expect, vi } from 'vitest'

// Top-level mocks — hoisted by Vitest before imports
vi.mock('@/lib/session', () => ({
  getAppSession: vi.fn().mockResolvedValue({
    keycloakId: 'kc-requester',
    email: 'requester@csquared.com',
    name: 'Requester',
    organizations: [],
    realmRoles: [],
  }),
}))

const mockDb = {
  user: {
    findUnique: vi.fn().mockResolvedValue({ id: 'user-requester', keycloakId: 'kc-requester' }),
  },
  changeRequest: {
    findUnique: vi.fn().mockResolvedValue({
      id: 'cr-1',
      status: 'pending',
      riskLevel: 'low',
      requesterId: 'user-requester', // same as user.id → triggers SoD
      approvals: [],
    }),
    update: vi.fn().mockResolvedValue({}),
  },
  approval: {
    create: vi.fn().mockResolvedValue({ id: 'appr-1' }),
  },
  auditLog: {
    create: vi.fn().mockResolvedValue({}),
  },
}

vi.mock('@/server/db', () => ({
  getPrisma: () => mockDb,
}))

import { checkCabQuorum } from '@/lib/cab-quorum'
import { submitApproval } from '@/server/actions/approvals'

// ── checkCabQuorum (pure function, no mocks needed) ──────────────────────────

describe('checkCabQuorum', () => {
  it('returns false with only 1 CAB approval', () => {
    expect(
      checkCabQuorum([{ isCab: true, decision: 'approve', approverId: 'a1' }])
    ).toBe(false)
  })

  it('returns true when 2 different CAB approvers both approve', () => {
    expect(
      checkCabQuorum([
        { isCab: true, decision: 'approve', approverId: 'a1' },
        { isCab: true, decision: 'approve', approverId: 'a2' },
      ])
    ).toBe(true)
  })

  it('returns false when same CAB approver appears twice (dedup by approverId)', () => {
    expect(
      checkCabQuorum([
        { isCab: true, decision: 'approve', approverId: 'a1' },
        { isCab: true, decision: 'approve', approverId: 'a1' },
      ])
    ).toBe(false)
  })

  it('returns false for 2 non-CAB approvals', () => {
    expect(
      checkCabQuorum([
        { isCab: false, decision: 'approve', approverId: 'a1' },
        { isCab: false, decision: 'approve', approverId: 'a2' },
      ])
    ).toBe(false)
  })
})

// ── TC-CONTRACT-SOD-001: Segregation of Duties (security-critical) ───────────

describe('TC-CONTRACT-SOD-001: submitApproval — self-approval rejected (SoD)', () => {
  it('throws a SoD violation error when requester tries to approve their own change', async () => {
    // session.keycloakId = 'kc-requester'
    // db.user.findUnique resolves to { id: 'user-requester' }
    // db.changeRequest.findUnique resolves with requesterId = 'user-requester'
    // → change.requesterId === user.id → SoD check fires
    await expect(
      submitApproval('cr-1', 'approve', undefined, false)
    ).rejects.toThrow(/SoD violation/)
  })
})
