import { create } from 'zustand'
import type { AskResult } from '../api'

export type ChatMessage =
  | { id: number; role: 'user'; text: string }
  | { id: number; role: 'bot'; question: string; result: AskResult }
  | { id: number; role: 'error'; question: string; text: string }

interface ChatState {
  threads: Record<string, ChatMessage[]>
  pending: Record<string, boolean>
  addUser: (key: string, text: string) => void
  addBot: (key: string, question: string, result: AskResult) => void
  addError: (key: string, question: string, text: string) => void
  removeMessage: (key: string, id: number) => void
  setPending: (key: string, pending: boolean) => void
}

let nextId = 1

const append = (s: ChatState, key: string, message: ChatMessage) => ({
  threads: { ...s.threads, [key]: [...(s.threads[key] ?? []), message] },
})

const useChatStore = create<ChatState>()((set) => ({
  threads: {},
  pending: {},
  addUser: (key, text) => set((s) => append(s, key, { id: nextId++, role: 'user', text })),
  addBot: (key, question, result) => set((s) => append(s, key, { id: nextId++, role: 'bot', question, result })),
  addError: (key, question, text) => set((s) => append(s, key, { id: nextId++, role: 'error', question, text })),
  removeMessage: (key, id) =>
    set((s) => ({ threads: { ...s.threads, [key]: (s.threads[key] ?? []).filter((m) => m.id !== id) } })),
  setPending: (key, pending) => set((s) => ({ pending: { ...s.pending, [key]: pending } })),
}))

export default useChatStore
