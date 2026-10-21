// @vitest-environment node
// A blackout set for a later month must stay listed (and removable) on whatever month the
// manager is viewing; otherwise it vanishes the moment it is saved. Real Postgres: the
// listing is a query filter.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { startTestDb, stopTestDb, getTestDb } from '../db'

vi.mock('@/server/db', () => ({ getPrisma: () => getTestDb() }))
vi.mock('@/auth', () => ({
  auth: async () => ({ user: { keycloakId: 'kc-ga', organizations: [], realmRoles: ['group_admin'] } }),
}))
vi.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`NEXT_REDIRECT:${to}`) } }))
vi.mock('@/server/active-opco', () => ({ activeOpCoSlug: async () => null, withActiveOpCo: (w: object) => w }))
vi.mock('@/app/(dashboard)/calendar/calendar-client', () => ({ default: () => null }))

import CalendarPage from '@/app/(dashboard)/calendar/page'

const DAY = 24 * 60 * 60 * 1000

beforeAll(async () => {
  await startTestDb()
  const db = getTestDb()
  const opco = await db.opCo.create({ data: { slug: 'ghana', name: 'Ghana' } })
  const ga = await db.user.create({ data: { keycloakId: 'kc-ga', email: 'ga@csquared.com', isGroupAdmin: true } })
  const at = (days: number) => new Date(Date.now() + days * DAY)
  await db.blackoutPeriod.createMany({
    data: [
      { label: 'Year-end freeze', opcoId: opco.id, startsAt: at(60), endsAt: at(90), createdById: ga.id },
      { label: 'Long over', opcoId: opco.id, startsAt: at(-90), endsAt: at(-80), createdById: ga.id },
    ],
  })
}, 120_000)

afterAll(stopTestDb)

describe('CalendarPage blackout list', () => {
  it('lists upcoming blackouts on the current month, but not ones long over', async () => {
    const el = (await CalendarPage({ searchParams: Promise.resolve({}) })) as { props: { blackouts: { label: string }[] } }
    expect(el.props.blackouts.map((b) => b.label)).toEqual(['Year-end freeze'])
  })
})
