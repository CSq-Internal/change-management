export const QUORUM_SIZE = 2

export type QuorumApproval = { isCab: boolean; decision: string; approverId: string }

/** Distinct approvers so far, and whether any approval came from the routed CAB. */
export function quorumProgress(approvals: QuorumApproval[]): { approvers: number; hasCabVote: boolean } {
  const approves = approvals.filter((a) => a.decision === "approve")
  return {
    approvers: new Set(approves.map((a) => a.approverId)).size,
    hasCabVote: approves.some((a) => a.isCab),
  }
}

/**
 * High-risk quorum: two distinct approvers, at least one of them from the routed CAB.
 * Requester-nominated approvers count toward the two, but cannot form quorum alone.
 */
export function checkCabQuorum(approvals: QuorumApproval[]): boolean {
  const { approvers, hasCabVote } = quorumProgress(approvals)
  return approvers >= QUORUM_SIZE && hasCabVote
}
