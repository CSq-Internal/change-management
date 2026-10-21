// @vitest-environment node
// TC-INT-AUDIT-001/003: audit rows can't be changed or removed, by the app's own credentials.
// Runs the real migrations against Postgres, so a dropped trigger fails here.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startTestDb, stopTestDb, getTestDb } from '../db'

let auditId: string
let adminAuditId: string

beforeAll(async () => {
  await startTestDb()
  const db = getTestDb()
  const opco = await db.opCo.create({ data: { slug: 'ghana', name: 'Ghana' } })
  const user = await db.user.create({ data: { keycloakId: 'kc-1', email: 'a@csquared.com' } })
  const change = await db.changeRequest.create({
    data: {
      opcoId: opco.id, requesterId: user.id, title: 'x', description: 'x', category: 'config',
      riskLevel: 'low', contactEmail: 'a@csquared.com', infrastructureType: 'Wifi',
    },
  })
  auditId = (await db.auditLog.create({ data: { changeId: change.id, actorId: user.id, action: 'created' } })).id
  adminAuditId = (await db.adminAuditLog.create({
    data: { actorId: user.id, action: 'user.onboard', summary: 'Onboarded a@csquared.com' },
  })).id
}, 120_000)

afterAll(stopTestDb)

describe('AuditLog', () => {
  it('refuses update', async () => {
    await expect(getTestDb().auditLog.update({ where: { id: auditId }, data: { note: 'tampered' } })).rejects.toThrow(/immutable/)
  })
  it('refuses delete', async () => {
    await expect(getTestDb().auditLog.delete({ where: { id: auditId } })).rejects.toThrow(/immutable/)
  })
  it('refuses truncate', async () => {
    await expect(getTestDb().$executeRawUnsafe('TRUNCATE "AuditLog"')).rejects.toThrow(/immutable/)
  })
})

describe('AdminAuditLog', () => {
  it('refuses update', async () => {
    await expect(getTestDb().adminAuditLog.update({ where: { id: adminAuditId }, data: { summary: 'tampered' } })).rejects.toThrow(/immutable/)
  })
  it('refuses delete', async () => {
    await expect(getTestDb().adminAuditLog.delete({ where: { id: adminAuditId } })).rejects.toThrow(/immutable/)
  })
  it('refuses truncate', async () => {
    await expect(getTestDb().$executeRawUnsafe('TRUNCATE "AdminAuditLog"')).rejects.toThrow(/immutable/)
  })
  it('still accepts new rows', async () => {
    const db = getTestDb()
    const actor = await db.user.findFirstOrThrow()
    await expect(db.adminAuditLog.create({ data: { actorId: actor.id, action: 'x', summary: 'y' } })).resolves.toBeTruthy()
  })
})
