export type CabMember = {
  id: string
  userId: string
  name: string | null
  email: string
  opco: { name: string; slug: string } | null // null = group CAB
}
