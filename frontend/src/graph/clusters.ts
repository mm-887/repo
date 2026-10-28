import type { NodeKind } from '../api/normalize'
import type { RepoGraph } from './model'
import { CLUSTER_PALETTE, EXTERNAL_CLUSTER_COLOR, KIND_COLOR, OTHER_CLUSTER_COLOR } from './palette'

export const ROOT_CLUSTER = '(root)'
export const EXTERNAL_CLUSTER = 'external'
export const OTHER_CLUSTER = 'other'
export const DEFAULT_CLUSTER_DEPTH = 2
export const MAX_CLUSTERS = CLUSTER_PALETTE.length

export type ColorMode = 'kind' | 'package'

export interface Cluster {
  key: string
  color: string
  ids: string[]
}

export interface Clusters {
  depth: number
  list: Cluster[]
  byNode: Map<string, string>
  color: Map<string, string>
}

export function clusterKey(file: string, kind: NodeKind, depth = DEFAULT_CLUSTER_DEPTH): string {
  if (kind === 'external' || !file) return EXTERNAL_CLUSTER
  const folders = file.replace(/\\/g, '/').split('/').filter(Boolean).slice(0, -1)
  return folders.length ? folders.slice(0, Math.max(1, depth)).join('/') : ROOT_CLUSTER
}

export function computeClusters(graph: RepoGraph, depth = DEFAULT_CLUSTER_DEPTH, maxClusters = MAX_CLUSTERS): Clusters {
  const members = new Map<string, string[]>()
  graph.forEachNode((id, a) => {
    const key = clusterKey(a.file, a.kind, depth)
    ;(members.get(key) ?? members.set(key, []).get(key)!).push(id)
  })

  const ranked = [...members.entries()]
    .filter(([key]) => key !== EXTERNAL_CLUSTER)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
  const fits = ranked.length <= maxClusters
  const kept = fits ? ranked : ranked.slice(0, maxClusters - 1)
  const list: Cluster[] = kept.map(([key, ids], i) => ({ key, ids, color: CLUSTER_PALETTE[i % CLUSTER_PALETTE.length] }))
  const byNode = new Map<string, string>()
  for (const c of list) for (const id of c.ids) byNode.set(id, c.key)

  if (!fits) {
    const ids = ranked.slice(maxClusters - 1).flatMap(([, ids]) => ids)
    for (const id of ids) byNode.set(id, OTHER_CLUSTER)
    list.push({ key: OTHER_CLUSTER, ids, color: OTHER_CLUSTER_COLOR })
  }
  const external = members.get(EXTERNAL_CLUSTER)
  if (external) {
    for (const id of external) byNode.set(id, EXTERNAL_CLUSTER)
    list.push({ key: EXTERNAL_CLUSTER, ids: external, color: EXTERNAL_CLUSTER_COLOR })
  }
  return { depth, list, byNode, color: new Map(list.map((c) => [c.key, c.color])) }
}

const cache = new WeakMap<RepoGraph, Map<number, Clusters>>()

export function getClusters(graph: RepoGraph, depth: number): Clusters {
  let byDepth = cache.get(graph)
  if (!byDepth) cache.set(graph, (byDepth = new Map()))
  let clusters = byDepth.get(depth)
  if (!clusters) byDepth.set(depth, (clusters = computeClusters(graph, depth)))
  return clusters
}

export function applyNodeColors(graph: RepoGraph, mode: ColorMode, clusters: Clusters) {
  graph.updateEachNodeAttributes(
    (id, a) => {
      const color = mode === 'package' ? (clusters.color.get(clusters.byNode.get(id) ?? '') ?? OTHER_CLUSTER_COLOR) : KIND_COLOR[a.kind]
      return a.color === color ? a : { ...a, color }
    },
    { attributes: ['color'] },
  )
}

export function pathMatcher(filter: string): ((file: string) => boolean) | null {
  const q = filter.trim().replace(/\\/g, '/').toLowerCase()
  return q ? (file) => file.toLowerCase().includes(q) : null
}
