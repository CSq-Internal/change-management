import { t, type Language } from "@/lib/i18n"
import { QUORUM_SIZE, quorumProgress, type QuorumApproval } from "@/lib/cab-quorum"

/** "CAB quorum: n/2", plus a waiting note when two approvals lack a routed-CAB vote. */
export function QuorumProgress({
  approvals,
  language,
  labelClassName,
}: {
  approvals: QuorumApproval[]
  language: Language
  labelClassName?: string
}) {
  const { approvers, hasCabVote } = quorumProgress(approvals)
  return (
    <>
      <span className={labelClassName}>{t(language, "detail.cabQuorum")}: </span>
      {approvers}/{QUORUM_SIZE}
      {approvers >= QUORUM_SIZE && !hasCabVote && ` ${t(language, "detail.awaitingCabVote")}`}
    </>
  )
}
