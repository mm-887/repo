import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { describeNeighbors, traceFrom, type RepoGraph } from '../../graph/model'
import { INCOMING_COLOR, KIND_COLOR, KIND_LABEL, OUTGOING_COLOR } from '../../graph/palette'
import useGraphUi from '../../store/useGraphUi'

const PREVIEW = 12

const NeighborList = ({ graph, title, ids }: { graph: RepoGraph; title: string; ids: string[] }) => {
  const [expanded, setExpanded] = useState(false)
  const focus = useGraphUi((s) => s.focus)
  const shown = expanded ? ids : ids.slice(0, PREVIEW)
  return (
    <section className="mb-3">
      <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">
        {title} <span className="tabular-nums">({ids.length})</span>
      </h3>
      <ul>
        {shown.map((id) => {
          const a = graph.getNodeAttributes(id)
          return (
            <li key={id}>
              <button
                onClick={() => focus(id, a.kind)}
                className="cursor-pointer w-full flex items-center gap-2 px-1.5 py-1 rounded text-left text-sm text-zinc-300 hover:bg-zinc-800"
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: KIND_COLOR[a.kind] }} />
                <span className="truncate">{a.label}</span>
              </button>
            </li>
          )
        })}
      </ul>
      {ids.length > PREVIEW && (
        <button onClick={() => setExpanded((e) => !e)} className="cursor-pointer text-xs text-brand-primary hover:underline px-1.5 mt-0.5">
          {expanded ? 'Show fewer' : `Show all ${ids.length}`}
        </button>
      )}
    </section>
  )
}

const MAX_TRACE_NODES = 60

const TraceControls = ({ graph, id }: { graph: RepoGraph; id: string }) => {
  const [depth, setDepth] = useState(2)
  const highlight = useGraphUi((s) => s.highlight)
  const label = graph.getNodeAttribute(id, 'label')
  const hasOut = graph.someOutEdge(id, (_e, a) => a.kind === 'calls')
  const hasIn = graph.someInEdge(id, (_e, a) => a.kind === 'calls')
  if (!hasOut && !hasIn) return null

  const run = (direction: 'out' | 'in') => {
    const t = traceFrom(graph, id, direction, { maxDepth: depth, maxNodes: MAX_TRACE_NODES })
    const kinds = new Set(t.ids.map((n) => graph.getNodeAttribute(n, 'kind')))
    const what = direction === 'out' ? 'calls from' : 'callers of'
    highlight(t.ids, kinds, `${what} ${label}, ${depth} level${depth > 1 ? 's' : ''}${t.truncated ? `, capped at ${MAX_TRACE_NODES}` : ''}`)
  }
  const button =
    'cursor-pointer text-xs font-semibold px-2.5 py-1 rounded-full border border-zinc-600 text-zinc-200 hover:border-brand-primary/70 hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed'

  return (
    <div className="px-4 py-2.5 border-b border-zinc-800" aria-label="Trace call chain">
      <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5">Trace call chain</div>
      <div className="flex flex-wrap items-center gap-2">
        <button className={button} disabled={!hasOut} onClick={() => run('out')} style={{ color: OUTGOING_COLOR }}>
          Calls →
        </button>
        <button className={button} disabled={!hasIn} onClick={() => run('in')} style={{ color: INCOMING_COLOR }}>
          ← Callers
        </button>
        <select
          aria-label="Trace depth"
          value={depth}
          onChange={(e) => setDepth(Number(e.target.value))}
          className="ml-auto bg-zinc-800 border border-zinc-700 rounded-md text-xs text-zinc-300 px-1.5 py-1 cursor-pointer"
        >
          {[1, 2, 3, 4].map((d) => (
            <option key={d} value={d}>
              {d} level{d > 1 ? 's' : ''}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

const InspectorBody = ({ graph, id }: { graph: RepoGraph; id: string }) => {
  const select = useGraphUi((s) => s.select)
  const a = graph.getNodeAttributes(id)
  const groups = useMemo(() => describeNeighbors(graph, id), [graph, id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && select(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [select])

  return (
    <aside
      aria-label="Symbol inspector"
      className="absolute z-20 flex flex-col bg-zinc-900/90 inset-x-3 bottom-3 max-h-[60%] sm:inset-x-auto sm:top-3 sm:right-3 sm:w-80 sm:max-h-none backdrop-blur-md border border-zinc-800 rounded-xl shadow-2xl"
    >
      <header className="flex items-start gap-2 p-4 pb-3 border-b border-zinc-800">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: KIND_COLOR[a.kind] }} />
            <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{KIND_LABEL[a.kind]}</span>
          </div>
          <h2 className="font-semibold text-zinc-100 break-words">{a.label}</h2>
          {a.file && (
            <p className="text-xs text-zinc-500 mt-1 break-all" data-testid="inspector-location">
              {a.file}
              {a.line !== null && `:${a.line}`}
            </p>
          )}
        </div>
        <button aria-label="Close inspector" onClick={() => select(null)} className="cursor-pointer p-1 text-zinc-500 hover:text-zinc-200 rounded">
          <X size={16} />
        </button>
      </header>

      <div className="flex gap-4 px-4 py-2.5 text-xs border-b border-zinc-800">
        <span style={{ color: OUTGOING_COLOR }}>→ {graph.outDegree(id)} outgoing</span>
        <span style={{ color: INCOMING_COLOR }}>← {graph.inDegree(id)} incoming</span>
      </div>

      <TraceControls graph={graph} id={id} />

      <div className="flex-1 min-h-0 overflow-y-auto p-4 pt-3">
        {groups.length === 0 ? (
          <p className="text-sm text-zinc-500">No relationships were found for this symbol.</p>
        ) : (
          groups.map((g) => <NeighborList key={g.key} graph={graph} title={g.title} ids={g.ids} />)
        )}
      </div>
    </aside>
  )
}

const Inspector = ({ graph }: { graph: RepoGraph }) => {
  const selectedId = useGraphUi((s) => s.selectedId)
  if (!selectedId || !graph.hasNode(selectedId)) return null
  return <InspectorBody key={selectedId} graph={graph} id={selectedId} />
}

export default Inspector
