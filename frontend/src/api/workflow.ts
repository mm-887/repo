import { cloneRepo, getRepoStatus } from './endpoints'
import { ApiError, isApiError } from './errors'
import { parseGitHubRepoUrl } from './normalize'

export type OpenPhase = 'checking' | 'cloning' | 'recovering'

export type OpenSource = 'existing' | 'cloned' | 'recovered'

export interface OpenRepoResult {
  owner: string
  repo: string
  source: OpenSource
  counts: { nodes: number; edges: number }
}

export interface OpenRepoOptions {
  signal?: AbortSignal
  onPhase?: (phase: OpenPhase) => void
  pollIntervalMs?: number
  pollTimeoutMs?: number
  maxUnreachable?: number
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        reject(new DOMException('Aborted', 'AbortError'))
      },
      { once: true },
    )
  })

const isConnectionError = (e: unknown) => isApiError(e) && (e.kind === 'network' || e.kind === 'unreachable')

export async function openRepo(input: string, opts: OpenRepoOptions = {}): Promise<OpenRepoResult> {
  const { signal, onPhase, pollIntervalMs = 4000, pollTimeoutMs = 10 * 60_000, maxUnreachable = 3 } = opts

  const ref = parseGitHubRepoUrl(input)
  if (!ref) {
    throw new ApiError('validation', 'Enter a GitHub repository URL like https://github.com/owner/repo.')
  }
  const { owner, repo } = ref

  onPhase?.('checking')
  try {
    const s = await getRepoStatus(owner, repo, signal)
    return { owner, repo, source: 'existing', counts: { nodes: s.nodes, edges: s.edges } }
  } catch (e) {
    if (!(isApiError(e) && e.kind === 'backend')) throw e
  }

  onPhase?.('cloning')
  try {
    const r = await cloneRepo(ref.url, signal)
    return { owner, repo, source: 'cloned', counts: r.graph }
  } catch (cloneError) {
    if (!isConnectionError(cloneError)) throw cloneError

    onPhase?.('recovering')
    const deadline = Date.now() + pollTimeoutMs
    let unreachable = 0
    while (Date.now() < deadline) {
      await sleep(pollIntervalMs, signal)
      try {
        const s = await getRepoStatus(owner, repo, signal)
        return { owner, repo, source: 'recovered', counts: { nodes: s.nodes, edges: s.edges } }
      } catch (e) {
        if (isApiError(e) && e.kind === 'backend') {
          unreachable = 0 
        } else if (isConnectionError(e)) {
          if (++unreachable >= maxUnreachable) throw e
        } else {
          throw e
        }
      }
    }
    throw cloneError
  }
}
