import type { TreeNode } from '../api/schemas'

export function collectFileIds(node: TreeNode, has: (id: string) => boolean = () => true): string[] {
  if (node.type === 'file') return node.node_id && has(node.node_id) ? [node.node_id] : []
  return (node.children ?? []).flatMap((child) => collectFileIds(child, has))
}

export function countFiles(node: TreeNode): number {
  if (node.type === 'file') return 1
  return node.rollup?.files ?? (node.children ?? []).reduce((sum, child) => sum + countFiles(child), 0)
}

export type ComplexityTone = 'low' | 'medium' | 'high'

export const complexityTone = (value: number): ComplexityTone => (value >= 20 ? 'high' : value >= 10 ? 'medium' : 'low')

export const fileComplexity = (node: TreeNode): number | null => {
  const value = node.metrics?.max_complexity ?? node.metrics?.complexity
  return typeof value === 'number' ? value : null
}
