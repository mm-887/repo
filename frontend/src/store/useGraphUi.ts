import { create } from 'zustand'
import type { NodeKind } from '../api/normalize'
import { DEFAULT_CLUSTER_DEPTH, type ColorMode } from '../graph/clusters'
import type { EdgeKind } from '../graph/palette'

export type InspectorTab = 'relations' | 'code'
export type ViewMode = 'symbols' | 'files'

/** Selection, filters and layout state shared by the sigma canvas, search, legend, inspector and chat. */
interface GraphUiState {
  selectedId: string | null
  /**
   * A group of nodes to emphasise together (an `/ask` traversal path). The first id is the seed. Mutually
   * exclusive with `selectedId`: either one thing is selected or a group is highlighted.
   */
  highlightedIds: readonly string[] | null
  /** What the highlighted group is, shown in the banner (e.g. "callers of X, 2 levels"). */
  highlightNote: string | null
  inspectorTab: InspectorTab
  hiddenKinds: ReadonlySet<NodeKind>
  hiddenEdgeKinds: ReadonlySet<EdgeKind>
  viewMode: ViewMode
  colorMode: ColorMode
  clusterDepth: number
  hiddenClusters: ReadonlySet<string>
  pathFilter: string
  layoutRunning: boolean
  /** Bumped on every focus request so re-focusing the same node still re-centres the camera. */
  focusRequest: { id: string; nonce: number } | null
  /** Asks the canvas to frame a whole group (bumped so the same group can be re-framed). */
  fitRequest: { ids: readonly string[]; nonce: number } | null
  /** Bumped to ask the canvas to re-run the force layout / reset the camera. */
  relayoutNonce: number
  resetViewNonce: number

  select: (id: string | null) => void
  /** Select a node and fly the camera to it, un-hiding its kind if a filter would conceal it. */
  focus: (id: string, kind?: NodeKind) => void
  /** Emphasise a group of nodes and frame them; `kinds` are un-hidden if a filter would conceal members. */
  highlight: (ids: readonly string[], kinds?: Iterable<NodeKind>, note?: string) => void
  clearHighlight: () => void
  /** Select a module node, fly to it and show its code. */
  openFile: (id: string) => void
  setInspectorTab: (tab: InspectorTab) => void
  toggleKind: (kind: NodeKind) => void
  toggleEdgeKind: (kind: EdgeKind) => void
  setViewMode: (mode: ViewMode, selectId?: string | null) => void
  setColorMode: (mode: ColorMode) => void
  setClusterDepth: (depth: number) => void
  toggleCluster: (key: string) => void
  setPathFilter: (filter: string) => void
  setLayoutRunning: (running: boolean) => void
  relayout: () => void
  resetView: () => void
  reset: () => void
}

// External modules are import targets only; hiding them by default keeps the call structure readable.
const initial = () => ({
  selectedId: null,
  highlightedIds: null,
  highlightNote: null,
  inspectorTab: 'relations' as InspectorTab,
  hiddenKinds: new Set<NodeKind>(['external']) as ReadonlySet<NodeKind>,
  hiddenEdgeKinds: new Set<EdgeKind>() as ReadonlySet<EdgeKind>,
  viewMode: 'symbols' as ViewMode,
  colorMode: 'kind' as ColorMode,
  clusterDepth: DEFAULT_CLUSTER_DEPTH,
  hiddenClusters: new Set<string>() as ReadonlySet<string>,
  pathFilter: '',
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

const symbolOnly = (kind: NodeKind | undefined) => kind === 'function' || kind === 'class' || kind === 'unknown'

const useGraphUi = create<GraphUiState>()((set) => ({
  ...initial(),
  select: (selectedId) => set({ selectedId, highlightedIds: null, highlightNote: null, inspectorTab: 'relations' }),
  focus: (id, kind) =>
    set((s) => {
      const hiddenKinds = kind && s.hiddenKinds.has(kind) ? toggled(s.hiddenKinds, kind) : s.hiddenKinds
      const viewMode = symbolOnly(kind) ? ('symbols' as ViewMode) : s.viewMode
      return { selectedId: id, highlightedIds: null, highlightNote: null, inspectorTab: 'relations' as InspectorTab, hiddenKinds, viewMode, focusRequest: { id, nonce: (s.focusRequest?.nonce ?? 0) + 1 } }
    }),
  highlight: (ids, kinds = [], note) =>
    set((s) => {
      const reveal = [...kinds].filter((k) => s.hiddenKinds.has(k))
      const hiddenKinds = reveal.length ? new Set([...s.hiddenKinds].filter((k) => !reveal.includes(k))) : s.hiddenKinds
      const viewMode = [...kinds].some(symbolOnly) ? ('symbols' as ViewMode) : s.viewMode
      return {
        selectedId: null,
        viewMode,
        inspectorTab: 'relations' as InspectorTab,
        highlightedIds: ids.length ? ids : null,
        highlightNote: ids.length ? (note ?? null) : null,
        hiddenKinds,
        fitRequest: ids.length ? { ids, nonce: (s.fitRequest?.nonce ?? 0) + 1 } : s.fitRequest,
      }
    }),
  clearHighlight: () => set({ highlightedIds: null, highlightNote: null }),
  openFile: (id) =>
    set((s) => {
      const hiddenKinds = s.hiddenKinds.has('module') ? toggled(s.hiddenKinds, 'module') : s.hiddenKinds
      return { selectedId: id, highlightedIds: null, highlightNote: null, inspectorTab: 'code' as InspectorTab, hiddenKinds, focusRequest: { id, nonce: (s.focusRequest?.nonce ?? 0) + 1 } }
    }),
  setInspectorTab: (inspectorTab) => set({ inspectorTab }),
  toggleKind: (kind) => set((s) => ({ hiddenKinds: toggled(s.hiddenKinds, kind) })),
  toggleEdgeKind: (kind) => set((s) => ({ hiddenEdgeKinds: toggled(s.hiddenEdgeKinds, kind) })),
  setViewMode: (viewMode, selectId) =>
    set((s) => {
      if (viewMode === s.viewMode) return {}
      if (viewMode === 'symbols') return { viewMode }
      return { viewMode, colorMode: 'package' as ColorMode, selectedId: selectId ?? null, highlightedIds: null, highlightNote: null, inspectorTab: 'relations' as InspectorTab }
    }),
  setColorMode: (colorMode) => set(colorMode === 'kind' ? { colorMode, hiddenClusters: new Set<string>(), pathFilter: '' } : { colorMode }),
  setClusterDepth: (clusterDepth) => set((s) => (clusterDepth === s.clusterDepth ? {} : { clusterDepth, hiddenClusters: new Set<string>() })),
  toggleCluster: (key) => set((s) => ({ hiddenClusters: toggled(s.hiddenClusters, key) })),
  setPathFilter: (pathFilter) => set({ pathFilter }),
  setLayoutRunning: (layoutRunning) => set({ layoutRunning }),
  relayout: () => set((s) => ({ relayoutNonce: s.relayoutNonce + 1 })),
  resetView: () => set((s) => ({ resetViewNonce: s.resetViewNonce + 1 })),
  reset: () => set(initial()),
}))

export default useGraphUi
