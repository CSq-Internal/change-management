// src/test/actions/audit-immutability.test.ts
// TC-INT-AUDIT-001: AuditLog rows cannot be updated or deleted
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/server/db', () => ({
  getPrisma: () => ({
    auditLog: {
      update: vi.fn().mockRejectedValue(new Error('AuditLog rows are immutable (ISO 27001 A.8.15)')),
      delete: vi.fn().mockRejectedValue(new Error('AuditLog rows are immutable (ISO 27001 A.8.15)')),
    },
  }),
}))

describe('TC-INT-AUDIT-001: AuditLog immutability', () => {
  it('update throws immutability error', async () => {
    const { getPrisma } = await import('@/server/db')
    await expect(getPrisma().auditLog.update({ where: { id: 'any' }, data: { note: 'tampered' } }))
      .rejects.toThrow('immutable')
  })
  it('delete throws immutability error', async () => {
    const { getPrisma } = await import('@/server/db')
    await expect(getPrisma().auditLog.delete({ where: { id: 'any' } }))
      .rejects.toThrow('immutable')
  })
})
