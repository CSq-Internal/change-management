export type Role = 'requester' | 'approver' | 'auditor' | 'admin';
export type ChangeStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'implemented' | 'verified' | 'closed';
export interface ChangeRequest {
  id: string;
  title: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  requester: string;
  assignees: string[];
  riskLevel: 'low' | 'medium' | 'high';
  status: ChangeStatus;
  category: 'config' | 'infrastructure' | 'software' | 'process';
  plannedStart?: string;
  plannedEnd?: string;
  backoutPlan?: string;
  approvals: { by: string; at: string; comment?: string; decision: 'approve' | 'reject' }[];
  auditTrail: { at: string; by: string; action: string; note?: string }[];
}
