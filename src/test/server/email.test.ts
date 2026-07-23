import { describe, it, expect, vi, beforeEach } from 'vitest'

const send = vi.fn().mockResolvedValue({ data: { id: 'e1' }, error: null })
vi.mock('resend', () => ({ Resend: class { emails = { send } } }))

beforeEach(() => {
  vi.resetModules()
  send.mockClear()
  process.env.RESEND_API_KEY = 're_test'
})

const lastSubject = () => send.mock.calls[0][0].subject as string
const lastHtml = () => send.mock.calls[0][0].html as string

describe('email localization', () => {
  it('approval request: English subject when locale=en', async () => {
    const { sendApprovalRequestEmail } = await import('@/server/email')
    await sendApprovalRequestEmail({ to: 'a@x.com', approverName: 'Ada', changeTitle: 'Upgrade', requesterName: 'Bob', riskLevel: 'high', changeId: 'c1', locale: 'en' })
    expect(lastSubject()).toMatch(/Action Required/)
  })

  it('approval request: French subject when locale=fr', async () => {
    const { sendApprovalRequestEmail } = await import('@/server/email')
    await sendApprovalRequestEmail({ to: 'a@x.com', approverName: 'Ada', changeTitle: 'Mise à niveau', requesterName: 'Bob', riskLevel: 'high', changeId: 'c1', locale: 'fr' })
    expect(lastSubject()).toMatch(/Action requise/)
    expect(lastHtml()).toMatch(/approbation|approuver/i)
  })

  it('status change: localizes the status word in French', async () => {
    const { sendStatusChangeEmail } = await import('@/server/email')
    await sendStatusChangeEmail({ to: 'a@x.com', name: 'Ada', changeTitle: 'Upgrade', newStatus: 'approved', changeId: 'cr-1', locale: 'fr' })
    expect(lastSubject()).toMatch(/approuvé/i)
  })

  it('sla escalation: French subject when locale=fr', async () => {
    const { sendSlaEscalationEmail } = await import('@/server/email')
    await sendSlaEscalationEmail({ to: 'a@x.com', changeTitle: 'Upgrade', changeId: 'c1', level: 2, riskLevel: 'high', locale: 'fr' })
    expect(lastSubject()).toMatch(/SLA/)
    expect(lastHtml()).toMatch(/niveau groupe|escaladé/i)
  })

  it('emergency alert: French subject when locale=fr', async () => {
    const { sendEmergencyAlertEmail } = await import('@/server/email')
    await sendEmergencyAlertEmail({ to: 'a@x.com', changeTitle: 'Upgrade', changeId: 'c1', requesterName: 'Bob', locale: 'fr' })
    expect(lastSubject()).toMatch(/urgence/i)
  })

  it('invitation: French subject when locale=fr', async () => {
    const { sendUserInvitationEmail } = await import('@/server/email')
    await sendUserInvitationEmail({ to: 'a@x.com', name: 'Ada', tempPassword: 'ChangeMe123!', existingIdentity: false, assignments: [{ opcoSlug: 'drc', role: 'requester' }], locale: 'fr' })
    expect(lastSubject()).toMatch(/invité/i)
    expect(lastHtml()).toMatch(/mot de passe temporaire/i)
  })
})
