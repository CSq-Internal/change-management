// @vitest-environment node
// Group CAB seats and group approver overrides have opcoId = NULL. A plain unique index
// treats every NULL as different, so a double-click stored two rows. Real Postgres only.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startTestDb, stopTestDb, getTestDb } from '../db'

let userId: string

beforeAll(async () => {
  await startTestDb()
  userId = (await getTestDb().user.create({ data: { keycloakId: 'kc-1', email: 'a@csquared.com' } })).id
}, 120_000)

afterAll(stopTestDb)

describe('one row per group-level key', () => {
  it('refuses a second group CAB seat for the same user', async () => {
    const db = getTestDb()
    await db.cABMembership.create({ data: { userId, opcoId: null } })
    await expect(db.cABMembership.create({ data: { userId, opcoId: null } })).rejects.toThrow(/Unique constraint/)
  })

  it('refuses a second group override for the same user and infra type', async () => {
    const db = getTestDb()
    const row = { infrastructureType: 'Equiano IP', opcoId: null, userId, createdById: userId }
    await db.approverAssignment.create({ data: row })
    await expect(db.approverAssignment.create({ data: row })).rejects.toThrow(/Unique constraint/)
  })
})
