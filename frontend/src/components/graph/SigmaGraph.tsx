import { useEffect, useMemo, useRef, useState } from 'react'
import Sigma from 'sigma'
import type { GraphResponse } from '../../api'
import { getGraphModel } from '../../graph/built'
import { applyNodeColors, getClusters, pathMatcher } from '../../graph/clusters'
import { getFilesGraph } from '../../graph/filesView'
import { layoutDuration, runLayout, type RunningLayout } from '../../graph/layout'
import type { BuiltGraph, NodeAttrs, RepoGraph } from '../../graph/model'
import { createStateSync, initialEdgeState, initialNodeState, styles, type RepoSigma } from '../../graph/sigmaState'
import useGraphUi, { type ViewMode } from '../../store/useGraphUi'
import { GraphLegend, GraphSearch, GraphTopBar, HighlightBanner, LayoutControls, ViewControls } from './GraphOverlays'
import FileTree from './FileTree'
import Inspector from './Inspector'

type UiState = ReturnType<typeof useGraphUi.getState>

/** Creates the sigma instance, wires it to the UI store and starts the layout. Returns the teardown. */
function mountSigma(container: HTMLElement, graph: RepoGraph, view: ViewMode): { sigma: RepoSigma; teardown: () => void } {
  const ui = useGraphUi.getState()
  const isActive = (s: UiState = useGraphUi.getState()) => s.viewMode === view

  const sigma: RepoSigma = new Sigma(graph, container, {
    styles,
    customNodeState: initialNodeState,
    customEdgeState: initialEdgeState,
    settings: {
      // Edges are the expensive part while moving; skip them for big graphs only.
      hideEdgesOnMove: graph.size > 4000,
      labelDensity: 0.5,
      labelGridCellSize: 130,
      labelRenderedSizeThreshold: 5,
      minCameraRatio: 0.01,
      maxCameraRatio: 30,
      // The graph lives in a tab on small screens; layout ticks and camera animations keep rendering while its
      // container is display:none, and sigma would otherwise throw "Container has no width".
      allowInvalidContainer: true,
    },
  })

  const filtering = (s: UiState) => s.hiddenClusters.size > 0 || s.pathFilter.trim() !== ''
  const extraHidden = (s: UiState) => {
    if (!filtering(s)) return undefined
    const match = pathMatcher(s.pathFilter)
    const clusters = getClusters(graph, s.clusterDepth)
    const keep = new Set(s.highlightedIds ?? [])
    if (s.selectedId) keep.add(s.selectedId)
    return (id: string, a: NodeAttrs) => !keep.has(id) && ((match !== null && !match(a.file)) || s.hiddenClusters.has(clusters.byNode.get(id) ?? ''))
  }

  const sync = createStateSync(sigma, graph)
  const applyAll = (s: UiState) => {
    applyNodeColors(graph, s.colorMode, getClusters(graph, s.clusterDepth))
    sync.applyFilters(s.hiddenKinds, s.hiddenEdgeKinds, extraHidden(s))
    sync.applyFocus(s.selectedId, s.highlightedIds)
  }
  applyAll(ui)
  sigma.on('clickNode', ({ node }) => useGraphUi.getState().select(node))
  sigma.on('clickStage', () => useGraphUi.getState().select(null)) // also clears any highlighted group

  // Frame the group: centre on its bounding box, zoom so the box fills most of the view.
  const frame = (ids: readonly string[]) => {
    const pts = ids.filter((id) => graph.hasNode(id)).map((id) => sigma.graphToFramedGraph(graph.getNodeAttributes(id)))
    if (!pts.length) return false
    const xs = pts.map((p) => p.x)
    const ys = pts.map((p) => p.y)
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
    sigma.getCamera().animate(
      { x: (Math.max(...xs) + Math.min(...xs)) / 2, y: (Math.max(...ys) + Math.min(...ys)) / 2, ratio: Math.min(1, Math.max(0.05, span * 1.5)) },
      { duration: 500 },
    )
    return true
  }
  const flyTo = (id: string) => {
    if (!graph.hasNode(id)) return false
    const { x, y } = graph.getNodeAttributes(id)
    const camera = sigma.getCamera()
    // Camera coordinates are "framed graph" coordinates, not raw layout coordinates.
    const target = sigma.graphToFramedGraph({ x, y })
    camera.animate({ ...target, ratio: Math.min(camera.ratio, 0.2) }, { duration: 450 })
    return true
  }

  // --- push filter/selection changes into sigma as per-item state (positions are untouched)
  let stale = false
  const unsubscribeUi = useGraphUi.subscribe((s, prev) => {
    if (!isActive(s)) {
      if (isActive(prev)) layout?.stop()
      stale = true
      return
    }
    if (!isActive(prev)) {
      if (stale) applyAll(s)
      stale = false
      s.setLayoutRunning(layoutRunning)
      return
    }
    if (s.colorMode !== prev.colorMode || s.clusterDepth !== prev.clusterDepth) applyNodeColors(graph, s.colorMode, getClusters(graph, s.clusterDepth))
    const focusChanged = s.selectedId !== prev.selectedId || s.highlightedIds !== prev.highlightedIds
    if (
      s.hiddenKinds !== prev.hiddenKinds ||
      s.hiddenEdgeKinds !== prev.hiddenEdgeKinds ||
      s.hiddenClusters !== prev.hiddenClusters ||
      s.pathFilter !== prev.pathFilter ||
      s.clusterDepth !== prev.clusterDepth ||
      (focusChanged && (filtering(s) || filtering(prev)))
    )
      sync.applyFilters(s.hiddenKinds, s.hiddenEdgeKinds, extraHidden(s))
    if (focusChanged) sync.applyFocus(s.selectedId, s.highlightedIds)
    if (s.fitRequest && s.fitRequest !== prev.fitRequest) frame(s.fitRequest.ids)
    if (s.focusRequest && s.focusRequest !== prev.focusRequest) flyTo(s.focusRequest.id)
    if (s.resetViewNonce !== prev.resetViewNonce) sigma.getCamera().reset({ duration: 400 })
    if (s.relayoutNonce !== prev.relayoutNonce) startLayout()
  })

  // --- force layout in a worker; the graph stays interactive while it settles
  let layout: RunningLayout | null = null
  let layoutRunning = false
  function startLayout() {
    layout?.kill()
    layoutRunning = true
    useGraphUi.getState().setLayoutRunning(true)
    layout = runLayout(graph, layoutDuration(graph.order), () => {
      layoutRunning = false
      if (!isActive()) return
      useGraphUi.getState().setLayoutRunning(false)
      const { selectedId, highlightedIds } = useGraphUi.getState()
      if (!(selectedId && flyTo(selectedId)) && !(highlightedIds && frame(highlightedIds))) sigma.getCamera().reset({ duration: 500 })
    })
  }
  if (graph.order > 1) startLayout()

  return {
    sigma,
    teardown: () => {
      unsubscribeUi()
      layout?.kill()
      sigma.kill()
      if (isActive()) useGraphUi.getState().setLayoutRunning(false)
    },
  }
}

