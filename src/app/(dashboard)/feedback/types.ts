export type FeedbackRow = {
  id: string
  category: "bug" | "confusing" | "missing" | "praise"
  severity: "blocker" | "major" | "minor" | null
  body: string
  route: string
  changeId: string | null
  roles: string
  opcoSlugs: string // ", "-joined snapshot
  authorName: string
  createdAt: string // ISO
  triagedAt: string | null // ISO
  outcome: string | null
  triageNote: string | null
}
