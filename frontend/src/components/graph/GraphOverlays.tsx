import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Maximize, RefreshCw, Search as SearchIcon, SlidersHorizontal } from 'lucide-react'
import { useSearch } from '../../api'
import type { GraphModel } from '../../graph/built'
import { getClusters, type Cluster } from '../../graph/clusters'
import { getFilesGraph } from '../../graph/filesView'
import { createSearch, mergeSearchResults, type BuiltGraph, type RepoGraph } from '../../graph/model'
import { EDGE_COLOR, EDGE_KINDS, EDGE_LABEL, KIND_COLOR, KIND_LABEL, NODE_KINDS } from '../../graph/palette'
import useGraphUi from '../../store/useGraphUi'

const panel = 'bg-zinc-900/85 backdrop-blur-md border border-zinc-800 rounded-xl shadow-2xl'

/** Search and layout controls share one wrapping row, so a narrow canvas stacks them instead of overlapping. */
export const GraphTopBar = ({ children }: { children: ReactNode }) => (
  <div className="absolute top-3 left-3 right-3 z-20 flex flex-wrap items-start gap-2 pointer-events-none [&>*]:pointer-events-auto">
    {children}
  </div>
)

interface Item {
  id: string
  section: 'name' | 'meaning'
}

/**
 * Find a symbol and fly to it. Name matches appear instantly; matches by meaning come from the backend's
 * embedding search (debounced) and are shown underneath. Press "/" anywhere on the page to jump here.
 */
export const GraphSearch = ({ model, owner, repo }: { model: GraphModel; owner: string; repo: string }) => {
  const { graph, resolveSymbol } = model
  const [query, setQuery] = useState('')
  const [settled, setSettled] = useState('')
  const [active, setActive] = useState(0)
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const focus = useGraphUi((s) => s.focus)

  const search = useMemo(() => createSearch(graph), [graph])
  const names = useMemo(() => search(query, 6), [search, query])

  // Embedding search costs a round-trip, so only ask once typing pauses and the query is meaningful.
  useEffect(() => {
    const t = setTimeout(() => setSettled(query.trim()), 350)
    return () => clearTimeout(t)
  }, [query])
  const semantic = useSearch(owner, repo, settled.length >= 3 ? settled : '')
  const stale = semantic.isPlaceholderData || settled !== query.trim()
  const related = useMemo(
    () => (semantic.data ? mergeSearchResults(names, semantic.data, resolveSymbol).slice(0, 5) : []),
    [semantic.data, names, resolveSymbol],
  )

  const items: Item[] = [...names.map((id) => ({ id, section: 'name' as const })), ...related.map((r) => ({ id: r.id, section: 'meaning' as const }))]
  const searching = settled.length >= 3 && (semantic.isFetching || stale)

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (e.key !== '/' || el?.closest('input, textarea, [contenteditable]')) return
      e.preventDefault()
      inputRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const choose = (id: string) => {
    focus(id, graph.getNodeAttribute(id, 'kind'))
    setQuery('')
    setSettled('')
    setOpen(false)
    inputRef.current?.blur()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter' && items[Math.min(active, items.length - 1)]) {
      choose(items[Math.min(active, items.length - 1)].id)
    } else if (e.key === 'Escape') {
      setQuery('')
      setSettled('')
      setOpen(false)
      inputRef.current?.blur()
    }
  }

  const showResults = open && query.trim().length > 0
  const row = (item: Item, index: number) => {
    const a = graph.getNodeAttributes(item.id)
    return (
      <li
        key={`${item.section}-${item.id}`}
        id={`graph-search-opt-${index}`}
        role="option"
        aria-selected={index === active}
        onMouseDown={(e) => {
          e.preventDefault()
          choose(item.id)
        }}
        // mousemove, not mouseenter: a pointer resting over the list must not override the keyboard when results change under it
        onMouseMove={() => setActive(index)}
        className={`cursor-pointer px-3 py-1.5 flex items-center gap-2 text-sm ${index === active ? 'bg-zinc-800' : ''}`}
      >
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: KIND_COLOR[a.kind] }} />
        <span className="truncate text-zinc-100">{a.label}</span>
        <span className="ml-auto pl-2 truncate text-xs text-zinc-500">
          {a.file}
          {item.section === 'meaning' && a.line !== null ? `:${a.line}` : ''}
        </span>
      </li>
    )
  }
  const header = (text: string) => <li role="presentation" className="px-3 pt-2 pb-1 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{text}</li>

  return (
    <div className="relative z-30 w-full sm:w-72">
      <div className={`${panel} relative`}>
        <SearchIcon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
        <input
          ref={inputRef}
          role="combobox"
          aria-label="Find a symbol in the graph"
          aria-expanded={showResults}
          aria-controls="graph-search-results"
          aria-activedescendant={showResults && items[active] ? `graph-search-opt-${active}` : undefined}
          placeholder="Find by name or meaning…  ( / )"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
          className="w-full bg-transparent rounded-xl py-2 pl-9 pr-3 text-base sm:text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-brand-primary/50"
        />
      </div>
      {showResults && (
        <ul id="graph-search-results" role="listbox" className={`${panel} absolute left-0 right-0 sm:right-auto sm:w-[26rem] max-w-[calc(100vw-2rem)] top-full mt-1.5 max-h-[60vh] overflow-y-auto pb-1`}>
          {names.length > 0 && header('Names')}
          {names.map((id, i) => row({ id, section: 'name' }, i))}
          {(related.length > 0 || searching || semantic.isError) && header('Related by meaning')}
          <div className={stale && related.length > 0 ? 'opacity-50' : undefined}>{related.map((r, i) => row({ id: r.id, section: 'meaning' }, names.length + i))}</div>
          {searching && related.length === 0 && <li role="status" className="px-3 py-1.5 text-xs text-zinc-500 animate-pulse">Searching by meaning…</li>}
          {semantic.isError && <li className="px-3 py-1.5 text-xs text-zinc-500">Search by meaning is unavailable right now.</li>}
          {items.length === 0 && !searching && !semantic.isError && <li className="px-3 py-2 text-sm text-zinc-500">No matching symbols</li>}
        </ul>
      )}
    </div>
  )
}

