// @vitest-environment node
// The data migration that grants pending requester requests when self-service
// requester access ships. migrate deploy runs before any rows exist, so the test
// seeds rows first and then runs the migration's SQL itself.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { startTestDb, stopTestDb, getTestDb } from '../db'

const SQL = readFileSync(
  join(process.cwd(), 'prisma/migrations/20261016120000_self_service_requester/migration.sql'),
  'utf8',
)

beforeAll(async () => {
  await startTestDb()
  const db = getTestDb()
  const ghana = await db.opCo.create({ data: { slug: 'ghana', name: 'Ghana', keycloakOrgId: 'org-gh' } })
  const uganda = await db.opCo.create({ data: { slug: 'uganda', name: 'Uganda', keycloakOrgId: 'org-ug' } })
  const ama = await db.user.create({ data: { keycloakId: 'kc-ama', email: 'ama@csquared.com' } })
  const kofi = await db.user.create({ data: { keycloakId: 'kc-kofi', email: 'kofi@csquared.com' } })
  const esi = await db.user.create({ data: { keycloakId: 'kc-esi', email: 'esi@csquared.com' } })
  const yaw = await db.user.create({ data: { keycloakId: 'kc-yaw', email: 'yaw@csquared.com', isActive: false } })
  const abena = await db.user.create({ data: { keycloakId: 'kc-abena', email: 'abena@csquared.com' } })

  // Ama: plain pending requester request → gets an assignment.
  await db.accessRequest.create({ data: { id: 'ar-ama', userId: ama.id, opcoId: ghana.id, role: 'requester' } })
  // Kofi: pending approver request → untouched.
  await db.accessRequest.create({ data: { id: 'ar-kofi', userId: kofi.id, opcoId: ghana.id, role: 'approver' } })
  // Esi: an admin ended her Uganda row; her pending requester request must not undo that.
  await db.userOpCoAssignment.create({ data: { userId: esi.id, opcoId: uganda.id, role: 'approver', isActive: false, endedAt: new Date() } })
  await db.accessRequest.create({ data: { id: 'ar-esi', userId: esi.id, opcoId: uganda.id, role: 'requester' } })
  // Yaw: deactivated → nothing granted.
  await db.accessRequest.create({ data: { id: 'ar-yaw', userId: yaw.id, opcoId: ghana.id, role: 'requester' } })
  // Abena: pending in two OpCos → only the earlier one is granted.
  await db.accessRequest.create({ data: { id: 'ar-abena-1', userId: abena.id, opcoId: uganda.id, role: 'requester', createdAt: new Date('2026-10-01T00:00:00Z') } })
  await db.accessRequest.create({ data: { id: 'ar-abena-2', userId: abena.id, opcoId: ghana.id, role: 'requester', createdAt: new Date('2026-10-02T00:00:00Z') } })

  await db.$executeRawUnsafe(SQL)
}, 120_000)

afterAll(stopTestDb)

describe('self-service requester migration', () => {
  it('turns a pending requester request into an active requester assignment', async () => {
    const db = getTestDb()
    const asg = await db.userOpCoAssignment.findFirst({ where: { user: { email: 'ama@csquared.com' } } })
    expect(asg).toMatchObject({ role: 'requester', isActive: true })
    const ar = await db.accessRequest.findUnique({ where: { id: 'ar-ama' } })
    expect(ar).toMatchObject({ status: 'approved', decidedById: null, decisionReason: 'Auto-approved: requester access is self-service' })
    expect(ar?.decidedAt).toBeInstanceOf(Date)
  })

  it('leaves a pending higher-role request alone', async () => {
    const db = getTestDb()
    expect(await db.accessRequest.findUnique({ where: { id: 'ar-kofi' } })).toMatchObject({ status: 'pending' })
    expect(await db.userOpCoAssignment.count({ where: { user: { email: 'kofi@csquared.com' } } })).toBe(0)
  })

  it('leaves a user an admin removed in the queue, with their ended row untouched', async () => {
    const db = getTestDb()
    expect(await db.accessRequest.findUnique({ where: { id: 'ar-esi' } })).toMatchObject({ status: 'pending' })
    const asg = await db.userOpCoAssignment.findFirst({ where: { user: { email: 'esi@csquared.com' } } })
    expect(asg).toMatchObject({ role: 'approver', isActive: false })
  })

  it('grants nothing to a deactivated user', async () => {
    const db = getTestDb()
    expect(await db.accessRequest.findUnique({ where: { id: 'ar-yaw' } })).toMatchObject({ status: 'pending' })
    expect(await db.userOpCoAssignment.count({ where: { user: { email: 'yaw@csquared.com' } } })).toBe(0)
  })

  it('grants only the earliest of several pending requester requests', async () => {
    const db = getTestDb()
    const rows = await db.userOpCoAssignment.findMany({ where: { user: { email: 'abena@csquared.com' } }, include: { opco: true } })
    expect(rows.map((r) => r.opco.slug)).toEqual(['uganda'])
    expect(await db.accessRequest.findUnique({ where: { id: 'ar-abena-1' } })).toMatchObject({ status: 'approved' })
    expect(await db.accessRequest.findUnique({ where: { id: 'ar-abena-2' } })).toMatchObject({ status: 'pending' })
  })
})
