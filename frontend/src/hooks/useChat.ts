import { useCallback } from 'react'
import { errorMessage, useAskQuestion, type AskVariables } from '../api'
import useChatStore, { type ChatMessage } from '../store/useChat'

const EMPTY: ChatMessage[] = []
const keyOf = (v: Pick<AskVariables, 'owner' | 'repo'>) => `${v.owner}/${v.repo}`

export function useChat(owner?: string, repo?: string) {
  const key = owner && repo ? `${owner}/${repo}` : ''
  const messages = useChatStore((s) => (key ? s.threads[key] : undefined)) ?? EMPTY
  const pending = useChatStore((s) => (key ? !!s.pending[key] : false))

  const ask = useAskQuestion({
    onMutate: (v) => {
      const s = useChatStore.getState()
      if (!v.retry) s.addUser(keyOf(v), v.question)
      s.setPending(keyOf(v), true)
    },
    onSuccess: (result, v) => useChatStore.getState().addBot(keyOf(v), v.question, result),
    onError: (error, v) => useChatStore.getState().addError(keyOf(v), v.question, errorMessage(error)),
    onSettled: (_data, _error, v) => useChatStore.getState().setPending(keyOf(v), false),
  })

  const send = useCallback(
    (question: string) => {
      const q = question.trim()
      if (!q || !owner || !repo || pending) return false
      ask.mutate({ owner, repo, question: q })
      return true
    },
    [ask, owner, repo, pending],
  )

  const retry = useCallback(
    (message: Extract<ChatMessage, { role: 'error' }>) => {
      if (!owner || !repo || pending) return
      useChatStore.getState().removeMessage(key, message.id)
      ask.mutate({ owner, repo, question: message.question, retry: true })
    },
    [ask, key, owner, repo, pending],
  )

  return { messages, pending, send, retry }
}
