import type { NodeKind } from '../api/normalize'

export type EdgeKind = 'calls' | 'imports' | 'defines' | 'inherits' | 'other'

export const NODE_KINDS: NodeKind[] = ['function', 'class', 'module', 'external']
export const EDGE_KINDS: EdgeKind[] = ['calls', 'imports', 'defines', 'inherits']

export const KIND_LABEL: Record<NodeKind, string> = {
  function: 'Function',
  class: 'Class',
  module: 'Module',
  external: 'External',
  unknown: 'Other',
}

export const EDGE_LABEL: Record<EdgeKind, string> = {
  calls: 'Calls',
  imports: 'Imports',
  defines: 'Defines',
  inherits: 'Inherits',
  other: 'Other',
}

export const KIND_COLOR: Record<NodeKind, string> = {
  function: '#2dd4bf',
  class: '#6366f1',
  module: '#a1a1aa',
  external: '#52525b',
  unknown: '#71717a',
}

export const EDGE_COLOR: Record<EdgeKind, string> = {
  calls: '#2dd4bf',
  imports: '#52525b',
  defines: '#6366f1',
  inherits: '#f59e0b',
  other: '#3f3f46',
}

export const OUTGOING_COLOR = '#2dd4bf'
export const INCOMING_COLOR = '#f59e0b'
