// src/test/actions/blackout-authz.test.ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/session', () => ({
  getAppSession: vi.fn().mockResolvedValue({
    keycloakId: 'kc-1', email: 'test@csquared.com', name: 'Test',
    organizations: [{ id: 'org-gh', name: 'Ghana', alias: 'ghana', roles: ['admin'] }],
    realmRoles: [],
  }),
}))

const tx = {
  user: { findUnique: vi.fn().mockResolvedValue({ id: 'user-1', keycloakId: 'kc-1' }) },
  blackoutPeriod: {
    create: vi.fn().mockResolvedValue({ id: 'bo-1' }),
    delete: vi.fn().mockResolvedValue({ id: 'bo-1' }),
  },
  adminAuditLog: { create: vi.fn().mockResolvedValue({}) },
}
const mockDb = {
  opCo: { findUnique: vi.fn().mockResolvedValue({ id: 'opco-gh', slug: 'ghana' }) },
  blackoutPeriod: {
    findMany: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn().mockResolvedValue({
      id: 'bo-1', label: 'X', opcoId: 'opco-gh', opco: { slug: 'ghana' },
    }),
  },
  $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
}

vi.mock('@/server/db', () => ({ getPrisma: () => mockDb }))

import { createBlackoutPeriod, deleteBlackoutPeriod, getActiveBlackouts } from '@/server/actions/blackout'
import { getAppSession } from '@/lib/session'

const start = new Date('2026-12-24T00:00:00Z')
const end = new Date('2026-12-27T00:00:00Z')

describe('createBlackoutPeriod — authorization', () => {
  it('allows a ghana admin to create a ghana blackout and writes an admin-audit row', async () => {
    const result = await createBlackoutPeriod({ opcoSlug: 'ghana', label: 'X', startsAt: start, endsAt: end })
    expect(result).toHaveProperty('id', 'bo-1')
    expect(tx.adminAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'blackout_created' }) })
    )
  })

  it('rejects a ghana admin creating a blackout for another OpCo (uganda)', async () => {
    await expect(
      createBlackoutPeriod({ opcoSlug: 'uganda', label: 'X', startsAt: start, endsAt: end })
    ).rejects.toThrow(/Forbidden/)
  })

  it('rejects a non-group-admin creating a global blackout (opcoSlug null)', async () => {
    await expect(
      createBlackoutPeriod({ opcoSlug: null, label: 'X', startsAt: start, endsAt: end })
    ).rejects.toThrow(/Forbidden/)
  })

  it('allows group_admin to create a global blackout', async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce({
      keycloakId: 'kc-ga', email: 'ga@csquared.com', name: 'GA',
      organizations: [], realmRoles: ['group_admin'],
    })
    const result = await createBlackoutPeriod({ opcoSlug: null, label: 'X', startsAt: start, endsAt: end })
    expect(result).toHaveProperty('id', 'bo-1')
  })
})

describe('deleteBlackoutPeriod — audit', () => {
  it('allows a ghana admin to remove a ghana blackout and writes an admin-audit row', async () => {
    await deleteBlackoutPeriod('bo-1')
    expect(tx.blackoutPeriod.delete).toHaveBeenCalledWith({ where: { id: 'bo-1' } })
    expect(tx.adminAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'blackout_removed' }) })
    )
  })
})

describe('getActiveBlackouts — authorization', () => {
  it('rejects a non-member, non-group caller', async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce({
      keycloakId: 'kc-ug', email: 'ug@csquared.com', name: 'UG',
      organizations: [{ id: 'org-ug', name: 'Uganda', alias: 'uganda', roles: ['requester'] }],
      realmRoles: [],
    })
    await expect(getActiveBlackouts('ghana')).rejects.toThrow(/Forbidden/)
  })

  it('allows a group_auditor (read-only group level)', async () => {
    vi.mocked(getAppSession).mockResolvedValueOnce({
      keycloakId: 'kc-aud', email: 'aud@csquared.com', name: 'Aud',
      organizations: [], realmRoles: ['group_auditor'],
    })
    expect(await getActiveBlackouts('ghana')).toEqual([])
  })
})
