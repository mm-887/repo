import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, FileCode2, Folder, FolderTree, X } from 'lucide-react'
import { errorMessage, useTree } from '../../api'
import type { TreeNode } from '../../api/schemas'
import { collectFileIds, complexityTone, countFiles, fileComplexity, type ComplexityTone } from '../../graph/fileTree'
import type { RepoGraph } from '../../graph/model'
import useGraphUi from '../../store/useGraphUi'

const panel = 'bg-zinc-900/90 backdrop-blur-md border border-zinc-800 rounded-xl shadow-2xl'

const TONE_CLASS: Record<ComplexityTone, string> = {
  low: 'text-zinc-400 bg-zinc-800',
  medium: 'text-amber-300 bg-amber-500/10',
  high: 'text-red-300 bg-red-500/10',
}

export const ComplexityBadge = ({ value }: { value: number | null }) =>
  value === null ? null : (
    <span
      title={`Highest cyclomatic complexity in this file: ${value}`}
      data-testid="complexity-badge"
      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${TONE_CLASS[complexityTone(value)]}`}
    >
      {value}
    </span>
  )

interface RowProps {
  node: TreeNode
  depth: number
  expanded: ReadonlySet<string>
  selectedId: string | null
  inGraph: (id: string) => boolean
  onToggle: (path: string) => void
  onFile: (id: string) => void
  onFolder: (node: TreeNode) => void
}

const indent = (depth: number) => ({ paddingLeft: `${depth * 12 + 6}px` })

export const TreeRow = ({ node, depth, expanded, selectedId, inGraph, onToggle, onFile, onFolder }: RowProps) => {
  if (node.type === 'file') {
    const id = node.node_id ?? null
    const reachable = !!id && inGraph(id)
    const selected = id !== null && id === selectedId
    return (
      <li>
        <button
          disabled={!reachable}
          onClick={() => id && onFile(id)}
          title={node.path}
          aria-current={selected ? 'true' : undefined}
          style={indent(depth)}
          className={`flex w-full items-center gap-1.5 py-1 pr-2 text-left text-xs rounded ${
            selected ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-800/60'
          } ${reachable ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}
        >
          <FileCode2 size={13} className="shrink-0 text-zinc-500" />
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
          <ComplexityBadge value={fileComplexity(node)} />
        </button>
      </li>
    )
  }

  const open = expanded.has(node.path)
  return (
    <li>
      <div style={indent(depth)} className="flex items-center gap-0.5 pr-2 text-xs text-zinc-300 rounded hover:bg-zinc-800/60">
        <button
          aria-label={`${open ? 'Collapse' : 'Expand'} ${node.name}`}
          aria-expanded={open}
          onClick={() => onToggle(node.path)}
          className="cursor-pointer p-1 text-zinc-500 hover:text-zinc-200"
        >
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <button
          onClick={() => onFolder(node)}
          title={`Highlight the files in ${node.path}`}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 py-1 text-left"
        >
          <Folder size={13} className="shrink-0 text-indigo-400" />
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
          <span className="shrink-0 text-[10px] tabular-nums text-zinc-500">{countFiles(node)}</span>
        </button>
      </div>
      {open && (
        <ul>
          {(node.children ?? []).map((child) => (
            <TreeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              selectedId={selectedId}
              inGraph={inGraph}
              onToggle={onToggle}
              onFile={onFile}
              onFolder={onFolder}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

export const TreeList = ({ tree, ...rest }: Omit<RowProps, 'node' | 'depth'> & { tree: TreeNode }) => {
  const children = tree.children ?? []
  if (children.length === 0) return <p className="p-3 text-xs text-zinc-500">No indexed files were found.</p>
  return (
    <ul aria-label="Repository files" className="p-1.5">
      {children.map((child) => (
        <TreeRow key={child.path} node={child} depth={0} {...rest} />
      ))}
    </ul>
  )
}

const FileTree = ({ graph, owner, repo }: { graph: RepoGraph; owner: string; repo: string }) => {
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const tree = useTree(owner, repo, open)
  const selectedId = useGraphUi((s) => s.selectedId)
  const openFile = useGraphUi((s) => s.openFile)
  const highlight = useGraphUi((s) => s.highlight)
  const inGraph = useMemo(() => (id: string) => graph.hasNode(id), [graph])

  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (!next.delete(path)) next.add(path)
      return next
    })

  const onFolder = (node: TreeNode) => {
    const ids = collectFileIds(node, inGraph)
    if (ids.length) highlight(ids, ['module'], `Files in ${node.path}/`)
  }

  return (
    <div className="relative">
      <button
        aria-expanded={open}
        aria-controls="file-tree-panel"
        onClick={() => setOpen((v) => !v)}
        className={`${panel} flex cursor-pointer items-center gap-2 px-3 py-2 text-xs font-semibold text-zinc-300 hover:text-zinc-100`}
      >
        <FolderTree size={14} />
        Files
      </button>
      {open && (
        <div id="file-tree-panel" className={`${panel} absolute left-0 top-full z-30 mt-1.5 flex max-h-[60vh] w-72 max-w-[calc(100vw-2rem)] flex-col`}>
          <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
            <h2 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Files</h2>
            <button aria-label="Close file tree" onClick={() => setOpen(false)} className="cursor-pointer p-0.5 text-zinc-500 hover:text-zinc-200">
              <X size={14} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {tree.isPending && <p className="p-3 text-xs text-zinc-500">Loading files…</p>}
            {tree.isError && (
              <p role="alert" className="p-3 text-xs text-red-300">
                {errorMessage(tree.error)}
              </p>
            )}
            {tree.isSuccess && (
              <TreeList
                tree={tree.data}
                expanded={expanded}
                selectedId={selectedId}
                inGraph={inGraph}
                onToggle={toggle}
                onFile={openFile}
                onFolder={onFolder}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default FileTree
