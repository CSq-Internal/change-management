import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
const findMany = vi.fn()
vi.mock('@/server/db', () => ({ getPrisma: () => ({ opCo: { findMany } }) }))

import { activeOpCos } from '@/server/opco-scope'

beforeEach(() => { findMany.mockReset().mockResolvedValue([]) })

describe('activeOpCos', () => {
  it('lists every OpCo that is not archived for "all", so a new OpCo shows up', async () => {
    findMany.mockResolvedValue([{ slug: 'kenya', name: 'CSquared Kenya' }])
    expect(await activeOpCos('all')).toEqual([{ slug: 'kenya', name: 'CSquared Kenya' }])
    expect(findMany.mock.calls[0][0].where).toEqual({ archivedAt: null })
  })

  it('narrows to the given slugs and still drops archived ones', async () => {
    await activeOpCos(['ghana'])
    expect(findMany.mock.calls[0][0].where).toEqual({ archivedAt: null, slug: { in: ['ghana'] } })
  })
})
