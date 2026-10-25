import type { GraphResponse } from '../api/schemas'
import { buildGraph, createSymbolIndex, type BuiltGraph, type SymbolRef } from './model'

export interface GraphModel extends BuiltGraph {
  resolveSymbol: (ref: SymbolRef) => string | null
}

const cache = new WeakMap<GraphResponse, GraphModel>()

export function getGraphModel(data: GraphResponse, owner: string, repo: string): GraphModel {
  let model = cache.get(data)
  if (!model) {
    const built = buildGraph(data, owner, repo)
    model = { ...built, resolveSymbol: createSymbolIndex(built.graph) }
    cache.set(data, model)
  }
  return model
}
