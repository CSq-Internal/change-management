import { describe, it, expect, vi, beforeEach } from 'vitest'

const send = vi.fn().mockResolvedValue({ data: { id: 'e1' }, error: null })
vi.mock('resend', () => ({ Resend: class { emails = { send } } }))

beforeEach(() => {
  vi.resetModules()
  send.mockClear()
  process.env.RESEND_API_KEY = 're_test'
})

const lastHtml = () => send.mock.calls[0][0].html as string

describe('sendUserInvitationEmail federated variant', () => {
  it('omits the temp password and uses Google copy when federated (en)', async () => {
    const { sendUserInvitationEmail } = await import('@/server/email')
    await sendUserInvitationEmail({
      to: 'pat@csquared.com',
      name: 'Pat',
      existingIdentity: true,
      federated: true,
      assignments: [{ opcoSlug: 'ghana', role: 'requester' }],
      locale: 'en',
    })
    const html = lastHtml()
    expect(html).toMatch(/Sign in with Google/i)
    expect(html).not.toMatch(/temporary password/i)
  })

  it('includes the temp password when federated is falsy and existingIdentity is false (en)', async () => {
    const { sendUserInvitationEmail } = await import('@/server/email')
    await sendUserInvitationEmail({
      to: 'pat@csquared.com',
      name: 'Pat',
      tempPassword: 'ChangeMe123!',
      existingIdentity: false,
      assignments: [{ opcoSlug: 'ghana', role: 'requester' }],
      locale: 'en',
    })
    const html = lastHtml()
    expect(html).toMatch(/temporary password/i)
  })
})