/** Re-run the force layout, re-frame the camera, and show when the layout is still settling. */
export const LayoutControls = () => {
  const running = useGraphUi((s) => s.layoutRunning)
  const relayout = useGraphUi((s) => s.relayout)
  const resetView = useGraphUi((s) => s.resetView)
  const button =
    'cursor-pointer flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-zinc-300 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed'
  return (
    <div className="flex items-center gap-2">
      <div className={`${panel} flex items-center p-0.5`}>
        <button className={button} onClick={resetView} title="Fit the whole graph in view">
          <Maximize size={13} /> Fit
        </button>
        <button className={button} onClick={relayout} disabled={running} title="Re-run the layout">
          <RefreshCw size={13} className={running ? 'animate-spin' : ''} /> Re-layout
        </button>
      </div>
      {running && (
        <span role="status" className="text-xs text-zinc-400 animate-pulse">
          Arranging layout…
        </span>
      )}
    </div>
  )
}

const segment = (on: boolean) =>
  `cursor-pointer px-2.5 py-1.5 text-xs font-semibold rounded-lg transition-colors ${on ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`

export const ViewControls = ({ graph }: { graph: RepoGraph }) => {
  const viewMode = useGraphUi((s) => s.viewMode)
  const colorMode = useGraphUi((s) => s.colorMode)
  const setViewMode = useGraphUi((s) => s.setViewMode)
  const setColorMode = useGraphUi((s) => s.setColorMode)
  const toFiles = () => {
    const selected = useGraphUi.getState().selectedId
    setViewMode('files', selected ? getFilesGraph(graph).fileOf(selected) : null)
  }
  return (
    <div className="flex items-center gap-2">
      <div role="group" aria-label="Graph view" className={`${panel} flex items-center p-0.5`}>
        <button className={segment(viewMode === 'symbols')} aria-pressed={viewMode === 'symbols'} onClick={() => setViewMode('symbols')} title="Functions, classes and modules">
          Symbols
        </button>
        <button className={segment(viewMode === 'files')} aria-pressed={viewMode === 'files'} onClick={toFiles} title="One node per file, edges weighted by cross-file links">
          Modules
        </button>
      </div>
      <div role="group" aria-label="Colour nodes by" className={`${panel} flex items-center p-0.5`}>
        <button className={segment(colorMode === 'kind')} aria-pressed={colorMode === 'kind'} onClick={() => setColorMode('kind')} title="Colour by node kind">
          Kind
        </button>
        <button className={segment(colorMode === 'package')} aria-pressed={colorMode === 'package'} onClick={() => setColorMode('package')} title="Colour by package folder">
          Package
        </button>
      </div>
    </div>
  )
}

