export type DbUser = {
  id: string
  name: string | null
  email: string
  isActive: boolean
  accessStatus: "pending" | "approved" | "denied" | null
  opcoAssignments: {
    role: string
    isActive: boolean
    opco: { name: string; slug: string }
  }[]
}
