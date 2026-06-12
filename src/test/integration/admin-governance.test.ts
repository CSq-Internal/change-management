// @vitest-environment node
// src/test/integration/admin-governance.test.ts
// TC-INT-CAB-001: CABMembership uniqueness (per-OpCo enforced, group NULL-distinct)
// TC-INT-AUDIT-002: AdminAuditLog persists actor/metadata round-trip
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startTestDb, stopTestDb, getTestDb } from '../db'

beforeAll(async () => {
  await startTestDb()
  const db = getTestDb()
  await db.opCo.create({ data: { slug: 'ghana', name: 'Ghana', keycloakOrgId: 'org-gh' } })
  await db.user.create({ data: { keycloakId: 'kc-cab', email: 'cab@csquared.com' } })
}, 120_000)

afterAll(stopTestDb)

describe('TC-INT-CAB-001: CABMembership uniqueness', () => {
  it('enforces one row per (userId, opcoId) for a per-OpCo CAB', async () => {
    const db = getTestDb()
    const user = await db.user.findUniqueOrThrow({ where: { keycloakId: 'kc-cab' } })
    const opco = await db.opCo.findUniqueOrThrow({ where: { slug: 'ghana' } })

    await db.cABMembership.create({ data: { userId: user.id, opcoId: opco.id } })

    // Second per-OpCo row for the same user violates @@unique([userId, opcoId]).
    await expect(
      db.cABMembership.create({ data: { userId: user.id, opcoId: opco.id } })
    ).rejects.toThrow(/Unique constraint|P2002/)
  })

  it('allows multiple group rows (opcoId NULL) — Postgres treats NULL as distinct', async () => {
    const db = getTestDb()
    const user = await db.user.findUniqueOrThrow({ where: { keycloakId: 'kc-cab' } })

    await db.cABMembership.create({ data: { userId: user.id, opcoId: null } })
    // The DB does NOT block a second NULL-opcoId row — this is exactly why
    // addCabMember must guard group membership in application code.
    await db.cABMembership.create({ data: { userId: user.id, opcoId: null } })

    const groupRows = await db.cABMembership.count({ where: { userId: user.id, opcoId: null } })
    expect(groupRows).toBe(2)
  })

  it('supports soft-remove then upsert-revive of a per-OpCo membership', async () => {
    const db = getTestDb()
    const user = await db.user.findUniqueOrThrow({ where: { keycloakId: 'kc-cab' } })
    const opco = await db.opCo.findUniqueOrThrow({ where: { slug: 'ghana' } })

    const existing = await db.cABMembership.findFirstOrThrow({
      where: { userId: user.id, opcoId: opco.id },
    })
    await db.cABMembership.update({
      where: { id: existing.id },
      data: { isActive: false, endedAt: new Date() },
    })

    // Re-adding revives the same row rather than creating a duplicate.
    const revived = await db.cABMembership.update({
      where: { userId_opcoId: { userId: user.id, opcoId: opco.id } },
      data: { isActive: true, endedAt: null },
    })
    expect(revived.id).toBe(existing.id)
    expect(revived.isActive).toBe(true)
    expect(revived.endedAt).toBeNull()
  })
})

describe('TC-INT-AUDIT-002: AdminAuditLog persistence', () => {
  it('stores the actor relation and round-trips JSON metadata', async () => {
    const db = getTestDb()
    const user = await db.user.findUniqueOrThrow({ where: { keycloakId: 'kc-cab' } })

    const entry = await db.adminAuditLog.create({
      data: {
        actorId: user.id,
        action: 'role.update',
        targetUserId: user.id,
        summary: 'Updated assignments',
        metadata: { from: 'requester', to: 'approver' },
      },
    })

    const found = await db.adminAuditLog.findUniqueOrThrow({ where: { id: entry.id } })
    expect(found.actorId).toBe(user.id)
    expect(found.action).toBe('role.update')
    expect(found.metadata).toEqual({ from: 'requester', to: 'approver' })
    expect(found.at).toBeInstanceOf(Date)
  })
})
