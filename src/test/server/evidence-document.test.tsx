// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { renderToBuffer } from '@react-pdf/renderer'
import { EvidenceDocument, type EvidenceChange } from '@/server/pdf/evidence-document'

const user = { id: 'u1', name: 'Kwame Asante', email: 'k@csquared.com' }
const at = new Date('2026-10-22T11:44:51Z')

const change = {
  id: 'c1', reference: 10, title: 'Migration du réseau → SAS-K', description: 'Débit ≥ 10 Gb/s',
  status: 'implemented', riskLevel: 'emergency', category: 'infrastructure', infrastructureType: 'Fiber',
  isEmergency: true, expedited: false, contactEmail: 'k@csquared.com',
  changeReason: null, impactScope: null, implementationPlan: null, testingPlan: null, backoutPlan: null,
  createdAt: at, plannedStart: null, plannedEnd: null, slaDeadline: null, implementedAt: at,
  opco: { name: 'CSquared Uganda' }, requester: user, implementedBy: user,
  attachments: [{ id: 'a1', filename: 'plan.pdf', kind: 'implementation_plan', uploadedBy: user, uploadedAt: at }],
  approvals: [{ id: 'p1', approver: user, decision: 'approve', isCab: true, decidedAt: at, comment: 'OK' }],
  auditTrail: [{ id: 'l1', at, actor: user, action: 'status_changed', fromStatus: 'approved', toStatus: 'implemented', note: null }],
  pir: null,
} as unknown as EvidenceChange

describe('EvidenceDocument', () => {
  it('embeds a Unicode font instead of the built-in WinAnsi Helvetica', async () => {
    const pdf = (await renderToBuffer(<EvidenceDocument change={change} generatedAt={at} />)).toString('latin1')
    // Built-in Helvetica is not embedded and garbles "→", "≥" and non-Latin text.
    expect(pdf).not.toMatch(/\/BaseFont\s*\/Helvetica/)
    expect(pdf).toContain('/FontFile2')
  })
})
