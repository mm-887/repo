import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

const components: Components = {
  h1: (p) => <h3 className="text-base font-semibold text-zinc-100 mt-3 mb-1.5 first:mt-0" {...p} />,
  h2: (p) => <h3 className="text-base font-semibold text-zinc-100 mt-3 mb-1.5 first:mt-0" {...p} />,
  h3: (p) => <h4 className="text-sm font-semibold text-zinc-100 mt-3 mb-1 first:mt-0" {...p} />,
  h4: (p) => <h5 className="text-sm font-semibold text-zinc-200 mt-2 mb-1 first:mt-0" {...p} />,
  p: (p) => <p className="mb-2 last:mb-0 leading-relaxed" {...p} />,
  ul: (p) => <ul className="list-disc pl-5 mb-2 space-y-1 marker:text-zinc-500" {...p} />,
  ol: (p) => <ol className="list-decimal pl-5 mb-2 space-y-1 marker:text-zinc-500" {...p} />,
  li: (p) => <li className="leading-relaxed" {...p} />,
  strong: (p) => <strong className="font-semibold text-zinc-100" {...p} />,
  blockquote: (p) => <blockquote className="border-l-2 border-zinc-600 pl-3 my-2 text-zinc-400" {...p} />,
  hr: () => <hr className="my-3 border-zinc-700" />,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer noopener" className="text-brand-primary underline underline-offset-2 hover:text-brand-secondary break-words">
      {children}
    </a>
  ),
  pre: (p) => <pre className="overflow-x-auto bg-zinc-950 border border-zinc-800 rounded-lg p-3 my-2 text-xs leading-relaxed" {...p} />,
  code: ({ className, children, ...rest }) => {
    const block = /language-/.test(className ?? '') || String(children).includes('\n')
    return block ? (
      <code className={`font-mono text-zinc-200 ${className ?? ''}`} {...rest}>
        {children}
      </code>
    ) : (
      <code className="font-mono text-[0.85em] text-teal-300 bg-zinc-900 border border-zinc-700/60 rounded px-1 py-0.5 break-words" {...rest}>
        {children}
      </code>
    )
  },
  table: (p) => (
    <div className="overflow-x-auto my-2">
      <table className="text-xs border-collapse" {...p} />
    </div>
  ),
  th: (p) => <th className="border border-zinc-700 px-2 py-1 text-left font-semibold bg-zinc-900" {...p} />,
  td: (p) => <td className="border border-zinc-700 px-2 py-1 align-top" {...p} />,
}

const MarkdownAnswer = ({ children }: { children: string }) => (
  <div data-testid="markdown-answer">
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {children}
    </ReactMarkdown>
  </div>
)

export default MarkdownAnswer
