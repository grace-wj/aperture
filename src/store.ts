import { create } from 'zustand'

type AppState = {
  selectedId: string | null
  select: (id: string | null) => void
  playing: boolean
  setPlaying: (playing: boolean) => void
  selectByUser: (id: string) => void
}

export const useAppStore = create<AppState>((set) => ({
  selectedId: null,
  select: (id) => set({ selectedId: id }),
  playing: false,
  setPlaying: (playing) => set({ playing }),
  selectByUser: (id) => set({ selectedId: id, playing: false }),
}))
