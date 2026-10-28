// Runtime schemas for every FastAPI response. They mirror what app/main.py actually
// returns (verified against live responses, see __fixtures__/), so a backend change
// surfaces as a clear ApiError('schema') instead of a crash deep inside a component.
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

export const nodeMetricsSchema = z.object({
  complexity: z.number().optional(),
  tokens: z.number().optional(),
  loc: z.number().optional(),
  total_complexity: z.number().optional(),
  max_complexity: z.number().optional(),
  imports: z.number().optional(),
})

export const graphNodeSchema = z.object({
  id: z.string(),
  data: z.object({
    label: z.string(),
    type: z.string(),
    file: z.string().nullish(),
    end_line: z.number().nullish(),
    metrics: nodeMetricsSchema.nullish(),
  }),
  position: z.object({ x: z.number(), y: z.number() }),
})

export const graphEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  /** Relationship type (calls/defines/inherits/imports); absent in graphs served by an older backend. */
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

// /search returns Chroma's raw QueryResult: every field is a list-of-lists (one inner list per query).
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

// /debug answers HTTP 200 with {error} when the graph is not loaded.
export const debugResponseSchema = z.union([
  debugBaseSchema.extend({
    seed_node_id: z.string().nullable().optional(),
    seed_node_name: z.string().nullable().optional(),
    bfs_path: z.array(z.string()).optional(),
    traversal_direction: z.enum(['in', 'out']).optional(),
  }),
  z.object({ error: z.string() }),
])

// /ask returns the full dict, or just {answer} when there is no context (e.g. repo not indexed).
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

export const sourceResponseSchema = z.object({
  path: z.string(),
  language: z.string().optional(),
  content: z.string(),
  lines: z.number().optional(),
  truncated: z.boolean().optional(),
})

const importRefSchema = z.object({
  name: z.string().optional(),
  names: z.array(z.string()).optional(),
})

const symbolRefSchema = z.object({ id: z.string(), name: z.string() })

export const nodeDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string().optional(),
  file: z.string().nullish(),
  start_line: z.number().nullish(),
  end_line: z.number().nullish(),
  metrics: nodeMetricsSchema.nullish(),
  imports: z.array(importRefSchema.extend({ target: z.string() })).optional(),
  imported_by: z.array(importRefSchema.extend({ source: z.string() })).optional(),
  callers: z.array(symbolRefSchema).optional(),
  callees: z.array(symbolRefSchema).optional(),
})

const treeRollupSchema = z.object({
  files: z.number().optional(),
  loc: z.number().optional(),
  tokens: z.number().optional(),
  total_complexity: z.number().optional(),
  max_complexity: z.number().optional(),
})

export type TreeRollup = z.infer<typeof treeRollupSchema>

export interface TreeNode {
  name: string
  path: string
  type: 'file' | 'dir'
  node_id?: string | null
  metrics?: z.infer<typeof nodeMetricsSchema> | null
  rollup?: TreeRollup | null
  children?: TreeNode[]
}

export const treeNodeSchema: z.ZodType<TreeNode> = z.lazy(() =>
  z.object({
    name: z.string(),
    path: z.string(),
    type: z.enum(['file', 'dir']),
    node_id: z.string().nullish(),
    metrics: nodeMetricsSchema.nullish(),
    rollup: treeRollupSchema.nullish(),
    children: z.array(treeNodeSchema).optional(),
  }),
)

export type NodeMetrics = z.infer<typeof nodeMetricsSchema>
export type SourceResponse = z.infer<typeof sourceResponseSchema>
export type NodeDetail = z.infer<typeof nodeDetailSchema>
export type HealthResponse =z.infer<typeof healthSchema>
export type CloneResponse = z.infer<typeof cloneResponseSchema>
export type IndexResponse = z.infer<typeof indexResponseSchema>
export type GraphNode = z.infer<typeof graphNodeSchema>
export type GraphEdge = z.infer<typeof graphEdgeSchema>
export type GraphResponse = z.infer<typeof graphResponseSchema>
export type SymbolResponse = z.infer<typeof symbolResponseSchema>
export type SearchResponse = z.infer<typeof searchResponseSchema>
export type DebugResponse = z.infer<typeof debugResponseSchema>
export type AskResponse = z.infer<typeof askResponseSchema>
