export type DbTeamMember = {
  userId: string
  name: string | null
  email: string
  role: "lead" | "member"
}

export type DbTeam = {
  id: string
  name: string
  description: string | null
  opco: { name: string; slug: string }
  members: DbTeamMember[]
}

export type OpCoMember = {
  id: string
  name: string | null
  email: string
}
