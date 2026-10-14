// @vitest-environment node
// src/test/integration/feedback.test.ts
// Proves the hand-authored feedback migration matches the Prisma model and that the
// hand-added CHECK constraint holds: a triage cannot be recorded without an outcome.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startTestDb, stopTestDb, getTestDb } from '../db'

let userId: string

const row = () => ({
  userId,
  category: 'bug' as const,
  severity: 'major' as const,
  body: 'The approve button did nothing',
  route: '/changes/abc',
  roles: 'ghana:approver',
  opcoSlugs: 'ghana',
  locale: 'en',
  changeId: null,
  appVersion: 'local',
  viewport: '1280x800',
  userAgent: 'Mozilla/5.0',
})

beforeAll(async () => {
  await startTestDb()
  const user = await getTestDb().user.create({ data: { keycloakId: 'kc-fb', email: 'fb@csquared.com' } })
  userId = user.id
}, 120_000)

afterAll(stopTestDb)

describe('feedback table', () => {
  it('stores a submission with every context column', async () => {
    const created = await getTestDb().feedback.create({ data: row() })
    const read = await getTestDb().feedback.findUniqueOrThrow({ where: { id: created.id } })
    expect(read).toMatchObject({ category: 'bug', severity: 'major', roles: 'ghana:approver', triagedAt: null, outcome: null })
  })

  it('accepts a triage that records an outcome', async () => {
    const created = await getTestDb().feedback.create({ data: row() })
    const updated = await getTestDb().feedback.update({
      where: { id: created.id },
      data: { triagedAt: new Date(), outcome: 'fixed', triagedById: userId },
    })
    expect(updated.outcome).toBe('fixed')
  })

  it('rejects triagedAt without an outcome (feedback_triage_needs_outcome)', async () => {
    const created = await getTestDb().feedback.create({ data: row() })
    await expect(
      getTestDb().feedback.update({ where: { id: created.id }, data: { triagedAt: new Date() } })
    ).rejects.toThrow(/feedback_triage_needs_outcome|check constraint/i)
  })

  it('refuses to delete a user who has written feedback (ON DELETE RESTRICT)', async () => {
    await expect(getTestDb().user.delete({ where: { id: userId } })).rejects.toThrow()
  })
})
