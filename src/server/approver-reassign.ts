import { getPrisma } from "@/server/db"
import { getRoutedApprovers, getNamedApprovers, isEligibleApprover } from "@/server/approval-authority"
import { notifyEvent } from "@/server/notify"

export type FootprintChange = { id: string; reference: number; title: string; infrastructureType: string; opcoId: string }

/**
 * Changes awaiting a decision the user could give, as a routed or named approver: pending
 * ones, and expedited emergencies still owed their retrospective decision. Call BEFORE
 * deactivation.
 */
export async function approverPendingFootprint(userId: string): Promise<FootprintChange[]> {
  const db = getPrisma()
  const pending = await db.changeRequest.findMany({
    where: { OR: [{ status: "pending" }, { status: "implemented", expedited: true, retroApprovedAt: null }] },
    select: { id: true, reference: true, title: true, infrastructureType: true, opcoId: true },
  })
  const out: FootprintChange[] = []
  for (const c of pending) {
    const routed = await getRoutedApprovers({ infrastructureType: c.infrastructureType, opcoId: c.opcoId })
    const named = await getNamedApprovers(c.id)
    if ([...routed, ...named].some((u) => u.id === userId)) out.push(c)
  }
  return out
}

/** After deactivation: notify remaining approvers; collect changes left with none. */
export async function notifyRemainingAndDetectOrphans(
  footprint: FootprintChange[]
): Promise<{ orphaned: { id: string; reference: number; title: string }[] }> {
  const orphaned: { id: string; reference: number; title: string }[] = []
  for (const c of footprint) {
    const routed = await getRoutedApprovers({ infrastructureType: c.infrastructureType, opcoId: c.opcoId })
    // A nominee counts only while still eligible, as canUserApproveChange checks at vote time.
    const named = []
    for (const u of await getNamedApprovers(c.id)) {
      if (await isEligibleApprover(u.id, c.opcoId, c.infrastructureType)) named.push(u)
    }
    const seen = new Set<string>()
    const remaining = [...routed, ...named].filter((u) => { if (seen.has(u.id)) return false; seen.add(u.id); return true })
    if (remaining.length === 0) {
      orphaned.push({ id: c.id, reference: c.reference, title: c.title })
      continue
    }
    await notifyEvent({
      type: "approval_requested",
      recipients: remaining.map((u) => ({ userId: u.id, email: u.email, name: u.name })),
      change: { id: c.id, title: c.title, opcoId: c.opcoId },
    }).catch(() => {})
  }
  return { orphaned }
}
