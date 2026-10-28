import { errorMessage, isApiError } from '../api'

const WINDOW_LINES = 3000
const CONTEXT_LINES = 400

export const sourceErrorMessage = (e: unknown): string => {
  if (isApiError(e)) {
    if (e.status === 415) return 'This file is binary, so there is no code to show.'
    if (e.kind === 'not_found') return 'The file is not in the local checkout (it may have been removed or the repository re-cloned).'
    return e.message
  }
  return errorMessage(e)
}

export const lineWindow = (total: number, start: number | null, end: number | null, full: boolean): [number, number] => {
  if (full || total <= WINDOW_LINES) return [1, total]
  const first = start ?? 1
  return [Math.max(1, first - CONTEXT_LINES), Math.min(total, (end ?? first) + CONTEXT_LINES)]
}
