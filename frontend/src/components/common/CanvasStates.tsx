import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { X } from 'lucide-react'
import type { OpenStatus } from '../../store/useStore'
import useStore from '../../store/useStore'
import { repoPath } from '../../hooks/useOpenRepo'

const Spinner = () => (
  <div className="w-10 h-10 border-4 border-brand-primary border-t-transparent rounded-full animate-spin" />
)

const Centered = ({ children }: { children: ReactNode }) => (
  <div className="w-full h-full flex items-center justify-center bg-zinc-950 p-8">
    <div className="flex flex-col items-center gap-4 text-center max-w-md">{children}</div>
  </div>
)

const useElapsedSeconds = (startedAt: number) => {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  return Math.max(0, Math.floor((now - startedAt) / 1000))
}

const PHASE_TEXT: Record<OpenStatus['phase'], string> = {
  checking: 'Checking whether this repository is already indexed…',
  cloning: 'Cloning, parsing and embedding every Python file. Large repositories can take several minutes.',
  recovering: 'Lost the connection while indexing. Waiting for the backend to finish…',
}

const formatElapsed = (s: number) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`)

export const LoadingState = ({ label, slowHint }: { label: string; slowHint?: string }) => {
  const [startedAt] = useState(() => Date.now())
  const elapsed = useElapsedSeconds(startedAt)
  return (
    <Centered>
      <div role="status" className="flex flex-col items-center gap-4">
        <Spinner />
        <p className="text-zinc-500 font-medium animate-pulse">{label}</p>
        {elapsed >= 5 && <p className="text-zinc-600 text-xs tabular-nums">{formatElapsed(elapsed)} elapsed</p>}
        {slowHint && elapsed >= 8 && <p className="text-zinc-500 text-sm leading-relaxed">{slowHint}</p>}
      </div>
    </Centered>
  )
}

export const ProgressCard = ({ status }: { status: OpenStatus }) => {
  const elapsed = useElapsedSeconds(status.startedAt)
  return (
    <Centered>
      <div role="status" aria-live="polite" className="flex flex-col items-center gap-4">
        <Spinner />
        <p className="text-zinc-200 font-semibold">{status.target}</p>
        <p className="text-zinc-500 text-sm leading-relaxed">{PHASE_TEXT[status.phase]}</p>
        <p className="text-zinc-600 text-xs tabular-nums">{formatElapsed(elapsed)} elapsed</p>
      </div>
    </Centered>
  )
}

export const MessageCard = ({
  title,
  children,
  tone = 'neutral',
  action,
}: {
  title: string
  children?: ReactNode
  tone?: 'neutral' | 'error'
  action?: ReactNode
}) => (
  <Centered>
    <div role={tone === 'error' ? 'alert' : undefined} className="flex flex-col items-center gap-3">
      <h2 className={`text-lg font-semibold ${tone === 'error' ? 'text-red-400' : 'text-zinc-200'}`}>{title}</h2>
      {children && <div className="text-zinc-500 text-sm leading-relaxed">{children}</div>}
      {action}
    </div>
  </Centered>
)

export const PrimaryButton = ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button
    {...props}
    className="cursor-pointer bg-brand-primary text-zinc-950 text-sm font-bold px-4 py-1.5 rounded-full hover:bg-brand-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
  >
    {children}
  </button>
)

export const WelcomeState = () => {
  const navigate = useNavigate()
  const recent = useStore((s) => s.recentRepos)
  const remove = useStore((s) => s.removeRecentRepo)
  return (
    <Centered>
      <h2 className="text-xl font-semibold text-zinc-200">Explore a codebase as a graph</h2>
      <p className="text-zinc-500 text-sm leading-relaxed">
        Paste a public GitHub repository URL above and press <span className="text-zinc-300">Analyze</span>. Its Python
        functions, classes and calls are parsed into a graph you can explore and ask questions about.
      </p>
      {recent.length > 0 && (
        <div className="w-full mt-2 text-left">
          <div className="text-[10px] font-bold text-zinc-500 uppercase mb-2 tracking-widest">Recent</div>
          <ul className="flex flex-col gap-1.5">
            {recent.map((r) => (
              <li key={`${r.owner}/${r.repo}`} className="flex items-center gap-1">
                <button
                  onClick={() => navigate(repoPath(r.owner, r.repo))}
                  className="cursor-pointer flex-1 text-left text-sm px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300 hover:border-brand-primary/50 transition-colors"
                >
                  {r.owner}/<span className="font-semibold text-zinc-100">{r.repo}</span>
                </button>
                <button
                  aria-label={`Remove ${r.owner}/${r.repo} from recent`}
                  onClick={() => remove(r.owner, r.repo)}
                  className="cursor-pointer p-2 text-zinc-600 hover:text-zinc-300 rounded-lg"
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Centered>
  )
}
