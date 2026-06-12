export type QuorumApproval = { isCab: boolean; decision: string; approverId: string }

export function checkCabQuorum(approvals: QuorumApproval[]): boolean {
  const uniqueCabApprovers = new Set(
    approvals
      .filter((a) => a.isCab && a.decision === "approve")
      .map((a) => a.approverId)
  )
  return uniqueCabApprovers.size >= 2
}
