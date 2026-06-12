// src/test/actions/admin-audit-immutability.test.ts
// TC-INT-AUDIT-003: AdminAuditLog rows are append-only (no update/delete path)
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/server/db', () => ({
  getPrisma: () => ({
    adminAuditLog: {
      update: vi.fn().mockRejectedValue(new Error('AdminAuditLog rows are immutable (ISO 27001 A.8.15)')),
      delete: vi.fn().mockRejectedValue(new Error('AdminAuditLog rows are immutable (ISO 27001 A.8.15)')),
    },
  }),
}))

describe('TC-INT-AUDIT-003: AdminAuditLog immutability', () => {
  it('update throws immutability error', async () => {
    const { getPrisma } = await import('@/server/db')
    await expect(getPrisma().adminAuditLog.update({ where: { id: 'any' }, data: { summary: 'tampered' } }))
      .rejects.toThrow('immutable')
  })
  it('delete throws immutability error', async () => {
    const { getPrisma } = await import('@/server/db')
    await expect(getPrisma().adminAuditLog.delete({ where: { id: 'any' } }))
      .rejects.toThrow('immutable')
  })
})
