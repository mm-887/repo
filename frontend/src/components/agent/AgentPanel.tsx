import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Cpu, Send } from "../layout/Icons";
import { useGraph } from "../../api";
import { getGraphModel } from "../../graph/built";
import { useChat } from "../../hooks/useChat";
import { AnswerMessage } from "./AnswerMessage";
import { preloadMarkdown } from "./markdownLoader";

const TEST_NAME = /(^|\.)test_|^Test|\.Test/;
const TEST_FILE = /(^|\/)(tests?|testing)\/|(^|\/)(conftest|test_[^/]*|[^/]*_test)\.py$/i;

function suggestSymbol(graph: ReturnType<typeof getGraphModel>["graph"]): string | null {
  let best: { label: string; degree: number } | null = null;
  graph.forEachNode((id, a) => {
    if (a.kind !== "function" || TEST_NAME.test(a.label) || TEST_FILE.test(a.file)) return;
    const degree = graph.degree(id);
    if (!best || degree > best.degree) best = { label: a.label, degree };
  });
  return (best as { label: string } | null)?.label ?? null;
}

const AgentPanel = ({ visible = true }: { visible?: boolean }) => {
  const { owner, repo } = useParams();
  const { messages, pending, send, retry } = useChat(owner, repo);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const graph = useGraph(owner, repo);
  const suggestion = useMemo(
    () => (graph.data && owner && repo ? suggestSymbol(getGraphModel(graph.data, owner, repo).graph) : null),
    [graph.data, owner, repo],
  );

  useEffect(() => {
    preloadMarkdown();
  }, []);

  useEffect(() => {
    const list = scrollRef.current;
    if (!list) return;
    const last = messages[messages.length - 1];
    const answer = last?.role === "bot" && !pending ? list.querySelector<HTMLElement>(`[data-msg-id="${last.id}"]`) : null;
    list.scrollTop = answer ? answer.offsetTop - list.offsetTop - 8 : list.scrollHeight;
  }, [messages, pending]);

  const submit = (question: string) => {
    if (send(question)) setInput("");
  };

  const hasRepo = !!owner && !!repo;
  const status = !hasRepo ? { dot: "bg-zinc-600", label: "Idle" } : pending ? { dot: "bg-amber-400 animate-pulse", label: "Thinking" } : { dot: "bg-green-500", label: "Ready" };

  return (
    <aside className={`${visible ? "flex" : "hidden"} lg:flex w-full lg:w-100 flex-1 lg:flex-none shrink-0 min-h-0 flex-col bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl`}>
      <div className="p-4 border-b border-zinc-800 bg-zinc-900/50 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1.5 bg-brand-primary/10 rounded-lg">
            <Cpu size={18} className="text-brand-primary" />
          </div>
          <span className="font-semibold text-zinc-100">RepoAgent</span>
        </div>
        <div className="flex items-center gap-1.5" role="status" aria-label={`Agent ${status.label.toLowerCase()}`}>
          <div className={`w-2 h-2 rounded-full ${status.dot}`} />
          <span className="text-[10px] text-zinc-500 uppercase font-bold">{status.label}</span>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4" aria-live="polite">
        {!hasRepo ? (
          <div className="bg-zinc-800 text-zinc-400 p-3 rounded-2xl rounded-tl-none border border-zinc-700 text-sm leading-relaxed">
            Analyze a repository using the bar at the top, then ask me about its architecture, where logic lives, or what calls a function.
          </div>
        ) : (
          messages.length === 0 && (
            <div className="space-y-3">
              <div className="bg-zinc-800 text-zinc-300 p-3 rounded-2xl rounded-tl-none border border-zinc-700 text-sm leading-relaxed">
                Ask me about <span className="text-zinc-100 font-medium">{owner}/{repo}</span>: how it is structured, where something is
                implemented, or how functions depend on each other. Answers cite the code they came from.
              </div>
              {suggestion && (
                <div className="flex flex-col items-start gap-1.5">
                  {[`Who calls ${suggestion}?`, `How does ${suggestion} work?`].map((q) => (
                    <button
                      key={q}
                      onClick={() => submit(q)}
                      disabled={pending}
                      className="cursor-pointer text-left text-xs px-3 py-1.5 rounded-full border border-zinc-700 text-zinc-300 hover:border-brand-primary/60 hover:text-white transition-colors disabled:opacity-50"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        )}

        {messages.map((msg) => {
          if (msg.role === "user") {
            return (
              <div key={msg.id} className="flex justify-end">
                <div className="max-w-[85%] p-3 rounded-2xl text-sm leading-relaxed bg-brand-primary text-zinc-950 font-medium rounded-tr-none break-words">
                  {msg.text}
                </div>
              </div>
            );
          }
          if (msg.role === "error") {
            return (
              <div key={msg.id} className="flex justify-start">
                <div role="alert" className="max-w-[95%] p-3 rounded-2xl rounded-tl-none border border-red-900/60 bg-red-950/40 text-sm text-red-200">
                  <p className="break-words">{msg.text}</p>
                  <button onClick={() => retry(msg)} disabled={pending} className="cursor-pointer mt-2 text-xs font-semibold text-red-300 hover:text-white underline disabled:opacity-50">
                    Try again
                  </button>
                </div>
              </div>
            );
          }
          return (
            <div key={msg.id} data-msg-id={msg.id} className="flex justify-start">
              <div className="min-w-0 max-w-[95%] p-3 rounded-2xl text-sm bg-zinc-800 text-zinc-300 rounded-tl-none border border-zinc-700" data-testid="bot-message">
                <AnswerMessage result={msg.result} owner={owner!} repo={repo!} />
              </div>
            </div>
          );
        })}

        {pending && (
          <div className="flex justify-start">
            <div className="bg-zinc-800 text-zinc-500 p-3 rounded-2xl rounded-tl-none border border-zinc-700 text-xs italic flex items-center gap-2">
              <div className="flex gap-1">
                <div className="w-1 h-1 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <div className="w-1 h-1 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <div className="w-1 h-1 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
              Agent is thinking...
            </div>
          </div>
        )}
      </div>

      <form
        className="p-4 border-t border-zinc-800 bg-zinc-900/80"
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
      >
        <div className="relative flex items-center gap-2">
          <input
            type="text"
            aria-label="Ask about the code"
            placeholder={hasRepo ? "Ask about the code..." : "Analyze a repository first"}
            disabled={!hasRepo}
            className="w-full bg-zinc-950 border border-zinc-700 rounded-xl py-2.5 pl-4 pr-12 text-base sm:text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-brand-primary/50 transition-all duration-200 disabled:opacity-60"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button
            type="submit"
            aria-label="Send question"
            disabled={!hasRepo || pending || !input.trim()}
            className="absolute right-2 p-1.5 rounded-lg transition-colors bg-brand-primary text-zinc-950 hover:bg-brand-secondary disabled:bg-zinc-700 disabled:text-zinc-500 disabled:cursor-not-allowed"
          >
            <Send size={16} />
          </button>
        </div>
        <p className="text-xs text-center text-zinc-600 mt-3">RepoAgent is AI and can make mistakes.</p>
      </form>
    </aside>
  );
};

export default AgentPanel;
