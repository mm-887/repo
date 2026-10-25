import { useParams } from 'react-router-dom'
import { errorMessage, isApiError, useGraph, useIndexRepo } from '../../api'

const RepoToolbar = () => {
  const { owner, repo } = useParams()
  const graph = useGraph(owner, repo)
  const index = useIndexRepo()
  if (!owner || !repo) return null
  const canReindex = graph.isSuccess

  const error = index.error
    ? isApiError(index.error) && index.error.kind === 'not_found'
      ? "The source files aren't on disk, so this can't be re-indexed. Clone it again instead."
      : errorMessage(index.error)
    : null

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-sm">
      <span className="font-semibold text-zinc-100 truncate">
        {owner}/{repo}
      </span>
      {graph.data && (
        <span className="text-zinc-500 text-xs tabular-nums">
          {graph.data.nodes.length.toLocaleString()} nodes · {graph.data.edges.length.toLocaleString()} edges
        </span>
      )}
      <div className="flex-1" />
      {error && (
        <span role="alert" className="text-red-400 text-xs truncate" title={error}>
          {error}
        </span>
      )}
      {canReindex && (
        <button
          onClick={() => index.mutate({ owner, repo })}
          disabled={index.isPending}
          className="cursor-pointer text-xs font-semibold px-3 py-1 rounded-full border border-zinc-700 text-zinc-300 hover:border-brand-primary/60 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {index.isPending ? 'Re-indexing…' : 'Re-index'}
        </button>
      )}
    </div>
  )
}

export default RepoToolbar
