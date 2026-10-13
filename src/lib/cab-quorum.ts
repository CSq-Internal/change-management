export type QuorumApproval = { isCab: boolean; decision: string; approverId: string }

/**
 * High-risk quorum: two distinct approvers, at least one of them from the routed CAB.
 * Requester-nominated approvers count toward the two, but cannot form quorum alone.
 */
export function checkCabQuorum(approvals: QuorumApproval[]): boolean {
  const approves = approvals.filter((a) => a.decision === "approve")
  const distinctApprovers = new Set(approves.map((a) => a.approverId))
  return distinctApprovers.size >= 2 && approves.some((a) => a.isCab)
}
