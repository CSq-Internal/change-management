import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const { runDueEscalations, runDueReminders } = vi.hoisted(() => ({
  runDueEscalations: vi.fn().mockResolvedValue({ escalated: 0 }),
  runDueReminders: vi.fn().mockResolvedValue({ nudged: 0, retroOverdue: 0 }),
}))
vi.mock('@/server/sla', () => ({ runDueEscalations }))
vi.mock('@/server/reminders', () => ({ runDueReminders }))

import { GET, POST } from '@/app/api/cron/sla/route'

const call = (handler: typeof GET, headers: Record<string, string> = {}) =>
  handler(new NextRequest('http://localhost/api/cron/sla', { headers }))

const saved = process.env.CRON_SECRET
beforeEach(() => { vi.clearAllMocks(); process.env.CRON_SECRET = 's3cret' })
afterEach(() => { process.env.CRON_SECRET = saved })

// The sweep emails every approver, so anyone who can call it can spam the company.
describe('/api/cron/sla', () => {
  it('401 with no secret, and runs nothing', async () => {
    expect((await call(GET)).status).toBe(401)
    expect(runDueEscalations).not.toHaveBeenCalled()
  })

  it('401 with a wrong secret in either header', async () => {
    expect((await call(GET, { authorization: 'Bearer nope' })).status).toBe(401)
    expect((await call(POST, { 'x-cron-secret': 'nope' })).status).toBe(401)
    expect(runDueReminders).not.toHaveBeenCalled()
  })

  it('401 when CRON_SECRET is unset, even for the literal "Bearer undefined"', async () => {
    delete process.env.CRON_SECRET
    expect((await call(GET, { authorization: 'Bearer undefined' })).status).toBe(401)
    expect((await call(POST, { 'x-cron-secret': '' })).status).toBe(401)
  })

  it('runs the sweep for Vercel Cron (Bearer) and Cloud Scheduler (x-cron-secret)', async () => {
    expect((await call(GET, { authorization: 'Bearer s3cret' })).status).toBe(200)
    expect((await call(POST, { 'x-cron-secret': 's3cret' })).status).toBe(200)
    expect(runDueEscalations).toHaveBeenCalledTimes(2)
  })
})
