export type Role = 'requester' | 'approver' | 'auditor' | 'admin';
export type ChangeStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'implemented' | 'verified' | 'closed';
export type InfrastructureType =
  | 'Equiano Optics'
  | 'Backbone Transport Network'
  | 'Metro Transport Network'
  | 'Wifi'
  | 'Internal IT Infrastructure'
  | 'Equiano IP'
  | 'Backbone IP Network'
  | 'Power';
export type Country = 'Uganda' | 'DRC' | 'Ghana' | 'Togo' | 'Liberia' | 'Mauritius';
export type Permission = 'admin' | 'read' | 'write' | 'approve' | 'audit';

export interface AppUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  permissions: Permission[];
  country: Country;
  teamIds: string[];
  password: string;
  createdAt: string;
}

export interface Team {
  id: string;
  name: string;
  description?: string;
  planSummary?: string;
  attachments?: {
    id: string;
    name: string;
    size: number;
    type: string;
  }[];
  createdAt: string;
}
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
  details?: {
    email?: string;
    country?: Country;
    infrastructureType?: InfrastructureType;
    changeReason?: string;
    impactScope?: string;
    implementationPlan?: string;
    testingPlan?: string;
    changeWindow?: string;
  };
  approvals: { by: string; at: string; comment?: string; decision: 'approve' | 'reject' }[];
  auditTrail: { at: string; by: string; action: string; note?: string }[];
}
