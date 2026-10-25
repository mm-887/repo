export type ApiErrorKind =
  | 'network' 
  | 'unreachable' 
  | 'not_found' 
  | 'validation' 
  | 'client' 
  | 'server' 
  | 'backend' 
  | 'schema' 

export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status?: number

  constructor(kind: ApiErrorKind, message: string, status?: number) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
    this.status = status
  }
}

export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError

export const errorMessage = (e: unknown): string =>
  e instanceof Error ? e.message : 'Something went wrong'
