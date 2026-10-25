import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { OpenPhase } from '../api'

export interface RecentRepo {
  owner: string
  repo: string
  openedAt: number
}

/** A clone/open in flight. Lives in the store so the header form and the canvas can both react to it. */
export interface OpenStatus {
  phase: OpenPhase
  /** "owner/repo", or the raw input when it could not be parsed. */
  target: string
  startedAt: number
}

interface StoreState {
  recentRepos: RecentRepo[]
  openStatus: OpenStatus | null
  openError: string | null
  addRecentRepo: (owner: string, repo: string) => void
  removeRecentRepo: (owner: string, repo: string) => void
  setOpenStatus: (status: OpenStatus | null) => void
  setOpenPhase: (phase: OpenPhase) => void
  setOpenError: (error: string | null) => void
}

const MAX_RECENT = 8
const same = (a: RecentRepo, owner: string, repo: string) =>
  a.owner.toLowerCase() === owner.toLowerCase() && a.repo.toLowerCase() === repo.toLowerCase()

const useStore = create<StoreState>()(
  persist(
    (set) => ({
      recentRepos: [],
      openStatus: null,
      openError: null,
      addRecentRepo: (owner, repo) =>
        set((s) => ({
          recentRepos: [
            { owner, repo, openedAt: Date.now() },
            ...s.recentRepos.filter((r) => !same(r, owner, repo)),
          ].slice(0, MAX_RECENT),
        })),
      removeRecentRepo: (owner, repo) =>
        set((s) => ({ recentRepos: s.recentRepos.filter((r) => !same(r, owner, repo)) })),
      setOpenStatus: (openStatus) => set({ openStatus }),
      setOpenPhase: (phase) => set((s) => (s.openStatus ? { openStatus: { ...s.openStatus, phase } } : s)),
      setOpenError: (openError) => set({ openError }),
    }),
    {
      name: 'repograph.recent-repos',
      // Only the recent list survives a reload; in-flight state must not.
      partialize: (s) => ({ recentRepos: s.recentRepos }),
    },
  ),
)

export default useStore
