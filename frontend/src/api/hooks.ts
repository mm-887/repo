import { keepPreviousData, useMutation, useQuery, useQueryClient, type UseMutationOptions } from '@tanstack/react-query'
import {
  askQuestion,
  type AskResult,
  cloneRepo,
  getGraph,
  getHealth,
  getRepoStatus,
  getSymbolNeighbors,
  indexRepo,
  searchSymbols,
} from './endpoints'

export const queryKeys = {
  health: ['health'] as const,
  repo: (owner: string, repo: string) => ['repo', owner, repo] as const,
  graph: (owner: string, repo: string) => ['repo', owner, repo, 'graph'] as const,
  status: (owner: string, repo: string) => ['repo', owner, repo, 'status'] as const,
  symbol: (owner: string, repo: string, name: string) => ['repo', owner, repo, 'symbol', name] as const,
  search: (owner: string, repo: string, query: string) => ['repo', owner, repo, 'search', query] as const,
}

export const useHealth = () =>
  useQuery({
    queryKey: queryKeys.health,
    queryFn: ({ signal }) => getHealth(signal),
    refetchInterval: 15_000,
    retry: false,
  })

export const useGraph = (owner?: string, repo?: string) =>
  useQuery({
    queryKey: queryKeys.graph(owner ?? '', repo ?? ''),
    queryFn: ({ signal }) => getGraph(owner!, repo!, signal),
    enabled: !!owner && !!repo,
    staleTime: Infinity,
  })

export const useRepoStatus = (owner?: string, repo?: string) =>
  useQuery({
    queryKey: queryKeys.status(owner ?? '', repo ?? ''),
    queryFn: ({ signal }) => getRepoStatus(owner!, repo!, signal),
    enabled: !!owner && !!repo,
    staleTime: 30_000,
  })

export const useSymbolNeighbors = (owner?: string, repo?: string, name?: string) =>
  useQuery({
    queryKey: queryKeys.symbol(owner ?? '', repo ?? '', name ?? ''),
    queryFn: ({ signal }) => getSymbolNeighbors(owner!, repo!, name!, signal),
    enabled: !!owner && !!repo && !!name,
    staleTime: 5 * 60_000,
  })

export const useSearch = (owner?: string, repo?: string, query = '') => {
  const q = query.trim()
  return useQuery({
    queryKey: queryKeys.search(owner ?? '', repo ?? '', q),
    queryFn: ({ signal }) => searchSymbols(owner!, repo!, q, signal),
    enabled: !!owner && !!repo && q.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  })
}

export function useCloneRepo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (repoUrl: string) => cloneRepo(repoUrl),
    onSuccess: (data) => qc.invalidateQueries({ queryKey: queryKeys.repo(data.owner, data.repo_name) }),
  })
}

export function useIndexRepo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ owner, repo }: { owner: string; repo: string }) => indexRepo(owner, repo),
    onSuccess: (data) => qc.invalidateQueries({ queryKey: queryKeys.repo(data.owner, data.repo_name) }),
  })
}

export interface AskVariables {
  owner: string
  repo: string
  question: string
  retry?: boolean
}

export const useAskQuestion = (
  options: Pick<UseMutationOptions<AskResult, Error, AskVariables>, 'onMutate' | 'onSuccess' | 'onError' | 'onSettled'> = {},
) =>
  useMutation({
    mutationFn: ({ owner, repo, question }: AskVariables) => askQuestion(owner, repo, question),
    ...options,
  })
