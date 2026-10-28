import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  useNodeDetail,
  useSource,
  type NodeDetail,
  type NodeMetrics,
  type SourceResponse,
} from "../../api";
import { lineWindow, sourceErrorMessage } from "../../graph/codeView";
import type { NodeAttrs, RepoGraph } from "../../graph/model";
import useGraphUi from "../../store/useGraphUi";

const Stat = ({
  label,
  value,
}: {
  label: string;
  value: number | undefined;
}) => (
  <div className="min-w-0 rounded-lg bg-zinc-800/60 px-2.5 py-1.5">
    <div className="text-[10px] font-bold uppercase tracking-wide leading-tight text-zinc-500 wrap-break-word">
      {label}
    </div>
    <div className="text-sm font-semibold tabular-nums text-zinc-100">
      {value === undefined ? "-" : value.toLocaleString()}
    </div>
  </div>
);

export const MetricsSummary = ({
  metrics,
  isModule,
}: {
  metrics: NodeMetrics | null | undefined;
  isModule: boolean;
}) => {
  if (!metrics) {
    return (
      <p data-testid="no-metrics" className="text-xs text-zinc-500 px-1">
        No metrics for this graph. Re-index the repository to see tokens,
        complexity and lines.
      </p>
    );
  }
  return (
    <div data-testid="metrics" className="grid grid-cols-3 gap-2">
      <Stat label="Complexity" value={metrics.complexity} />
      <Stat label="Tokens" value={metrics.tokens} />
      <Stat label="Lines" value={metrics.loc} />
      {isModule && (
        <Stat label="Total complexity" value={metrics.total_complexity} />
      )}
      {isModule && (
        <Stat label="Max complexity" value={metrics.max_complexity} />
      )}
      {isModule && <Stat label="Imports" value={metrics.imports} />}
    </div>
  );
};

export const ImportList = ({
  detail,
  onOpen,
}: {
  detail: NodeDetail;
  onOpen: (id: string) => void;
}) => {
  const imports = detail.imports ?? [];
  if (imports.length === 0) return null;
  return (
    <section aria-label="Imports with names">
      <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">
        Imports <span className="tabular-nums">({imports.length})</span>
      </h3>
      <ul className="space-y-0.5">
        {imports.map((imp) => (
          <li key={imp.target}>
            <button
              onClick={() => onOpen(imp.target)}
              className="cursor-pointer w-full text-left px-1.5 py-1 rounded text-sm hover:bg-zinc-800"
            >
              <span className="text-zinc-200 break-all">
                {imp.name ?? imp.target}
              </span>
              {imp.names && imp.names.length > 0 && (
                <span className="text-xs text-zinc-500 wrap-break-word">{`  ${imp.names.join(", ")}`}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
};

interface CodeLinesProps {
  source: SourceResponse;
  start: number | null;
  end: number | null;
}

export const CodeLines = ({ source, start, end }: CodeLinesProps) => {
  const [full, setFull] = useState(false);
  const lines = useMemo(
    () => source.content.replace(/\r?\n$/, "").split(/\r?\n/),
    [source.content],
  );
  const [from, to] = lineWindow(lines.length, start, end, full);
  const scroller = useRef<HTMLDivElement>(null);
  const firstHit = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const box = scroller.current;
    const hit = firstHit.current;
    if (!box || !hit) return;
    box.scrollTop = Math.max(0, hit.offsetTop - box.clientHeight / 3);
  }, [source.path, start, from]);

  const shown = lines.slice(from - 1, to);
  const width = String(to).length;
  const marked = (n: number) =>
    start !== null && n >= start && n <= (end ?? start);
  const hidden = lines.length - shown.length;

  return (
    <div>
      {source.truncated && (
        <p role="note" className="mb-1.5 text-xs text-amber-400/90 px-1">
          This file is larger than the display limit, so only the beginning is
          shown.
        </p>
      )}
      {hidden > 0 && (
        <p className="mb-1.5 text-xs text-zinc-500 px-1">
          Showing lines {from}-{to} of {lines.length}.{" "}
          <button
            onClick={() => setFull(true)}
            className="cursor-pointer text-brand-primary hover:underline"
          >
            Show the whole file
          </button>
        </p>
      )}
      <div
        ref={scroller}
        data-testid="code-scroll"
        className="relative max-h-[50vh] overflow-auto rounded-lg border border-zinc-800 bg-zinc-950/70 font-mono text-xs leading-5"
      >
        <div className="min-w-max py-1">
          {shown.map((text, i) => {
            const n = from + i;
            const on = marked(n);
            return (
              <div
                key={n}
                ref={
                  on && n === Math.max(from, start ?? 0) ? firstHit : undefined
                }
                data-line={n}
                data-highlighted={on ? "true" : undefined}
                className={`flex ${on ? "bg-brand-primary/15" : ""}`}
              >
                <span
                  className={`select-none shrink-0 px-2 text-right tabular-nums ${on ? "text-brand-primary" : "text-zinc-600"}`}
                  style={{ minWidth: `${width + 2}ch` }}
                >
                  {n}
                </span>
                <span
                  className="pr-3 text-zinc-300"
                  style={{ whiteSpace: "pre", tabSize: 4 }}
                >
                  {text === "" ? " " : text}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const Notice = ({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "error";
}) => (
  <p
    role={tone === "error" ? "alert" : "status"}
    className={`text-sm px-1 ${tone === "error" ? "text-red-400" : "text-zinc-500"}`}
  >
    {children}
  </p>
);

export const CodeBody = ({
  attrs,
  source,
  detail,
  onOpen,
}: {
  attrs: Pick<NodeAttrs, "kind" | "line" | "endLine" | "metrics" | "file">;
  source: {
    isPending: boolean;
    error: unknown;
    data: SourceResponse | undefined;
  };
  detail: { data: NodeDetail | undefined };
  onOpen: (id: string) => void;
}) => {
  const isModule = attrs.kind === "module";
  const metrics = detail.data ? detail.data.metrics : attrs.metrics;
  const start = isModule ? null : (detail.data?.start_line ?? attrs.line);
  const end = isModule ? null : (detail.data?.end_line ?? attrs.endLine);

  return (
    <div className="space-y-3">
      <MetricsSummary metrics={metrics} isModule={isModule} />
      {detail.data && <ImportList detail={detail.data} onOpen={onOpen} />}
      {!attrs.file ? (
        <Notice>
          This is an external module, so there is no source in the repository.
        </Notice>
      ) : source.isPending ? (
        <Notice>Loading code…</Notice>
      ) : source.error ? (
        <Notice tone="error">{sourceErrorMessage(source.error)}</Notice>
      ) : source.data ? (
        <CodeLines source={source.data} start={start} end={end} />
      ) : null}
    </div>
  );
};

const CodePanel = ({
  graph,
  id,
  owner,
  repo,
}: {
  graph: RepoGraph;
  id: string;
  owner: string;
  repo: string;
}) => {
  const attrs = graph.getNodeAttributes(id);
  const focus = useGraphUi((s) => s.focus);
  const source = useSource(owner, repo, attrs.file || undefined);
  const detail = useNodeDetail(
    owner,
    repo,
    attrs.kind === "external" ? undefined : id,
  );
  const open = (target: string) => {
    if (graph.hasNode(target))
      focus(target, graph.getNodeAttribute(target, "kind"));
  };
  return (
    <CodeBody attrs={attrs} source={source} detail={detail} onOpen={open} />
  );
};

export default CodePanel;
