import { describe, it, expect, vi, beforeEach } from 'vitest'

let cookieValue: string | undefined
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => (name === 'csq-active-opco' && cookieValue ? { value: cookieValue } : undefined) }),
}))

import { activeOpCoSlug, withActiveOpCo } from '@/server/active-opco'

const groupUser = { organizations: [], realmRoles: ['group_admin'] }
const ghanaAdmin = { organizations: [{ id: 'o', name: 'Ghana', alias: 'ghana', roles: ['admin'] }], realmRoles: [] }

beforeEach(() => { cookieValue = undefined })

describe('activeOpCoSlug', () => {
  it('returns null when no cookie is set', async () => {
    expect(await activeOpCoSlug(groupUser)).toBeNull()
  })

  it('returns null for the "all" sentinel', async () => {
    cookieValue = 'all'
    expect(await activeOpCoSlug(groupUser)).toBeNull()
  })

  it('lets a group-level viewer focus on any OpCo', async () => {
    cookieValue = 'uganda'
    expect(await activeOpCoSlug(groupUser)).toBe('uganda')
  })

  it('lets an OpCo viewer focus on an OpCo they belong to', async () => {
    cookieValue = 'ghana'
    expect(await activeOpCoSlug(ghanaAdmin)).toBe('ghana')
  })

  it('ignores an OpCo the viewer is not entitled to see', async () => {
    cookieValue = 'uganda' // ghana admin has no uganda access
    expect(await activeOpCoSlug(ghanaAdmin)).toBeNull()
  })
})

describe('withActiveOpCo', () => {
  it('is a no-op when active is null', () => {
    expect(withActiveOpCo({ status: 'pending' }, null)).toEqual({ status: 'pending' })
  })

  it('ANDs the active OpCo onto the base filter', () => {
    expect(withActiveOpCo({ status: 'pending' }, 'ghana')).toEqual({
      AND: [{ status: 'pending' }, { opco: { slug: 'ghana' } }],
    })
  })
})
