import Graph from 'graphology'
import { nodeKind, toRepoRelativePath, type NodeKind, type SearchHit } from '../api/normalize'
import type { GraphResponse } from '../api/schemas'
import { EDGE_COLOR, KIND_COLOR, type EdgeKind } from './palette'

export type NodeAttrs = {
  label: string
  kind: NodeKind
  file: string
  line: number | null
  x: number
  y: number
  size: number
  selectedSize: number
  color: string
}

export type EdgeAttrs = {
  kind: EdgeKind
  size: number
  opacity: number
  color: string
}

export type RepoGraph = Graph<NodeAttrs, EdgeAttrs>

export interface BuiltGraph {
  graph: RepoGraph
  stats: {
    nodes: number
    edges: number
    mergedModules: number
    byKind: Record<NodeKind, number>
    byEdgeKind: Record<EdgeKind, number>
  }
}

const basename = (p: string) => p.split(/[\\/]/).pop() || p

export function parseNodeId(id: string, label: string): { file: string; row: number | null } {
  const m = /^(.*):(\d+)$/.exec(id)
  if (!m) return { file: id, row: null }
  const rest = m[1]
  const suffix = `:${label}`
  return { file: rest.endsWith(suffix) ? rest.slice(0, -suffix.length) : rest, row: Number(m[2]) }
}

const EDGE_PRIORITY: EdgeKind[] = ['calls', 'inherits', 'defines', 'imports', 'other']

const isEdgeKind = (t: string | null | undefined): t is EdgeKind => t === 'calls' || t === 'imports' || t === 'defines' || t === 'inherits'

export function inferEdgeKind(
  animated: boolean,
  src: NodeKind,
  tgt: NodeKind,
  srcLabel: string,
  tgtLabel: string,
  backendType?: string | null,
): EdgeKind {
  if (isEdgeKind(backendType)) return backendType
  if (animated) return 'calls'
  if (tgt === 'external' || src === 'external' || (src === 'module' && tgt === 'module')) return 'imports'
  if (src === 'class' && tgt === 'function' && tgtLabel.startsWith(`${srcLabel}.`)) return 'defines'
  if (src === 'class' && tgt === 'class') return 'inherits'
  if (src === 'module') return 'imports'
  return 'other'
}

const nodeSize = (kind: NodeKind, degree: number) => {
  const base = kind === 'module' ? 2.4 : kind === 'external' ? 1.6 : 1.8
  return Math.min(7, base + Math.sqrt(degree) * 0.55)
}

const edgeLook = (kind: EdgeKind) => ({ size: kind === 'calls' ? 1 : 0.6, opacity: kind === 'calls' ? 0.45 : 0.25, color: EDGE_COLOR[kind] })

export function buildGraph(data: GraphResponse, owner: string, repo: string): BuiltGraph {
  const moduleEntityFile = (n: GraphResponse['nodes'][number]) => {
    const { file, row } = parseNodeId(n.id, n.data.label)
    return row !== null && file === n.data.label ? file : null
  }

  const entityOf = new Map<string, string>()
  for (const n of data.nodes) {
    const file = moduleEntityFile(n)
    if (file !== null) entityOf.set(file, n.id)
  }
  const alias = new Map<string, string>()
  for (const n of data.nodes) {
    if (n.data.type !== 'module' || parseNodeId(n.id, n.data.label).row !== null) continue
    const entity = entityOf.get(n.id)
    if (entity) alias.set(n.id, entity)
  }
  const resolve = (id: string) => alias.get(id) ?? id

  const graph: RepoGraph = new Graph({ type: 'directed', multi: false, allowSelfLoops: false })
  const byKind: Record<NodeKind, number> = { function: 0, class: 0, module: 0, external: 0, unknown: 0 }

  for (const n of data.nodes) {
    if (alias.has(n.id)) continue
    const { file, row } = parseNodeId(n.id, n.data.label)
    const kind = moduleEntityFile(n) !== null ? 'module' : nodeKind(n.data.type, n.data.label)
    const isModule = kind === 'module'
    byKind[kind]++
    graph.addNode(n.id, {
      label: isModule ? basename(n.data.label) : n.data.label,
      kind,
      file: kind === 'external' ? '' : toRepoRelativePath(file, owner, repo),
      line: isModule || kind === 'external' || row === null ? null : row + 1,
      x: Number.isFinite(n.position.x) ? n.position.x : 0,
      y: Number.isFinite(n.position.y) ? n.position.y : 0,
      size: 4,
      selectedSize: 8,
      color: KIND_COLOR[kind],
    })
  }

  const byEdgeKind: Record<EdgeKind, number> = { calls: 0, imports: 0, defines: 0, inherits: 0, other: 0 }
  for (const e of data.edges) {
    const source = resolve(e.source)
    const target = resolve(e.target)
    if (source === target || !graph.hasNode(source) || !graph.hasNode(target)) continue
    const s = graph.getNodeAttributes(source)
    const t = graph.getNodeAttributes(target)
    const kind = inferEdgeKind(e.animated, s.kind, t.kind, s.label, t.label, e.type)

    if (graph.hasDirectedEdge(source, target)) {
      const key = graph.directedEdge(source, target)!
      const prev = graph.getEdgeAttribute(key, 'kind')
      if (EDGE_PRIORITY.indexOf(kind) < EDGE_PRIORITY.indexOf(prev)) {
        graph.mergeEdgeAttributes(key, { kind, ...edgeLook(kind) })
        byEdgeKind[prev]--
        byEdgeKind[kind]++
      }
      continue
    }
    graph.addDirectedEdgeWithKey(e.id, source, target, { kind, ...edgeLook(kind) })
    byEdgeKind[kind]++
  }

  graph.forEachNode((id, a) => {
    const size = nodeSize(a.kind, graph.degree(id))
    graph.mergeNodeAttributes(id, { size, selectedSize: size * 1.8 + 1 })
  })

  return {
    graph,
    stats: { nodes: graph.order, edges: graph.size, mergedModules: alias.size, byKind, byEdgeKind },
  }
}