const SigmaCanvas = ({ graph, view, active }: { graph: RepoGraph; view: ViewMode; active: boolean }) => {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // Below the `lg` breakpoint the graph lives in a tab, so its container can be display:none (zero size), and
    // sigma throws when it is created or resized at zero size. Only act while the container has real dimensions.
    let mounted: ReturnType<typeof mountSigma> | null = null
    const visible = () => container.clientWidth > 0 && container.clientHeight > 0
    const sync = () => {
      if (!visible()) return
      if (mounted) mounted.sigma.resize()
      else mounted = mountSigma(container, graph, view)
    }
    const resizeObserver = new ResizeObserver(sync)
    resizeObserver.observe(container)
    sync()

    return () => {
      resizeObserver.disconnect()
      mounted?.teardown()
    }
  }, [graph, view])

  return <div ref={containerRef} className={`absolute inset-0 ${active ? '' : 'hidden'}`} data-testid={active ? 'sigma-container' : undefined} />
}

const ResetUi = ({ graph }: { graph: RepoGraph }) => {
  useEffect(() => {
    useGraphUi.getState().reset()
    return () => useGraphUi.getState().reset()
  }, [graph])
  return null
}

const SigmaGraph = ({ data, owner, repo }: { data: GraphResponse; owner: string; repo: string }) => {
  const built = useMemo(() => getGraphModel(data, owner, repo), [data, owner, repo])
  const viewMode = useGraphUi((s) => s.viewMode)
  const [filesOpened, setFilesOpened] = useState(false)
  if (viewMode === 'files' && !filesOpened) setFilesOpened(true)
  const files = filesOpened ? getFilesGraph(built.graph) : null
  const active: BuiltGraph = viewMode === 'files' && files ? files : built

  return (
    <div className="relative w-full h-full bg-zinc-950">
      <ResetUi graph={built.graph} />
      <SigmaCanvas graph={built.graph} view="symbols" active={viewMode === 'symbols'} />
      {files && <SigmaCanvas graph={files.graph} view="files" active={viewMode === 'files'} />}
      <GraphTopBar>
        <GraphSearch model={built} owner={owner} repo={repo} />
        <FileTree graph={built.graph} owner={owner} repo={repo} />
        <ViewControls graph={built.graph} />
        <LayoutControls />
      </GraphTopBar>
      <HighlightBanner />
      <GraphLegend stats={active.stats} graph={active.graph} />
      <Inspector graph={active.graph} owner={owner} repo={repo} files={viewMode === 'files'} />
    </div>
  )
}

export default SigmaGraph
