import { create } from 'zustand';
import dayjs from 'dayjs';
import { AppUser, ChangeRequest, Role, Team } from './types';

function randomId(){return Math.random().toString(36).slice(2,10)}

interface State {
  changes: ChangeRequest[];
  currentUser: AppUser | null;
  role: Role;
  setRole: (role: Role) => void;
  theme: 'system' | 'light' | 'dark';
  language: 'en' | 'fr' | 'sw';
  fontScale: number;
  setTheme: (theme: 'system' | 'light' | 'dark') => void;
  setLanguage: (language: 'en' | 'fr' | 'sw') => void;
  setFontScale: (fontScale: number) => void;
  users: AppUser[];
  teams: Team[];
  addUser: (user: Omit<AppUser, 'id' | 'createdAt'>) => AppUser;
  addTeam: (team: Omit<Team, 'id' | 'createdAt'>) => Team;
  login: (email: string, password: string) => boolean;
  loginWithGoogle: () => AppUser;
  logout: () => void;
  updatePassword: (userId: string, password: string) => void;
  add: (cr: Omit<ChangeRequest,'id'|'createdAt'|'updatedAt'|'approvals'|'auditTrail'>) => ChangeRequest;
  update: (id: string, patch: Partial<ChangeRequest>) => void;
}

export const useStore = create<State>((set) => ({
  changes: [],
  currentUser: null,
  role: 'requester',
  setRole: (role) =>
    set((state) => ({
      role,
      currentUser: state.currentUser ? { ...state.currentUser, role } : state.currentUser,
    })),
  theme: 'system',
  language: 'en',
  fontScale: 1,
  setTheme: (theme) => set({ theme }),
  setLanguage: (language) => set({ language }),
  setFontScale: (fontScale) => set({ fontScale }),
  users: [
    {
      id: 'admin',
      name: 'Admin',
      email: 'Admin',
      role: 'admin',
      permissions: ['admin', 'read', 'write', 'approve', 'audit'],
      country: 'Ghana',
      teamIds: [],
      password: 'Admin',
      createdAt: dayjs().toISOString(),
    },
  ],
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
  login: (email, password) => {
    let success = false;
    set((state) => {
      const normalized = email.toLowerCase();
      const user = state.users.find(
        (u) => u.email.toLowerCase() === normalized || u.name.toLowerCase() === normalized
      );
      if (!user || user.password !== password) {
        success = false;
        return state;
      }
      success = true;
      return { ...state, currentUser: user, role: user.role };
    });
    return success;
  },
  loginWithGoogle: () => {
    const now = dayjs().toISOString();
    let loggedIn: AppUser | null = null;
    set((state) => {
      const existing = state.users.find((u) => u.email === 'google.user@csquared.com');
      const user =
        existing ??
        ({
          id: randomId(),
          name: 'Google User',
          email: 'google.user@csquared.com',
          role: 'requester',
          permissions: ['read', 'write'],
          country: 'Ghana',
          teamIds: [],
          password: 'GoogleSSO',
          createdAt: now,
        } as AppUser);
      loggedIn = user;
      return {
        ...state,
        users: existing ? state.users : [user, ...state.users],
        currentUser: user,
        role: user.role,
      };
    });
    return loggedIn ?? {
      id: 'google-fallback',
      name: 'Google User',
      email: 'google.user@csquared.com',
      role: 'requester',
      permissions: ['read', 'write'],
      country: 'Ghana',
      teamIds: [],
      password: 'GoogleSSO',
      createdAt: now,
    };
  },
  logout: () => set({ currentUser: null, role: 'requester' }),
  updatePassword: (userId, password) =>
    set((state) => ({
      users: state.users.map((user) => (user.id === userId ? { ...user, password } : user)),
      currentUser:
        state.currentUser?.id === userId ? { ...state.currentUser, password } : state.currentUser,
    })),
  add: (cr) => {
    const now = dayjs().toISOString();
    const item: ChangeRequest = { id: randomId(), createdAt: now, updatedAt: now, approvals: [], auditTrail: [], ...cr } as ChangeRequest;
    set(s => ({ changes: [item, ...s.changes] }));
    return item;
  },
  update: (id, patch) => set(s => ({ changes: s.changes.map(c => c.id===id ? { ...c, ...patch, updatedAt: dayjs().toISOString() } : c) }))
}));
