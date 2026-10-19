// @vitest-environment node
// The group-roles migration refuses to run on a database that has users but no active
// group admin: under the new model nobody could grant the role. migrate deploy already ran
// it on the empty test DB; the statements are re-runnable, so the test runs the file again.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { startTestDb, stopTestDb, getTestDb } from '../db'

const SQL = readFileSync(
  join(process.cwd(), 'prisma/migrations/20261019120000_group_roles_in_app/migration.sql'),
  'utf8',
)

beforeAll(startTestDb, 120_000)
afterAll(stopTestDb)

describe('group roles migration', () => {
  it('passes on an empty User table (fresh install)', async () => {
    await expect(getTestDb().$executeRawUnsafe(SQL)).resolves.toBeDefined()
  })

  it('stops when users exist but none is an active group admin', async () => {
    const db = getTestDb()
    await db.user.create({ data: { keycloakId: 'kc-ama', email: 'ama@csquared.com' } })
    await db.user.create({ data: { keycloakId: 'kc-old', email: 'old@csquared.com', isGroupAdmin: true, isActive: false } })
    await expect(db.$executeRawUnsafe(SQL)).rejects.toThrow(/No active group admin/)
  })

  it('passes once one active user is a group admin', async () => {
    const db = getTestDb()
    await db.user.update({ where: { email: 'ama@csquared.com' }, data: { isGroupAdmin: true } })
    await expect(db.$executeRawUnsafe(SQL)).resolves.toBeDefined()
  })

  it('adds isGroupAuditor defaulting to false and lets an OpCo have no Keycloak org', async () => {
    const db = getTestDb()
    expect(await db.user.findUnique({ where: { email: 'ama@csquared.com' } })).toMatchObject({ isGroupAuditor: false })
    await expect(db.opCo.create({ data: { slug: 'kenya', name: 'Kenya' } })).resolves.toMatchObject({ slug: 'kenya' })
  })
})
