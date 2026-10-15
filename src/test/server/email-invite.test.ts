import { describe, it, expect, vi, beforeEach } from 'vitest'

const send = vi.fn().mockResolvedValue({ data: { id: 'e1' }, error: null })
vi.mock('resend', () => ({ Resend: class { emails = { send } } }))

beforeEach(() => {
  vi.resetModules()
  send.mockClear()
  process.env.RESEND_API_KEY = 're_test'
})

const lastHtml = () => send.mock.calls[0][0].html as string

describe('sendUserInvitationEmail', () => {
  it.each([
    ['en', /Sign in with Google/, /password/i],
    ['fr', /Se connecter avec Google/, /mot de passe/i],
  ] as const)('tells people to sign in with Google and never mentions a password (%s)', async (locale, google, password) => {
    const { sendUserInvitationEmail } = await import('@/server/email')
    await sendUserInvitationEmail({
      to: 'pat@csquared.com',
      name: 'Pat',
      assignments: [{ opcoSlug: 'ghana', role: 'requester' }],
      locale,
    })
    const html = lastHtml()
    expect(html).toMatch(google)
    expect(html).not.toMatch(password)
  })
})
