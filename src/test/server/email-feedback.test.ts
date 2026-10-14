import { describe, it, expect, vi, beforeEach } from 'vitest'

const send = vi.fn().mockResolvedValue({ data: { id: 'e1' }, error: null })
vi.mock('resend', () => ({ Resend: class { emails = { send } } }))

beforeEach(() => {
  vi.resetModules()
  send.mockClear()
  process.env.RESEND_API_KEY = 're_test'
})

const OPTS = {
  to: 'cms-feedback@csquared.com',
  category: 'bug',
  route: '/changes/abc',
  authorName: 'Ama <script>alert(1)</script>',
  roles: 'ghana:approver',
  opcoSlugs: 'ghana',
  body: 'Broke on <b>submit</b> & "save"',
}

describe('sendFeedbackEmail', () => {
  it('sends to the inbox with the category and screen in the subject', async () => {
    const { sendFeedbackEmail } = await import('@/server/email')
    await sendFeedbackEmail(OPTS)
    const msg = send.mock.calls[0][0]
    expect(msg.to).toBe('cms-feedback@csquared.com')
    expect(msg.subject).toBe('[CMS feedback] bug — /changes/abc')
  })

  it('HTML-escapes everything the user wrote or controls', async () => {
    const { sendFeedbackEmail } = await import('@/server/email')
    await sendFeedbackEmail(OPTS)
    const html = send.mock.calls[0][0].html as string
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<b>submit</b>')
    expect(html).toContain('Ama &lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('Broke on &lt;b&gt;submit&lt;/b&gt; &amp; &quot;save&quot;')
    expect(html).toContain('ghana:approver')
  })
})