export function createSearch(graph: RepoGraph) {
  const entries: { id: string; label: string; lower: string; degree: number; external: boolean }[] = []
  graph.forEachNode((id, a) =>
    entries.push({ id, label: a.label, lower: a.label.toLowerCase(), degree: graph.degree(id), external: a.kind === 'external' }),
  )

  return (query: string, limit = 8): string[] => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const scored: { id: string; score: number; degree: number }[] = []
    for (const e of entries) {
      const i = e.lower.indexOf(q)
      if (i === -1) continue
      const tier = e.lower === q ? 0 : i === 0 ? 1 : /[._/\\-]/.test(e.lower[i - 1]) ? 2 : 3
      const score = tier - (e.label === query.trim() ? 0.25 : 0) + (e.external ? 0.5 : 0)
      scored.push({ id: e.id, score, degree: e.degree })
    }
    scored.sort((a, b) => a.score - b.score || b.degree - a.degree)
    return scored.slice(0, limit).map((s) => s.id)
  }
}

export interface NeighborGroup {
  key: string
  title: string
  ids: string[]
}

export function describeNeighbors(graph: RepoGraph, id: string): NeighborGroup[] {
  const buckets: Record<string, string[]> = {}
  const add = (key: string, other: string) => (buckets[key] ??= []).push(other)
  graph.forEachOutEdge(id, (_e, a, _s, target) => add(`out:${a.kind}`, target))
  graph.forEachInEdge(id, (_e, a, source) => add(`in:${a.kind}`, source))

  const titles: [string, string][] = [
    ['out:calls', 'Calls'],
    ['in:calls', 'Called by'],
    ['out:inherits', 'Inherits from'],
    ['in:inherits', 'Subclasses'],
    ['out:defines', 'Defines'],
    ['in:defines', 'Defined in'],
    ['out:imports', 'Imports'],
    ['in:imports', 'Imported by'],
    ['out:other', 'Related (outgoing)'],
    ['in:other', 'Related (incoming)'],
  ]
  const degree = (n: string) => graph.degree(n)
  return titles
    .filter(([key]) => buckets[key]?.length)
    .map(([key, title]) => ({
      key,
      title,
      ids: buckets[key].sort((a, b) => degree(b) - degree(a) || graph.getNodeAttribute(a, 'label').localeCompare(graph.getNodeAttribute(b, 'label'))),
    }))
}

export interface SymbolRef {
  symbol: string
  file: string
  startLine: number | null
}

const sep = '\u0000'

export function createSymbolIndex(graph: RepoGraph) {
  const byFileLabel = new Map<string, string[]>()
  const byLabel = new Map<string, string[]>()
  graph.forEachNode((id, a) => {
    const k = a.file + sep + a.label
    ;(byFileLabel.get(k) ?? byFileLabel.set(k, []).get(k)!).push(id)
    ;(byLabel.get(a.label) ?? byLabel.set(a.label, []).get(a.label)!).push(id)
  })

  return ({ symbol, file, startLine }: SymbolRef): string | null => {
    const label = /[\\/]/.test(symbol) ? basename(symbol) : symbol
    const sameFile = byFileLabel.get(file + sep + label)
    if (sameFile?.length) {
      if (sameFile.length === 1 || startLine === null) return sameFile[0]
      const gap = (id: string) => Math.abs((graph.getNodeAttribute(id, 'line') ?? Infinity) - startLine)
      return [...sameFile].sort((a, b) => gap(a) - gap(b))[0]
    }
    const named = byLabel.get(label)
    return named?.length === 1 ? named[0] : null
  }
}

export interface TraceOptions {
  maxDepth?: number
  maxNodes?: number
  kinds?: readonly EdgeKind[]
}

export interface Trace {
  ids: string[]
  truncated: boolean
}

export function traceFrom(graph: RepoGraph, seed: string, direction: 'out' | 'in', opts: TraceOptions = {}): Trace {
  const { maxDepth = 2, maxNodes = 40, kinds = ['calls'] } = opts
  if (!graph.hasNode(seed)) return { ids: [], truncated: false }
  const follow = new Set<EdgeKind>(kinds)
  const ids = [seed]
  const visited = new Set(ids)
  const queue: [string, number][] = [[seed, 0]]
  let truncated = false

  for (let head = 0; head < queue.length && !truncated; head++) {
    const [node, depth] = queue[head]
    if (depth >= maxDepth) continue
    const visit = (_edge: string, attrs: EdgeAttrs, source: string, target: string) => {
      const next = direction === 'out' ? target : source
      if (truncated || visited.has(next) || !follow.has(attrs.kind)) return
      if (visited.size >= maxNodes) {
        truncated = true
        return
      }
      visited.add(next)
      ids.push(next)
      queue.push([next, depth + 1])
    }
    if (direction === 'out') graph.forEachOutEdge(node, visit)
    else graph.forEachInEdge(node, visit)
  }
  return { ids, truncated }
}

export interface RelatedHit {
  hit: SearchHit
  id: string
}

export function mergeSearchResults(
  localIds: readonly string[],
  semantic: readonly SearchHit[],
  resolve: (ref: SymbolRef) => string | null,
): RelatedHit[] {
  const have = new Set(localIds)
  const related: RelatedHit[] = []
  for (const hit of semantic) {
    const id = resolve({ symbol: hit.name, file: hit.file, startLine: hit.startLine })
    if (id && !have.has(id)) {
      have.add(id)
      related.push({ hit, id })
    }
  }
  return related
}
