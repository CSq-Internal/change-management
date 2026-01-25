import { create } from 'zustand';
import dayjs from 'dayjs';
import { ChangeRequest } from './types';

function randomId(){return Math.random().toString(36).slice(2,10)}

interface State {
  changes: ChangeRequest[];
  add: (cr: Omit<ChangeRequest,'id'|'createdAt'|'updatedAt'|'approvals'|'auditTrail'>) => ChangeRequest;
  update: (id: string, patch: Partial<ChangeRequest>) => void;
}

export const useStore = create<State>((set) => ({
  changes: [],
  add: (cr) => {
    const now = dayjs().toISOString();
    const item: ChangeRequest = { id: randomId(), createdAt: now, updatedAt: now, approvals: [], auditTrail: [], ...cr } as ChangeRequest;
    set(s => ({ changes: [item, ...s.changes] }));
    return item;
  },
  update: (id, patch) => set(s => ({ changes: s.changes.map(c => c.id===id ? { ...c, ...patch, updatedAt: dayjs().toISOString() } : c) }))
}));
