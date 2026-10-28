import { useEffect, useMemo, useRef } from 'react'
import Sigma from 'sigma'
import type { GraphResponse } from '../../api'
import { getGraphModel, type GraphModel } from '../../graph/built'
import { layoutDuration, runLayout, type RunningLayout } from '../../graph/layout'
import { createStateSync, initialEdgeState, initialNodeState, styles, type RepoSigma } from '../../graph/sigmaState'
import useGraphUi from '../../store/useGraphUi'
import { GraphLegend, GraphSearch, GraphTopBar, HighlightBanner, LayoutControls } from './GraphOverlays'
import Inspector from './Inspector'

/** Creates the sigma instance, wires it to the UI store and starts the layout. Returns the teardown. */
function mountSigma(container: HTMLElement, { graph }: GraphModel): { sigma: RepoSigma; teardown: () => void } {
  const ui = useGraphUi.getState()
  ui.reset()

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

  const sync = createStateSync(sigma, graph)
  sync.applyFilters(ui.hiddenKinds, ui.hiddenEdgeKinds)
  sigma.on('clickNode', ({ node }) => useGraphUi.getState().select(node))
  sigma.on('clickStage', () => useGraphUi.getState().select(null)) // also clears any highlighted group

  // --- push filter/selection changes into sigma as per-item state (positions are untouched)
  const unsubscribeUi = useGraphUi.subscribe((s, prev) => {
    if (s.hiddenKinds !== prev.hiddenKinds || s.hiddenEdgeKinds !== prev.hiddenEdgeKinds) sync.applyFilters(s.hiddenKinds, s.hiddenEdgeKinds)
    if (s.selectedId !== prev.selectedId || s.highlightedIds !== prev.highlightedIds) sync.applyFocus(s.selectedId, s.highlightedIds)
    if (s.fitRequest && s.fitRequest !== prev.fitRequest) {
      // Frame the group: centre on its bounding box, zoom so the box fills most of the view.
      const pts = s.fitRequest.ids.filter((id) => graph.hasNode(id)).map((id) => sigma.graphToFramedGraph(graph.getNodeAttributes(id)))
      if (pts.length) {
        const xs = pts.map((p) => p.x)
        const ys = pts.map((p) => p.y)
        const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
        sigma.getCamera().animate(
          { x: (Math.max(...xs) + Math.min(...xs)) / 2, y: (Math.max(...ys) + Math.min(...ys)) / 2, ratio: Math.min(1, Math.max(0.05, span * 1.5)) },
          { duration: 500 },
        )
      }
    }
    if (s.focusRequest && s.focusRequest !== prev.focusRequest && graph.hasNode(s.focusRequest.id)) {
      const { x, y } = graph.getNodeAttributes(s.focusRequest.id)
      const camera = sigma.getCamera()
      // Camera coordinates are "framed graph" coordinates, not raw layout coordinates.
      const target = sigma.graphToFramedGraph({ x, y })
      camera.animate({ ...target, ratio: Math.min(camera.ratio, 0.2) }, { duration: 450 })
    }
    if (s.resetViewNonce !== prev.resetViewNonce) sigma.getCamera().reset({ duration: 400 })
    if (s.relayoutNonce !== prev.relayoutNonce) startLayout()
  })

  // --- force layout in a worker; the graph stays interactive while it settles
  let layout: RunningLayout | null = null
  function startLayout() {
    layout?.kill()
    useGraphUi.getState().setLayoutRunning(true)
    layout = runLayout(graph, layoutDuration(graph.order), () => {
      useGraphUi.getState().setLayoutRunning(false)
      sigma.getCamera().reset({ duration: 500 })
    })
  }
  if (graph.order > 1) startLayout()

  return {
    sigma,
    teardown: () => {
      unsubscribeUi()
      layout?.kill()
      sigma.kill()
      useGraphUi.getState().reset()
    },
  }
}

const SigmaGraph = ({ data, owner, repo }: { data: GraphResponse; owner: string; repo: string }) => {
  const built = useMemo(() => getGraphModel(data, owner, repo), [data, owner, repo])
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
      else mounted = mountSigma(container, built)
    }
    const resizeObserver = new ResizeObserver(sync)
    resizeObserver.observe(container)
    sync()

    return () => {
      resizeObserver.disconnect()
      mounted?.teardown()
    }
  }, [built])

  return (
    <div className="relative w-full h-full bg-zinc-950">
      <div ref={containerRef} className="absolute inset-0" data-testid="sigma-container" />
      <GraphTopBar>
        <GraphSearch model={built} owner={owner} repo={repo} />
        <LayoutControls />
      </GraphTopBar>
      <HighlightBanner />
      <GraphLegend stats={built.stats} />
      <Inspector graph={built.graph} owner={owner} repo={repo} />
    </div>
  )
}

export default SigmaGraph
