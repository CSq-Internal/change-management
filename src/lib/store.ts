// src/lib/store.ts
import { create } from 'zustand'
import type { ThemeMode } from './theme'

type Language = 'en' | 'fr'

interface UIState {
  language: Language
  fontScale: number
  theme: ThemeMode
  setLanguage: (lang: Language) => void
  setFontScale: (scale: number) => void
  setTheme: (theme: ThemeMode) => void
}

export const useStore = create<UIState>((set) => ({
  language: (typeof window !== 'undefined'
    ? (localStorage.getItem('csq-language') as Language) : null) ?? 'en',
  fontScale: typeof window !== 'undefined'
    ? Number(localStorage.getItem('csq-font-scale') ?? 1) : 1,
  theme: (typeof window !== 'undefined'
    ? (localStorage.getItem('csq-theme') as ThemeMode) : null) ?? 'system',
  setLanguage: (language) => {
    set({ language })
    if (typeof window !== 'undefined') localStorage.setItem('csq-language', language)
  },
  setFontScale: (fontScale) => {
    set({ fontScale })
    if (typeof window !== 'undefined') localStorage.setItem('csq-font-scale', String(fontScale))
  },
  setTheme: (theme) => {
    set({ theme })
    if (typeof window !== 'undefined') localStorage.setItem('csq-theme', theme)
  },
}))
