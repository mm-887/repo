import Graph from 'graphology'
import type { NodeKind } from '../api/normalize'
import type { BuiltGraph, EdgeAttrs, NeighborGroup, RepoGraph } from './model'
import { EDGE_COLOR, KIND_COLOR, type EdgeKind } from './palette'

const EDGE_PRIORITY: EdgeKind[] = ['calls', 'inherits', 'imports', 'defines', 'other']

const basename = (p: string) => p.split(/[\\/]/).pop() || p

export interface FilesGraph extends BuiltGraph {
  fileOf: (id: string) => string | null
}

export function fileNodeOf(graph: RepoGraph): (id: string) => string | null {
  const moduleByFile = new Map<string, string>()
  graph.forEachNode((id, a) => {
    if (a.kind === 'module' && a.file && !moduleByFile.has(a.file)) moduleByFile.set(a.file, id)
  })
  return (id) => {
    if (!graph.hasNode(id)) return null
    const a = graph.getNodeAttributes(id)
    if (a.kind === 'module' || a.kind === 'external') return id
    return moduleByFile.get(a.file) ?? null
  }
}

export function buildFilesGraph(full: RepoGraph): FilesGraph {
  const fileOf = fileNodeOf(full)
  const graph: RepoGraph = new Graph({ type: 'directed', multi: false, allowSelfLoops: false })
  const members = new Map<string, { n: number; x: number; y: number }>()

  full.forEachNode((id, a) => {
    const target = fileOf(id)
    if (!target) return
    const m = members.get(target) ?? { n: 0, x: 0, y: 0 }
    m.n++
    m.x += Number.isFinite(a.x) ? a.x : 0
    m.y += Number.isFinite(a.y) ? a.y : 0
    members.set(target, m)
  })

  const byKind: Record<NodeKind, number> = { function: 0, class: 0, module: 0, external: 0, unknown: 0 }
  for (const [id, m] of members) {
    const a = full.getNodeAttributes(id)
    byKind[a.kind]++
    const size = Math.min(9, (a.kind === 'external' ? 1.6 : 2.4) + Math.sqrt(m.n) * 0.45)
    graph.addNode(id, {
      ...a,
      label: a.kind === 'module' ? basename(a.file) || a.label : a.label,
      x: m.x / m.n,
      y: m.y / m.n,
      size,
      selectedSize: size * 1.6 + 1,
      color: KIND_COLOR[a.kind],
    })
  }

  const links = new Map<string, { source: string; target: string; weight: number; kind: EdgeKind }>()
  full.forEachEdge((_e, attrs, s, t) => {
    const source = fileOf(s)
    const target = fileOf(t)
    if (!source || !target || source === target) return
    const key = `${source}\u0000${target}`
    const link = links.get(key)
    if (!link) links.set(key, { source, target, weight: 1, kind: attrs.kind })
    else {
      link.weight++
      if (EDGE_PRIORITY.indexOf(attrs.kind) < EDGE_PRIORITY.indexOf(link.kind)) link.kind = attrs.kind
    }
  })

  const byEdgeKind: Record<EdgeKind, number> = { calls: 0, imports: 0, defines: 0, inherits: 0, other: 0 }
  for (const [key, l] of links) {
    byEdgeKind[l.kind]++
    const attrs: EdgeAttrs = {
      kind: l.kind,
      weight: l.weight,
      size: Math.min(4, 0.6 + Math.log2(l.weight) * 0.5),
      opacity: l.kind === 'calls' ? 0.4 : 0.25,
      color: EDGE_COLOR[l.kind],
    }
    graph.addDirectedEdgeWithKey(key, l.source, l.target, attrs)
  }

  return {
    graph,
    fileOf,
    stats: { nodes: graph.order, edges: graph.size, mergedModules: 0, byKind, byEdgeKind },
  }
}

const cache = new WeakMap<RepoGraph, FilesGraph>()

export function getFilesGraph(full: RepoGraph): FilesGraph {
  let files = cache.get(full)
  if (!files) cache.set(full, (files = buildFilesGraph(full)))
  return files
}

export function describeFileNeighbors(graph: RepoGraph, id: string): NeighborGroup[] {
  const out: [string, number][] = []
  const inc: [string, number][] = []
  graph.forEachOutEdge(id, (_e, a, _s, target) => out.push([target, a.weight ?? 1]))
  graph.forEachInEdge(id, (_e, a, source) => inc.push([source, a.weight ?? 1]))
  const order = (list: [string, number][]) =>
    list
      .sort((a, b) => b[1] - a[1] || graph.getNodeAttribute(a[0], 'label').localeCompare(graph.getNodeAttribute(b[0], 'label')))
      .map(([n]) => n)
  const groups: NeighborGroup[] = []
  if (out.length) groups.push({ key: 'out:files', title: 'Depends on', ids: order(out) })
  if (inc.length) groups.push({ key: 'in:files', title: 'Used by', ids: order(inc) })
  return groups
}
