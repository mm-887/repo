import type { z } from 'zod'
import { ApiError } from './errors'

export const API_BASE = '/api'

interface RequestOptions {
  method?: 'GET' | 'POST'
  body?: unknown
  params?: Record<string, string | undefined>
  signal?: AbortSignal
}

function detailMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object' || !('detail' in body)) return null
  const { detail } = body as { detail: unknown }
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail
      .map((d) => {
        const loc = Array.isArray(d?.loc) ? d.loc.filter((p: unknown) => p !== 'body' && p !== 'query').join('.') : ''
        return loc ? `${loc}: ${d?.msg}` : String(d?.msg ?? '')
      })
      .filter(Boolean)
      .join('; ')
  }
  return null
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function httpError(status: number, body: unknown): ApiError {
  const detail = detailMessage(body)
  if (status === 502 || status === 503 || status === 504) {
    return new ApiError('unreachable', "Can't reach the RepoGraph backend. Is it running on port 8000?", status)
  }
  if (status === 404) return new ApiError('not_found', detail ?? 'Not found', status)
  if (status === 422) return new ApiError('validation', detail ?? 'Invalid request', status)
  if (status >= 500) {
    return new ApiError('server', detail ?? `The server hit an internal error (${status}).`, status)
  }
  return new ApiError('client', detail ?? `Request failed (${status}).`, status)
}

export async function apiRequest<S extends z.ZodType>(
  path: string,
  schema: S,
  { method = 'GET', body, params, signal }: RequestOptions = {},
): Promise<z.output<S>> {
  const query = params
    ? '?' +
      new URLSearchParams(
        Object.entries(params).filter((e): e is [string, string] => e[1] !== undefined),
      ).toString()
    : ''

  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}${query}`, {
      method,
      signal,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    throw new ApiError('network', "Couldn't connect to the server. Check your connection and that the backend is running.")
  }

  const payload = await readBody(res)
  if (!res.ok) throw httpError(res.status, payload)

  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    const where = first?.path.join('.') || 'response'
    throw new ApiError('schema', `Unexpected response from the server (${where}: ${first?.message}).`, res.status)
  }
  return parsed.data
}
