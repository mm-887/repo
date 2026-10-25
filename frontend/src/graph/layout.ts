import forceAtlas2 from 'graphology-layout-forceatlas2'
import FA2Layout from 'graphology-layout-forceatlas2/worker'
import type { RepoGraph } from './model'

export interface RunningLayout {
  stop: () => void
  kill: () => void
}

export const layoutDuration = (order: number) => Math.min(10_000, Math.max(2_500, 1_500 + order * 1.5))

export function runLayout(graph: RepoGraph, durationMs: number, onDone: () => void): RunningLayout {
  const layout = new FA2Layout(graph, {
    settings: {
      ...forceAtlas2.inferSettings(graph),
      gravity: 0.6,
      scalingRatio: 24,
      slowDown: 2,
      barnesHutOptimize: graph.order > 500,
      barnesHutTheta: 0.8,
    },
  })

  let finished = false
  const finish = () => {
    if (finished) return
    finished = true
    clearTimeout(timer)
    if (layout.isRunning()) layout.stop()
    onDone()
  }
  const timer = setTimeout(finish, durationMs)
  layout.start()

  return {
    stop: finish,
    kill: () => {
      finished = true
      clearTimeout(timer)
      layout.kill()
    },
  }
}
