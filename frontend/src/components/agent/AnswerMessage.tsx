import { Suspense, useMemo, useState } from 'react'
import { useGraph, type AskResult, type AskSource } from '../../api'
import { getGraphModel } from '../../graph/built'
import { KIND_COLOR } from '../../graph/palette'
import useGraphUi from '../../store/useGraphUi'
import useLayout from '../../store/useLayout'
import { LazyMarkdownAnswer } from './markdownLoader'

const PATH_PREVIEW = 10
const SOURCE_PREVIEW = 5

const lineRange = (s: AskSource) =>
  s.startLine === null ? '' : s.endLine !== null && s.endLine !== s.startLine ? `:${s.startLine}–${s.endLine}` : `:${s.startLine}`

const AnswerContext = ({ result, owner, repo }: { result: AskResult; owner: string; repo: string }) => {
  const graph = useGraph(owner, repo)
  const model = useMemo(() => (graph.data ? getGraphModel(graph.data, owner, repo) : null), [graph.data, owner, repo])
  const focus = useGraphUi((s) => s.focus)
  const highlight = useGraphUi((s) => s.highlight)
  const clearHighlight = useGraphUi((s) => s.clearHighlight)
  const setTab = useLayout((s) => s.setTab)
  const highlighted = useGraphUi((s) => s.highlightedIds)
  const [showAllSources, setShowAllSources] = useState(false)
  const [showAllPath, setShowAllPath] = useState(false)

  const resolved = useMemo(
    () =>
      result.sources.map((s) => ({
        source: s,
        id: model?.resolveSymbol({ symbol: s.symbol, file: s.file, startLine: s.startLine }) ?? null,
      })),
    [result.sources, model],
  )
  const ids = useMemo(() => [...new Set(resolved.map((r) => r.id).filter((id): id is string => id !== null))], [resolved])
  const active = !!highlighted && highlighted.length === ids.length && highlighted.every((id, i) => id === ids[i])

  if (!result.seedSymbol && result.sources.length === 0) return null

  const showGraph = () => setTab('graph') 
  const open = (id: string | null) => {
    if (!id || !model) return
    focus(id, model.graph.getNodeAttribute(id, 'kind'))
    showGraph()
  }
  const toggleHighlight = () => {
    if (!model) return
    if (active) return clearHighlight()
    highlight(ids, new Set(ids.map((id) => model.graph.getNodeAttribute(id, 'kind'))), 'from the answer')
    showGraph()
  }

  const path = result.traversedPath
  const shownPath = showAllPath ? path : path.slice(0, PATH_PREVIEW)
  const shownSources = showAllSources ? resolved : resolved.slice(0, SOURCE_PREVIEW)
  const chip = 'px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-700 text-zinc-300 font-mono text-[11px] break-all'

  return (
    <div className="mt-3 pt-3 border-t border-zinc-700/70 text-xs space-y-3" aria-label="Answer context">
      {result.seedSymbol && (
        <div>
          <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">
            {result.direction === 'in' ? '← Callers and subclasses of' : result.direction === 'out' ? '→ Call flow from' : 'Started from'}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              className={`${chip} text-brand-primary border-brand-primary/40 ${resolved[0]?.id ? 'cursor-pointer hover:border-brand-primary' : 'cursor-default'}`}
              onClick={() => open(resolved[0]?.id ?? null)}
              disabled={!resolved[0]?.id}
              title={resolved[0]?.id ? 'Show in graph' : undefined}
            >
              {result.seedSymbol}
            </button>
            {path.length > 1 && <span className="text-zinc-600">{result.direction === 'in' ? '←' : '→'}</span>}
            {shownPath.slice(1).map((name, i) => {
              const id = resolved.length === path.length ? resolved[i + 1]?.id ?? null : null
              return (
                <button
                  key={`${i}-${name}`}
                  className={`${chip} ${id ? 'cursor-pointer hover:border-zinc-500' : 'cursor-default'}`}
                  onClick={() => open(id)}
                  disabled={!id}
                >
                  {name}
                </button>
              )
            })}
            {path.length > PATH_PREVIEW && (
              <button className="cursor-pointer text-brand-primary hover:underline" onClick={() => setShowAllPath((v) => !v)}>
                {showAllPath ? 'fewer' : `+${path.length - PATH_PREVIEW} more`}
              </button>
            )}
          </div>
        </div>
      )}

      {resolved.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Sources ({resolved.length})</div>
            {ids.length > 0 && (
              <button
                onClick={toggleHighlight}
                className={`cursor-pointer text-[11px] font-semibold px-2 py-0.5 rounded-full border transition-colors ${
                  active ? 'border-brand-primary text-brand-primary' : 'border-zinc-600 text-zinc-300 hover:border-brand-primary/60'
                }`}
                title={ids.length < resolved.length ? `${resolved.length - ids.length} sources could not be matched to graph nodes` : undefined}
              >
                {active ? 'Clear highlight' : `Show ${ids.length} in graph`}
              </button>
            )}
          </div>
          <ul className="space-y-0.5">
            {shownSources.map(({ source, id }, i) => (
              <li key={`${i}-${source.symbol}-${source.startLine}`}>
                <button
                  onClick={() => open(id)}
                  disabled={!id}
                  className={`w-full text-left px-1.5 py-1 rounded flex items-start gap-2 ${id ? 'cursor-pointer hover:bg-zinc-700/50' : 'cursor-default'}`}
                  title={id ? 'Show in graph' : 'Not found in the graph'}
                >
                  <span
                    className="mt-1 w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: id && model ? KIND_COLOR[model.graph.getNodeAttribute(id, 'kind')] : '#52525b' }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-zinc-200 font-medium break-all">{source.symbol}</span>
                    <span className="block text-zinc-500 font-mono text-[11px] break-all">
                      {source.file}
                      {lineRange(source)}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-full border ${
                      source.hydrated === 'full_code' ? 'border-emerald-700 text-emerald-400' : 'border-zinc-700 text-zinc-500'
                    }`}
                    title={source.hydrated === 'full_code' ? 'The model was shown this symbol’s full code' : 'The model only saw this symbol’s name and location'}
                  >
                    {source.hydrated === 'full_code' ? 'code' : 'name only'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {resolved.length > SOURCE_PREVIEW && (
            <button className="cursor-pointer text-brand-primary hover:underline mt-1 px-1.5" onClick={() => setShowAllSources((v) => !v)}>
              {showAllSources ? 'Show fewer' : `Show all ${resolved.length}`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export const AnswerMessage = ({ result, owner, repo }: { result: AskResult; owner: string; repo: string }) => {
  if (result.noContext) {
    return (
      <p className="text-zinc-400">
        I couldn&apos;t find anything relevant in <span className="text-zinc-200">{owner}/{repo}</span>. If it hasn&apos;t been indexed yet,
        analyze it first; otherwise try naming a specific function or class.
      </p>
    )
  }
  return (
    <>
      <Suspense fallback={<p className="whitespace-pre-wrap">{result.answer}</p>}>
        <LazyMarkdownAnswer>{result.answer}</LazyMarkdownAnswer>
      </Suspense>
      <AnswerContext result={result} owner={owner} repo={repo} />
    </>
  )
}
