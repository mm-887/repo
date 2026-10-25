import type { SearchResponse } from './schemas'

export interface RepoRef {
  owner: string
  repo: string
  url: string
}

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/

export function parseGitHubRepoUrl(input: string): RepoRef | null {
  let s = input.trim()
  if (!s) return null
  s = s.replace(/^git@github\.com:/i, '').replace(/^(https?:\/\/)?(www\.)?github\.com\//i, '')
  s = s.split(/[?#]/)[0]
  const [owner, rawRepo] = s.split('/').filter(Boolean)
  if (!owner || !rawRepo) return null
  const repo = rawRepo.replace(/\.git$/i, '')
  if (!OWNER_RE.test(owner) || !REPO_RE.test(repo) || repo === '.' || repo === '..') return null
  return { owner, repo, url: `https://github.com/${owner}/${repo}` }
}

export function toRepoRelativePath(file: string | null | undefined, owner: string, repo: string): string {
  if (!file) return ''
  const p = file.replace(/\\/g, '/')
  const marker = `/repositories/${owner}/${repo}/`.toLowerCase()
  const i = p.toLowerCase().indexOf(marker)
  return i === -1 ? p : p.slice(i + marker.length)
}

export function parseLineRange(lines: string): { startLine: number; endLine: number } | null {
  const m = /^(\d+)-(\d+)$/.exec(lines)
  return m ? { startLine: Number(m[1]), endLine: Number(m[2]) } : null
}

export type NodeKind = 'module' | 'function' | 'class' | 'external' | 'unknown'

export function nodeKind(type: string, label = ''): NodeKind {
  switch (type) {
    case 'module':
      return 'module'
    case 'external_module':
      return 'external'
    case 'function_definition':
      return 'function'
    case 'class_definition':
      return 'class'
    case 'class':
      return label.includes('.') ? 'function' : 'class'
    default:
      return 'unknown'
  }
}

export interface SearchHit {
  id: string
  name: string
  type: string
  kind: NodeKind
  file: string
  startLine: number
  endLine: number
  distance: number
  document: string
}

export function toSearchHits(raw: SearchResponse, owner: string, repo: string): SearchHit[] {
  const metas = raw.metadatas[0] ?? []
  const docs = raw.documents[0] ?? []
  const dists = raw.distances[0] ?? []
  const best = new Map<string, SearchHit>()
  metas.forEach((m, i) => {
    const distance = dists[i] ?? Infinity
    const prev = best.get(m.id)
    if (prev && prev.distance <= distance) return
    best.set(m.id, {
      id: m.id,
      name: m.name,
      type: m.type,
      kind: nodeKind(m.type, m.name),
      file: toRepoRelativePath(m.file, owner, repo),
      startLine: m.start_line + 1,
      endLine: m.end_line + 1,
      distance,
      document: docs[i] ?? '',
    })
  })
  return [...best.values()].sort((a, b) => a.distance - b.distance)
}
