export type AuditRow = {
  id: string
  actorEmail: string
  action: string
  summary: string
  opcoSlug: string | null
  at: string // ISO
}
