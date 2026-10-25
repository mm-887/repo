import { z } from 'zod'

export const healthSchema = z.object({
  message: z.string(),
  status: z.string(),
  app: z.string(),
})

const graphCountsSchema = z.object({ nodes: z.number(), edges: z.number() })

export const cloneResponseSchema = z.object({
  message: z.string(),
  full_path: z.string(),
  owner: z.string(),
  repo_name: z.string(),
  graph: graphCountsSchema,
})

export const indexResponseSchema = z.object({
  message: z.string(),
  owner: z.string(),
  repo_name: z.string(),
  graph: graphCountsSchema,
})

export const graphNodeSchema = z.object({
  id: z.string(),
  data: z.object({ label: z.string(), type: z.string() }),
  position: z.object({ x: z.number(), y: z.number() }),
})

export const graphEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  type: z.string().nullish(),
  animated: z.boolean(),
  style: z.object({ stroke: z.string() }),
})

export const graphResponseSchema = z.object({
  nodes: z.array(graphNodeSchema),
  edges: z.array(graphEdgeSchema),
})

export const symbolResponseSchema = z.object({
  function: z.string(),
  callers: z.array(z.string()),
  callees: z.array(z.string()),
  node_id: z.string(),
})

const searchMetadataSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  file: z.string(),
  start_line: z.number(),
  end_line: z.number(),
})

export const searchResponseSchema = z.object({
  ids: z.array(z.array(z.string())),
  documents: z.array(z.array(z.string())),
  metadatas: z.array(z.array(searchMetadataSchema)),
  distances: z.array(z.array(z.number())),
})

const debugBaseSchema = z.object({
  nodes: z.number(),
  edges: z.number(),
  call_edges: z.number(),
  sample_call_edges: z.array(z.object({ from: z.string(), to: z.string() })),
  name_index_size: z.number(),
  sample_names: z.array(z.string()),
})

export const debugResponseSchema = z.union([
  debugBaseSchema.extend({
    seed_node_id: z.string().nullable().optional(),
    seed_node_name: z.string().nullable().optional(),
    bfs_path: z.array(z.string()).optional(),
    traversal_direction: z.enum(['in', 'out']).optional(),
  }),
  z.object({ error: z.string() }),
])

export const askResponseSchema = z.object({
  answer: z.string(),
  seed_symbol: z.string().nullable().optional(),
  traversal_direction: z.enum(['in', 'out']).optional(),
  traversed_path: z.array(z.string()).optional(),
  sources: z
    .array(
      z.object({
        symbol: z.string(),
        file: z.string().nullable(),
        lines: z.string(),
        hydrated: z.enum(['full_code', 'metadata']),
      }),
    )
    .optional(),
})

export type HealthResponse = z.infer<typeof healthSchema>
export type CloneResponse = z.infer<typeof cloneResponseSchema>
export type IndexResponse = z.infer<typeof indexResponseSchema>
export type GraphNode = z.infer<typeof graphNodeSchema>
export type GraphEdge = z.infer<typeof graphEdgeSchema>
export type GraphResponse = z.infer<typeof graphResponseSchema>
export type SymbolResponse = z.infer<typeof symbolResponseSchema>
export type SearchResponse = z.infer<typeof searchResponseSchema>
export type DebugResponse = z.infer<typeof debugResponseSchema>
export type AskResponse = z.infer<typeof askResponseSchema>
