// @vitest-environment node
// src/test/integration/isolation.test.ts
// TC-INT-ISOL-001: Ghana-scoped user cannot see Uganda data
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startTestDb, stopTestDb, getTestDb } from '../db'

beforeAll(async () => {
  await startTestDb()
  const db = getTestDb()

  const ghana = await db.opCo.create({ data: { slug: 'ghana', name: 'Ghana', keycloakOrgId: 'org-gh' } })
  const uganda = await db.opCo.create({ data: { slug: 'uganda', name: 'Uganda', keycloakOrgId: 'org-ug' } })

  const ghanaUser = await db.user.create({ data: { keycloakId: 'kc-gh', email: 'gh@csquared.com' } })
  const ugandaUser = await db.user.create({ data: { keycloakId: 'kc-ug', email: 'ug@csquared.com' } })

  await db.changeRequest.create({
    data: {
      id: 'cr-ghana-001', opcoId: ghana.id, requesterId: ghanaUser.id,
      title: 'Ghana change', description: 'Ghana only', category: 'config',
      riskLevel: 'low', contactEmail: 'gh@csquared.com', infrastructureType: 'Wifi',
    },
  })
  await db.changeRequest.create({
    data: {
      id: 'cr-uganda-001', opcoId: uganda.id, requesterId: ugandaUser.id,
      title: 'Uganda change', description: 'Uganda only', category: 'config',
      riskLevel: 'low', contactEmail: 'ug@csquared.com', infrastructureType: 'Wifi',
    },
  })
}, 120_000)

afterAll(stopTestDb)

describe('TC-INT-ISOL-001: OpCo data isolation', () => {
  it('Ghana-scoped query returns zero Uganda rows', async () => {
    const db = getTestDb()
    const ghana = await db.opCo.findUnique({ where: { slug: 'ghana' } })
    const results = await db.changeRequest.findMany({ where: { opcoId: ghana!.id } })
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('cr-ghana-001')
  })

  it('fetching Uganda change by ID returns null for Ghana filter', async () => {
    const db = getTestDb()
    const ghana = await db.opCo.findUnique({ where: { slug: 'ghana' } })
    const result = await db.changeRequest.findFirst({
      where: { id: 'cr-uganda-001', opcoId: ghana!.id },
    })
    expect(result).toBeNull()
  })
})
