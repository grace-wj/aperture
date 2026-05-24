import { create } from 'zustand'

type AppState = {
  selectedId: string | null
  select: (id: string | null) => void
}

export const useAppStore = create<AppState>((set) => ({
  selectedId: null,
  select: (id) => set({ selectedId: id }),
}))
