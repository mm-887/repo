import { create } from 'zustand'
import type { NodeKind } from '../api/normalize'
import type { EdgeKind } from '../graph/palette'

interface GraphUiState {
  selectedId: string | null
  highlightedIds: readonly string[] | null
  highlightNote: string | null
  hiddenKinds: ReadonlySet<NodeKind>
  hiddenEdgeKinds: ReadonlySet<EdgeKind>
  layoutRunning: boolean
  focusRequest: { id: string; nonce: number } | null
  fitRequest: { ids: readonly string[]; nonce: number } | null
  relayoutNonce: number
  resetViewNonce: number

  select: (id: string | null) => void
  focus: (id: string, kind?: NodeKind) => void
  highlight: (ids: readonly string[], kinds?: Iterable<NodeKind>, note?: string) => void
  clearHighlight: () => void
  toggleKind: (kind: NodeKind) => void
  toggleEdgeKind: (kind: EdgeKind) => void
  setLayoutRunning: (running: boolean) => void
  relayout: () => void
  resetView: () => void
  reset: () => void
}

const initial = () => ({
  selectedId: null,
  highlightedIds: null,
  highlightNote: null,
  hiddenKinds: new Set<NodeKind>(['external']) as ReadonlySet<NodeKind>,
  hiddenEdgeKinds: new Set<EdgeKind>() as ReadonlySet<EdgeKind>,
  layoutRunning: false,
  focusRequest: null,
  fitRequest: null,
  relayoutNonce: 0,
  resetViewNonce: 0,
})

const toggled = <T>(set: ReadonlySet<T>, value: T): ReadonlySet<T> => {
  const next = new Set(set)
  if (!next.delete(value)) next.add(value)
  return next
}

const useGraphUi = create<GraphUiState>()((set) => ({
  ...initial(),
  select: (selectedId) => set({ selectedId, highlightedIds: null, highlightNote: null }),
  focus: (id, kind) =>
    set((s) => {
      const hiddenKinds = kind && s.hiddenKinds.has(kind) ? toggled(s.hiddenKinds, kind) : s.hiddenKinds
      return { selectedId: id, highlightedIds: null, highlightNote: null, hiddenKinds, focusRequest: { id, nonce: (s.focusRequest?.nonce ?? 0) + 1 } }
    }),
  highlight: (ids, kinds = [], note) =>
    set((s) => {
      const reveal = [...kinds].filter((k) => s.hiddenKinds.has(k))
      const hiddenKinds = reveal.length ? new Set([...s.hiddenKinds].filter((k) => !reveal.includes(k))) : s.hiddenKinds
      return {
        selectedId: null,
        highlightedIds: ids.length ? ids : null,
        highlightNote: ids.length ? (note ?? null) : null,
        hiddenKinds,
        fitRequest: ids.length ? { ids, nonce: (s.fitRequest?.nonce ?? 0) + 1 } : s.fitRequest,
      }
    }),
  clearHighlight: () => set({ highlightedIds: null, highlightNote: null }),
  toggleKind: (kind) => set((s) => ({ hiddenKinds: toggled(s.hiddenKinds, kind) })),
  toggleEdgeKind: (kind) => set((s) => ({ hiddenEdgeKinds: toggled(s.hiddenEdgeKinds, kind) })),
  setLayoutRunning: (layoutRunning) => set({ layoutRunning }),
  relayout: () => set((s) => ({ relayoutNonce: s.relayoutNonce + 1 })),
  resetView: () => set((s) => ({ resetViewNonce: s.resetViewNonce + 1 })),
  reset: () => set(initial()),
}))

export default useGraphUi
