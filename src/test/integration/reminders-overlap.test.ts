// @vitest-environment node
// Two sweeps that overlap (the 15-minute schedule plus a manual run, say) must not both
// send the same reminder. Real Postgres: the guard is a row lock, which a mock can't show.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { startTestDb, stopTestDb, getTestDb } from '../db'

vi.mock('@/server/db', () => ({ getPrisma: () => getTestDb() }))
const { notifyChange } = vi.hoisted(() => ({
  // A slow send, so the second sweep checks the ledger while the first is still sending.
  notifyChange: vi.fn(() => new Promise((r) => setTimeout(r, 200))),
}))
vi.mock('@/server/notify', () => ({ notifyChange }))
let approverId = ''
vi.mock('@/server/audience', () => ({
  resolveAudience: async () => [{ userId: approverId, email: 'b@csquared.com', name: 'B' }],
}))

import { runDueReminders } from '@/server/reminders'

beforeAll(async () => {
  await startTestDb()
  const db = getTestDb()
  const opco = await db.opCo.create({ data: { slug: 'ghana', name: 'Ghana', keycloakOrgId: 'org-gh' } })
  const requester = await db.user.create({ data: { keycloakId: 'kc-1', email: 'a@csquared.com' } })
  approverId = (await db.user.create({ data: { keycloakId: 'kc-2', email: 'b@csquared.com' } })).id
  await db.changeRequest.create({
    data: {
      opcoId: opco.id, requesterId: requester.id, title: 'x', description: 'x', category: 'config',
      riskLevel: 'low', contactEmail: 'a@csquared.com', infrastructureType: 'Wifi', status: 'pending',
      slaDeadline: new Date(Date.now() + 10 * 60 * 60 * 1000), // 10h of 48h left: nudge due
    },
  })
}, 120_000)

afterAll(stopTestDb)

describe('runDueReminders', () => {
  it('sends a due nudge once when two sweeps overlap', async () => {
    const [a, b] = await Promise.all([runDueReminders(), runDueReminders()])
    expect(a.nudged + b.nudged).toBe(1)
    expect(notifyChange).toHaveBeenCalledTimes(1)
  })
})
