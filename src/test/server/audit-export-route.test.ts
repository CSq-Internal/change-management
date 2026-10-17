import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const findMany = vi.fn()
vi.mock('@/server/db', () => ({ getPrisma: () => ({ auditLog: { findMany } }) }))
vi.mock('@/auth', () => ({
  auth: vi.fn().mockResolvedValue({ user: { realmRoles: ['group_auditor'], organizations: [] } }),
}))

import { GET } from '@/app/api/audit-export/route'

const get = (qs: string) => GET(new NextRequest(`http://localhost/api/audit-export?${qs}`))

beforeEach(() => {
  findMany.mockReset()
  findMany.mockResolvedValue([])
})

describe('GET /api/audit-export date range', () => {
  it('keeps both ends of the range, and the whole of the last day', async () => {
    await get('from=2026-10-01&to=2026-10-15')
    expect(findMany.mock.calls[0][0].where.at).toEqual({
      gte: new Date('2026-10-01T00:00:00.000Z'),
      lt: new Date('2026-10-16T00:00:00.000Z'),
    })
  })

  it('accepts an open-ended range', async () => {
    await get('from=2026-10-01')
    expect(findMany.mock.calls[0][0].where.at).toEqual({ gte: new Date('2026-10-01T00:00:00.000Z') })
  })

  it('applies no date filter when neither end is given', async () => {
    await get('')
    expect(findMany.mock.calls[0][0].where.at).toBeUndefined()
  })

  it('refuses a date it cannot read, instead of failing with a 500', async () => {
    const res = await get('from=yesterday')
    expect(res.status).toBe(400)
    expect(findMany).not.toHaveBeenCalled()
  })
})