export const PackageLegend = ({ clusters }: { clusters: Cluster[] }) => {
  const hiddenClusters = useGraphUi((s) => s.hiddenClusters)
  const toggleCluster = useGraphUi((s) => s.toggleCluster)
  const highlight = useGraphUi((s) => s.highlight)
  const depth = useGraphUi((s) => s.clusterDepth)
  const setDepth = useGraphUi((s) => s.setClusterDepth)
  const pathFilter = useGraphUi((s) => s.pathFilter)
  const setPathFilter = useGraphUi((s) => s.setPathFilter)
  const [draft, setDraft] = useState(pathFilter)
  useEffect(() => {
    if (draft === useGraphUi.getState().pathFilter) return
    const t = setTimeout(() => setPathFilter(draft), 300)
    return () => clearTimeout(t)
  }, [draft, setPathFilter])
  return (
    <div aria-label="Packages">
      <div className="flex items-center mb-1.5">
        <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Packages</span>
        <select
          aria-label="Package depth"
          value={depth}
          onChange={(e) => setDepth(Number(e.target.value))}
          className="ml-auto bg-zinc-800 border border-zinc-700 rounded text-[11px] text-zinc-300 px-1 py-0.5 cursor-pointer"
        >
          {[1, 2, 3].map((d) => (
            <option key={d} value={d}>
              depth {d}
            </option>
          ))}
        </select>
      </div>
      <input
        aria-label="Filter by path"
        placeholder="Filter by path…"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className="w-full mb-1.5 bg-zinc-800/80 border border-zinc-700 rounded px-2 py-1 text-base sm:text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-brand-primary/50"
      />
      <ul className="max-h-48 overflow-y-auto">
        {clusters.map((c) => {
          const off = hiddenClusters.has(c.key)
          return (
            <li key={c.key} className="flex items-center gap-1">
              <button
                aria-label={`${off ? 'Show' : 'Hide'} ${c.key}`}
                aria-pressed={!off}
                onClick={() => toggleCluster(c.key)}
                className="cursor-pointer shrink-0 p-1 rounded hover:bg-zinc-800"
              >
                <span className={`block w-2.5 h-2.5 rounded-full ${off ? 'opacity-25' : ''}`} style={{ background: c.color }} />
              </button>
              <button
                onClick={() => highlight(c.ids, [], `package ${c.key}`)}
                title={`Highlight ${c.key}`}
                className={`cursor-pointer min-w-0 flex-1 flex items-center gap-2 text-left text-xs px-1 py-0.5 rounded hover:bg-zinc-800 ${off ? 'text-zinc-600 line-through' : 'text-zinc-300'}`}
              >
                <span className="truncate">{c.key}</span>
                <span className="ml-auto tabular-nums text-zinc-500">{c.ids.length.toLocaleString()}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Legend that doubles as the filter panel: click a kind to hide or show it. Collapses behind a button on phones. */
export const GraphLegend = ({ stats, graph }: { stats: BuiltGraph['stats']; graph: RepoGraph }) => {
  const hiddenKinds = useGraphUi((s) => s.hiddenKinds)
  const hiddenEdgeKinds = useGraphUi((s) => s.hiddenEdgeKinds)
  const toggleKind = useGraphUi((s) => s.toggleKind)
  const toggleEdgeKind = useGraphUi((s) => s.toggleEdgeKind)
  const colorMode = useGraphUi((s) => s.colorMode)
  const depth = useGraphUi((s) => s.clusterDepth)
  const clusters = useMemo(() => (colorMode === 'package' ? getClusters(graph, depth).list : null), [colorMode, graph, depth])
  const [open, setOpen] = useState(false)
  const chip = (off: boolean) =>
    `cursor-pointer flex items-center gap-2 text-xs w-full text-left px-1.5 py-0.5 rounded hover:bg-zinc-800 ${off ? 'text-zinc-600 line-through' : 'text-zinc-300'}`

  return (
    <div
      className="absolute bottom-3 left-3 top-48 md:top-28 z-10 flex flex-col justify-end items-start gap-2 pointer-events-none *:pointer-events-auto"
      aria-label="Legend and filters"
    >
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`${panel} md:hidden cursor-pointer flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-zinc-300`}
      >
        <SlidersHorizontal size={13} /> Filters
      </button>
      <div className={`${panel} p-3 w-52 min-h-0 overflow-y-auto ${open ? 'block' : 'hidden'} md:block`}>
        {clusters && (
          <div className="mb-3">
            <PackageLegend clusters={clusters} />
          </div>
        )}
        <div className="text-[10px] font-bold text-zinc-500 uppercase mb-1.5 tracking-widest">Nodes</div>
        {NODE_KINDS.map((kind) => (
          <button key={kind} className={chip(hiddenKinds.has(kind))} aria-pressed={!hiddenKinds.has(kind)} onClick={() => toggleKind(kind)}>
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: KIND_COLOR[kind] }} />
            {KIND_LABEL[kind]}
            <span className="ml-auto tabular-nums text-zinc-500 no-underline">{stats.byKind[kind].toLocaleString()}</span>
          </button>
        ))}
        <div className="text-[10px] font-bold text-zinc-500 uppercase mt-3 mb-1.5 tracking-widest">Edges</div>
        {EDGE_KINDS.map((kind) => (
          <button key={kind} className={chip(hiddenEdgeKinds.has(kind))} aria-pressed={!hiddenEdgeKinds.has(kind)} onClick={() => toggleEdgeKind(kind)}>
            <span className="w-3 h-0.5 shrink-0" style={{ background: EDGE_COLOR[kind] }} />
            {EDGE_LABEL[kind]}
            <span className="ml-auto tabular-nums text-zinc-500">{stats.byEdgeKind[kind].toLocaleString()}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/** Shown while a group (an answer's traversal, or a call-chain trace) is highlighted, so there is a way back. */
export const HighlightBanner = () => {
  const highlighted = useGraphUi((s) => s.highlightedIds)
  const note = useGraphUi((s) => s.highlightNote)
  const clear = useGraphUi((s) => s.clearHighlight)
  if (!highlighted) return null
  return (
    <div role="status" className={`${panel} absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 px-3 py-1.5 text-xs text-zinc-300 max-w-[calc(100%-1.5rem)]`}>
      <span>
        Highlighting {highlighted.length} symbols{note ? `: ${note}` : ''}
      </span>
      <button onClick={clear} className="cursor-pointer font-semibold text-brand-primary hover:underline">
        Clear
      </button>
    </div>
  )
}
