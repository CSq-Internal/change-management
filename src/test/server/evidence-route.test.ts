import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockAuth = vi.fn()
vi.mock('@/auth', () => ({ auth: () => mockAuth() }))

const mockDb = { changeRequest: { findUnique: vi.fn() } }
vi.mock('@/server/db', () => ({ getPrisma: () => mockDb }))

vi.mock('@react-pdf/renderer', () => ({
  renderToBuffer: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.7 fake')),
  Document: () => null, Page: () => null, Text: () => null, View: () => null,
  StyleSheet: { create: (s: unknown) => s },
}))
vi.mock('@/server/pdf/evidence-document', () => ({ EvidenceDocument: () => null }))

import { GET } from '@/app/api/changes/[id]/evidence.pdf/route'

const ctx = { params: Promise.resolve({ id: 'c1' }) }
const ghanaChange = { id: 'c1', reference: 42, opco: { slug: 'ghana' } }

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.changeRequest.findUnique.mockResolvedValue(ghanaChange)
})

describe('GET /api/changes/[id]/evidence.pdf', () => {
  it('401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET({} as never, ctx)
    expect(res.status).toBe(401)
  })

  it('404 when the change does not exist', async () => {
    mockAuth.mockResolvedValue({ user: { realmRoles: [], organizations: [] } })
    mockDb.changeRequest.findUnique.mockResolvedValue(null)
    const res = await GET({} as never, ctx)
    expect(res.status).toBe(404)
  })

  it('403 when an OpCo user requests a change outside their OpCos', async () => {
    mockAuth.mockResolvedValue({ user: { realmRoles: [], organizations: [{ alias: 'kenya', roles: ['approver'] }] } })
    const res = await GET({} as never, ctx)
    expect(res.status).toBe(403)
  })

  it('streams a PDF for an OpCo member', async () => {
    mockAuth.mockResolvedValue({ user: { realmRoles: [], organizations: [{ alias: 'ghana', roles: ['approver'] }] } })
    const res = await GET({} as never, ctx)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    expect(res.headers.get('Content-Disposition')).toContain('evidence-42.pdf')
  })

  it('streams a PDF for a group-level user on any OpCo', async () => {
    mockAuth.mockResolvedValue({ user: { realmRoles: ['group_auditor'], organizations: [] } })
    const res = await GET({} as never, ctx)
    expect(res.status).toBe(200)
  })
})
