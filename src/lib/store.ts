import { create } from 'zustand';
import dayjs from 'dayjs';
import { AppUser, ChangeRequest, Role, Team } from './types';

function randomId(){return Math.random().toString(36).slice(2,10)}

interface State {
  changes: ChangeRequest[];
  currentUser: { id: string; name: string };
  role: Role;
  setRole: (role: Role) => void;
  users: AppUser[];
  teams: Team[];
  addUser: (user: Omit<AppUser, 'id' | 'createdAt'>) => AppUser;
  addTeam: (team: Omit<Team, 'id' | 'createdAt'>) => Team;
  add: (cr: Omit<ChangeRequest,'id'|'createdAt'|'updatedAt'|'approvals'|'auditTrail'>) => ChangeRequest;
  update: (id: string, patch: Partial<ChangeRequest>) => void;
}

export const useStore = create<State>((set) => ({
  changes: [],
  currentUser: { id: 'you', name: 'You' },
  role: 'requester',
  setRole: (role) => set({ role }),
  users: [],
  teams: [],
  addUser: (user) => {
    const now = dayjs().toISOString();
    const item: AppUser = { id: randomId(), createdAt: now, ...user };
    set((s) => ({ users: [item, ...s.users] }));
    return item;
  },
  addTeam: (team) => {
    const now = dayjs().toISOString();
    const item: Team = { id: randomId(), createdAt: now, ...team };
    set((s) => ({ teams: [item, ...s.teams] }));
    return item;
  },
  add: (cr) => {
    const now = dayjs().toISOString();
    const item: ChangeRequest = { id: randomId(), createdAt: now, updatedAt: now, approvals: [], auditTrail: [], ...cr } as ChangeRequest;
    set(s => ({ changes: [item, ...s.changes] }));
    return item;
  },
  update: (id, patch) => set(s => ({ changes: s.changes.map(c => c.id===id ? { ...c, ...patch, updatedAt: dayjs().toISOString() } : c) }))
}));
