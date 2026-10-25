import type { Attributes } from 'graphology-types'
import type Sigma from 'sigma'
import { DEFAULT_STYLES, type SigmaOptions } from 'sigma/types'
import type { NodeKind } from '../api/normalize'
import type { EdgeAttrs, NodeAttrs, RepoGraph } from './model'
import { INCOMING_COLOR, OUTGOING_COLOR, type EdgeKind } from './palette'

export interface NodeUiState {
  isDimmed: boolean
  isNeighbor: boolean
  isSelected: boolean
  isLabeled: boolean
}
export interface EdgeUiState {
  isDimmed: boolean
  isOutgoing: boolean
  isIncoming: boolean
}
export type RepoSigma = Sigma<NodeAttrs, EdgeAttrs, Attributes, NodeUiState, EdgeUiState>

export const initialNodeState: NodeUiState = { isDimmed: false, isNeighbor: false, isSelected: false, isLabeled: false }
export const initialEdgeState: EdgeUiState = { isDimmed: false, isOutgoing: false, isIncoming: false }

const DIM_COLOR = '#3f3f46'
const LABEL_COLOR = '#e4e4e7'

export const styles: SigmaOptions<NodeAttrs, EdgeAttrs, Attributes, NodeUiState, EdgeUiState>['styles'] = {
  nodes: [
    {
      ...DEFAULT_STYLES.nodes,
      size: { attribute: 'size', defaultValue: 4 },
      labelColor: LABEL_COLOR,
      backdropColor: '#18181b',
      backdropShadowColor: 'rgba(0, 0, 0, 0.7)',
      cursor: 'pointer',
    },
    { whenState: 'isDimmed', then: { color: DIM_COLOR, opacity: 0.3, labelVisibility: 'hidden' } },
    { whenState: 'isNeighbor', then: { depth: 'topNodes' } },
    { whenState: 'isLabeled', then: { labelVisibility: 'visible' } },
    { whenState: 'isSelected', then: { size: { attribute: 'selectedSize', defaultValue: 8 }, labelVisibility: 'visible', depth: 'topNodes' } },
  ],
  edges: [
    {
      ...DEFAULT_STYLES.edges,
      size: { attribute: 'size', defaultValue: 1 },
      opacity: { attribute: 'opacity', defaultValue: 0.3 },
    },
    { whenState: 'isDimmed', then: { opacity: 0.04 } },
    { whenState: 'isOutgoing', then: { color: OUTGOING_COLOR, opacity: 0.95, size: 1.8, depth: 'topEdges' } },
    { whenState: 'isIncoming', then: { color: INCOMING_COLOR, opacity: 0.95, size: 1.8, depth: 'topEdges' } },
  ],
}

const diff = <T>(prev: Set<T>, next: Set<T>) => ({
  added: [...next].filter((x) => !prev.has(x)),
  removed: [...prev].filter((x) => !next.has(x)),
})

enum Role {
  None,
  Dimmed,
  Neighbor,
  Selected,
}
type NodeRole = 'none' | 'dimmed' | 'neighbor' | 'quietNeighbor' | 'selected'
const NODE_STATE: Record<NodeRole, NodeUiState> = {
  none: { isDimmed: false, isNeighbor: false, isSelected: false, isLabeled: false },
  dimmed: { isDimmed: true, isNeighbor: false, isSelected: false, isLabeled: false },
  neighbor: { isDimmed: false, isNeighbor: true, isSelected: false, isLabeled: true },
  quietNeighbor: { isDimmed: false, isNeighbor: true, isSelected: false, isLabeled: false },
  selected: { isDimmed: false, isNeighbor: false, isSelected: true, isLabeled: true },
}
const MAX_LABELED_NEIGHBORS = 40
const EDGE_STATE: Record<Role, EdgeUiState> = {
  [Role.None]: { isDimmed: false, isOutgoing: false, isIncoming: false },
  [Role.Dimmed]: { isDimmed: true, isOutgoing: false, isIncoming: false },
  [Role.Neighbor]: { isDimmed: false, isOutgoing: true, isIncoming: false },
  [Role.Selected]: { isDimmed: false, isOutgoing: false, isIncoming: true },
}

export function createStateSync(sigma: RepoSigma, graph: RepoGraph) {
  let hiddenNodes = new Set<string>()
  let hiddenEdges = new Set<string>()
  const nodeRole = new Map<string, NodeRole>()
  const edgeRole = new Map<string, Role>()

  function applyFilters(hiddenKinds: ReadonlySet<NodeKind>, hiddenEdgeKinds: ReadonlySet<EdgeKind>) {
    const nextNodes = new Set<string>()
    graph.forEachNode((id, a) => hiddenKinds.has(a.kind) && nextNodes.add(id))
    const nextEdges = new Set<string>()
    graph.forEachEdge((id, a, source, target) => {
      if (hiddenEdgeKinds.has(a.kind) || nextNodes.has(source) || nextNodes.has(target)) nextEdges.add(id)
    })

    const n = diff(hiddenNodes, nextNodes)
    if (n.added.length) sigma.setNodesState(n.added, { isHidden: true })
    if (n.removed.length) sigma.setNodesState(n.removed, { isHidden: false })
    const e = diff(hiddenEdges, nextEdges)
    if (e.added.length) sigma.setEdgesState(e.added, { isHidden: true })
    if (e.removed.length) sigma.setEdgesState(e.removed, { isHidden: false })
    hiddenNodes = nextNodes
    hiddenEdges = nextEdges
  }

  function applyFocus(selectedId: string | null, groupIds: readonly string[] | null) {
    const selected = selectedId !== null && graph.hasNode(selectedId) ? selectedId : null
    const group = !selected && groupIds ? groupIds.filter((id) => graph.hasNode(id)) : null
    const groupSet = group?.length ? new Set(group) : null
    const seed = groupSet ? group![0] : null
    const neighbors = selected ? new Set(graph.neighbors(selected)) : null
    const active = selected !== null || groupSet !== null
    const quiet = (neighbors?.size ?? groupSet?.size ?? 0) > MAX_LABELED_NEIGHBORS

    const changedNodes: Partial<Record<NodeRole, string[]>> = {}
    graph.forEachNode((id) => {
      let role: NodeRole
      if (!active) role = 'none'
      else if (id === selected || id === seed) role = 'selected'
      else if (neighbors ? neighbors.has(id) : groupSet!.has(id)) role = quiet ? 'quietNeighbor' : 'neighbor'
      else role = 'dimmed'
      if ((nodeRole.get(id) ?? 'none') === role) return
      nodeRole.set(id, role)
      ;(changedNodes[role] ??= []).push(id)
    })
    for (const [role, ids] of Object.entries(changedNodes)) sigma.setNodesState(ids, NODE_STATE[role as NodeRole])

    const changedEdges: Record<number, string[]> = {}
    graph.forEachEdge((id, _a, source, target) => {
      let role: Role
      if (!active) role = Role.None
      else if (selected) role = source === selected ? Role.Neighbor : target === selected ? Role.Selected : Role.Dimmed
      else role = groupSet!.has(source) && groupSet!.has(target) ? Role.Neighbor : Role.Dimmed
      if ((edgeRole.get(id) ?? Role.None) === role) return
      edgeRole.set(id, role)
      ;(changedEdges[role] ??= []).push(id)
    })
    for (const [role, ids] of Object.entries(changedEdges)) sigma.setEdgesState(ids, EDGE_STATE[Number(role) as Role])
  }

  return { applyFilters, applyFocus }
}
