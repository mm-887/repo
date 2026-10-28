import { apiRequest } from './client'
import { ApiError, isApiError } from './errors'
import {
  parseGitHubRepoUrl,
  parseLineRange,
  toRepoRelativePath,
  toSearchHits,
  type SearchHit,
} from './normalize'
import {
  askResponseSchema,
  cloneResponseSchema,
  debugResponseSchema,
  graphResponseSchema,
  healthSchema,
  indexResponseSchema,
  nodeDetailSchema,
  searchResponseSchema,
  sourceResponseSchema,
  symbolResponseSchema,
  type CloneResponse,
  type GraphResponse,
  type HealthResponse,
  type IndexResponse,
  type NodeDetail,
  type SourceResponse,
  type SymbolResponse,
} from './schemas'

const repoPath = (owner: string, repo: string) =>
  `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`

export const getHealth = (signal?: AbortSignal): Promise<HealthResponse> =>
  apiRequest('/', healthSchema, { signal })

export function cloneRepo(repoUrl: string, signal?: AbortSignal): Promise<CloneResponse> {
  const ref = parseGitHubRepoUrl(repoUrl)
  if (!ref) {
    return Promise.reject(
      new ApiError('validation', 'Enter a GitHub repository URL like https://github.com/owner/repo.'),
    )
  }
  return apiRequest('/repos/clone', cloneResponseSchema, {
    method: 'POST',
    body: { repo_url: ref.url },
    signal,
  })
}

export const indexRepo = (owner: string, repo: string, signal?: AbortSignal): Promise<IndexResponse> =>
  apiRequest(`${repoPath(owner, repo)}/index`, indexResponseSchema, { method: 'POST', signal })

export const getGraph = (owner: string, repo: string, signal?: AbortSignal): Promise<GraphResponse> =>
  apiRequest(`${repoPath(owner, repo)}/graph`, graphResponseSchema, { params: { layout: 'false' }, signal })
 
export async function getRepoStatus(owner: string, repo: string, signal?: AbortSignal) {
  const res = await apiRequest(`${repoPath(owner, repo)}/debug`, debugResponseSchema, { signal })
  if ('error' in res) throw new ApiError('backend', res.error)
  return res
}

export const getSymbolNeighbors = (
  owner: string,
  repo: string,
  functionName: string,
  signal?: AbortSignal,
): Promise<SymbolResponse> =>
  apiRequest(`${repoPath(owner, repo)}/query`, symbolResponseSchema, {
    params: { function_name: functionName },
    signal,
  })

export const getSource = (owner: string, repo: string, path: string, signal?: AbortSignal): Promise<SourceResponse> =>
  apiRequest(`${repoPath(owner, repo)}/source`, sourceResponseSchema, { params: { path }, signal })

export const getNodeDetail = (owner: string, repo: string, id: string, signal?: AbortSignal): Promise<NodeDetail> =>
  apiRequest(`${repoPath(owner, repo)}/node`, nodeDetailSchema, { params: { id }, signal })

export async function searchSymbols(
  owner: string,
  repo: string,
  query: string,
  signal?: AbortSignal,
): Promise<SearchHit[]> {
  try {
    const raw = await apiRequest(`${repoPath(owner, repo)}/search`, searchResponseSchema, {
      params: { query },
      signal,
    })
    return toSearchHits(raw, owner, repo)
  } catch (e) {
    if (isApiError(e) && e.kind === 'not_found') return []
    throw e
  }
}

export interface AskSource {
  symbol: string
  file: string
  startLine: number | null
  endLine: number | null
  hydrated: 'full_code' | 'metadata'
}

export interface AskResult {
  answer: string
  seedSymbol: string | null
  direction: 'in' | 'out' | null
  traversedPath: string[]
  sources: AskSource[]
  noContext: boolean
}

export async function askQuestion(
  owner: string,
  repo: string,
  question: string,
  signal?: AbortSignal,
): Promise<AskResult> {
  const res = await apiRequest(`${repoPath(owner, repo)}/ask`, askResponseSchema, {
    method: 'POST',
    body: { question },
    signal,
  }).catch((e: unknown) => {
    if (isApiError(e) && e.kind === 'server' && /internal (server )?error/i.test(e.message)) {
      throw new ApiError('server', 'The assistant could not answer. The language model may be rate-limited or unavailable; try again later.', e.status)
    }
    throw e
  })
  return {
    answer: res.answer,
    seedSymbol: res.seed_symbol ?? null,
    direction: res.traversal_direction ?? null,
    traversedPath: res.traversed_path ?? [],
    sources: (res.sources ?? []).map((s) => {
      const range = parseLineRange(s.lines)
      return {
        symbol: s.symbol,
        file: toRepoRelativePath(s.file, owner, repo),
        startLine: range?.startLine ?? null,
        endLine: range?.endLine ?? null,
        hydrated: s.hydrated,
      }
    }),
    noContext: res.traversal_direction === undefined && res.answer === 'No context found',
  }
}
