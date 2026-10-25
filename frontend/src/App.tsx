import { Route, Routes, useParams } from 'react-router-dom'
import Header from './components/layout/Header'
import AgentPanel from './components/agent/AgentPanel'
import GraphCanvas from './components/graph/GraphCanvas'
import RepoToolbar from './components/graph/RepoToolbar'
import useChatStore from './store/useChat'
import useLayout, { type MobileTab } from './store/useLayout'

const MobileTabs = ({ pendingKey }: { pendingKey: string }) => {
  const tab = useLayout((s) => s.tab)
  const setTab = useLayout((s) => s.setTab)
  const thinking = useChatStore((s) => !!pendingKey && !!s.pending[pendingKey])
  const button = (id: MobileTab, label: string) => (
    <button
      role="tab"
      aria-selected={tab === id}
      onClick={() => setTab(id)}
      className={`cursor-pointer flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ${
        tab === id ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
      }`}
    >
      {label}
      {id === 'chat' && thinking && <span className="ml-2 inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" aria-label="Agent is thinking" />}
    </button>
  )
  return (
    <div role="tablist" aria-label="View" className="lg:hidden flex gap-1 p-1 bg-zinc-900 border border-zinc-800 rounded-xl shrink-0">
      {button('graph', 'Graph')}
      {button('chat', 'Chat')}
    </div>
  )
}

function Workspace() {
  const { owner, repo } = useParams()
  const tab = useLayout((s) => s.tab)
  return (
    <main className="flex-1 min-h-0 flex flex-col lg:flex-row w-full px-3 sm:px-6 lg:px-10 py-3 lg:py-6 gap-3 lg:gap-6 overflow-hidden">
      <MobileTabs pendingKey={owner && repo ? `${owner}/${repo}` : ''} />
      <div className={`${tab === 'graph' ? 'flex' : 'hidden'} lg:flex flex-1 flex-col gap-3 min-w-0 min-h-0`}>
        <RepoToolbar />
        <div className="flex-1 min-h-0 bg-zinc-900/30 border border-zinc-800 rounded-2xl overflow-hidden relative">
          <GraphCanvas />
        </div>
      </div>
      {/* Keyed so each repository starts its own conversation. */}
      <AgentPanel key={`${owner}/${repo}`} visible={tab === 'chat'} />
    </main>
  )
}

function App() {
  return (
    <div className="h-screen w-full bg-zinc-950 text-zinc-200 flex flex-col overflow-hidden">
      <Header />
      <Routes>
        <Route path="/" element={<Workspace />} />
        <Route path="/repo/:owner/:repo" element={<Workspace />} />
        <Route path="*" element={<Workspace />} />
      </Routes>
    </div>
  )
}

export default App
