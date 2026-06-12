export type DbUser = {
  id: string
  name: string | null
  email: string
  isActive: boolean
  opcoAssignments: {
    role: string
    isActive: boolean
    opco: { name: string; slug: string }
  }[]
}
