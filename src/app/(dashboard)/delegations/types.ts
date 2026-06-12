export type DbDelegation = {
  id: string
  opco: { name: string; slug: string }
  fromUser: { id: string; name: string | null; email: string }
  toUser: { id: string; name: string | null; email: string }
  validUntil: string // ISO string
}
