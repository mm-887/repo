import re
import numpy as np
from app import config
from app.github.repo_ref import checkout_path, validate_repo_id
from app.graph.vector_store import search, embedding_func
from app.graph.registry import get_graph
from app.llm.factory import get_llm_provider
from app.llm.interface import LLMEmptyResponse

def select_nodes_for_full_code(graph, seed_node: str, traversed_nodes: list, question: str, max_full_code: int = 4) -> set:
    selected = {seed_node}
    other_nodes = [n for n in traversed_nodes if n != seed_node]
    if not other_nodes:
        return selected

    node_summaries = []
    eligible_nodes = []

    for n in other_nodes:
        data = graph.G.nodes.get(n, {})
        code = data.get('code', '')
        if code and data.get('type') in ('function_definition', 'class_definition'):
            node_summaries.append(f"{data.get('name')}: {code[:300]}")
            eligible_nodes.append(n)

    if not eligible_nodes:
        return selected

    q_emb = np.array(embedding_func([question])[0])
    node_embs = np.array(embedding_func(node_summaries))
    scores = np.dot(node_embs, q_emb)
    ranked_indices = np.argsort(scores)[::-1]

    for idx in ranked_indices[:max_full_code - 1]:
        selected.add(eligible_nodes[idx])

    return selected


STOP_WORDS = frozenset({
    "the", "how", "does", "what", "who", "which", "where", "when", "why", "this", "that", "with", "from",
    "and", "for", "are", "was", "were", "can", "you", "your", "has", "have", "into", "about", "work", "works",
    "use", "used", "uses", "not", "all", "any", "its", "get", "set", "new", "call", "calls", "called",
})

DEFINITION_TYPES = ("function_definition", "class_definition")

REVERSE_PATTERN = re.compile(
    r'\b(who|what|which)\b.*?\b(calls?|inherits?|subclasses?|depends on)\b'
    r'|\b(called by|callers?|used by|invoked by|subclasses of|inherits from|inherited by|where is'
    r'|uses of|usages of|impact|affected by|dependents of)\b',
    re.IGNORECASE,
)
FORWARD_OVERRIDES = ("execution flow", "call flow", "trace", "how does")


def question_direction(question: str) -> str:
    """"in" for callers/subclasses/impact questions, otherwise "out". Shared by /ask and /debug."""
    if any(kw in question.lower() for kw in FORWARD_OVERRIDES):
        return "out"
    return "in" if REVERSE_PATTERN.search(question) else "out"


def line_range(data: dict) -> str:
    """1-based "start-end" for display and sources. Graph and Chroma store 0-based tree-sitter rows."""
    start, end = data.get('start_line'), data.get('end_line')
    if start is None or end is None:
        return "None-None"
    return f"{start + 1}-{end + 1}"


def collapse_vector_hits(graph, vector_res) -> list:
    """One entry per entity, in rank order. Chunks of the same entity collapse into the best-ranked one.

    Each entry: {"key", "node_id" (graph node or None), "rank" (0-based position of the best chunk), "doc", "meta"}.
    """
    if not vector_res:
        return []
    docs = (vector_res.get('documents') or [[]])[0] or []
    metas = (vector_res.get('metadatas') or [[]])[0] or []
    hits = []
    seen = {}
    for rank in range(max(len(docs), len(metas))):
        meta = metas[rank] if rank < len(metas) and metas[rank] else {}
        doc = docs[rank] if rank < len(docs) and docs[rank] else ""
        entity_id = meta.get('id')
        key = entity_id or (meta.get('file'), meta.get('name'), meta.get('start_line')) if (entity_id or meta) else ("doc", rank)
        if key in seen:
            continue
        seen[key] = True
        node_id = entity_id if entity_id and graph is not None and graph.G.has_node(entity_id) else None
        hits.append({"key": key, "node_id": node_id, "rank": rank, "doc": doc, "meta": meta})
    return hits


def is_test_path(file, repo_root: str = None) -> bool:
    """True for a file under a `test`/`tests` directory or named test_*.py, *_test.py or conftest.py.

    Judged on the path relative to `repo_root`, so a checkout that merely sits below a folder named `tests` is not
    penalized. Without `repo_root` the whole path is inspected.
    """
    if not file:
        return False
    path = str(file).replace("\\", "/")
    if repo_root:
        root = repo_root.replace("\\", "/").rstrip("/") + "/"
        if path.lower().startswith(root.lower()):
            path = path[len(root):]
    *dirs, name = [p for p in path.split("/") if p] or [""]
    if any(d.lower() in ("tests", "test") for d in dirs):
        return True
    name = name.lower()
    return name.startswith("test_") or name.endswith("_test.py") or name == "conftest.py"


def resolve_seed_node(graph, question: str, vector_res: dict, repo_root: str = None) -> str | None:
    """Pick the node the traversal starts from.

    score = 0.6 * lexical + 0.4 * semantic, with test-path (is_test_path, relative to repo_root) and call-count adjustments.
    semantic: 1 - 0.15 * rank of the entity's best-ranked chunk (a later chunk never lowers it).
    lexical: exact name match 1.0, leaf-only match 0.8, scaled by how ambiguous the name is (1 candidate 1.0,
    2-3 candidates 0.5, more 0.25). Tokens under 3 characters and common question words are ignored.
    """
    if not graph:
        return None
    if not vector_res or not vector_res.get('metadatas') or not vector_res['metadatas'][0]:
        return None

    candidate_scores = {}
    for rank, meta in enumerate(vector_res['metadatas'][0]):
        meta = meta or {}
        node_id = meta.get('id')
        if node_id and graph.G.has_node(node_id):
            targets = [node_id]
        else:
            targets = graph.name_index.get(meta.get('name'), [])
        semantic = 1.0 - (rank * 0.15)
        for nid in targets:
            entry = candidate_scores.setdefault(nid, {"lexical": 0.0, "semantic": 0.0})
            entry["semantic"] = max(entry["semantic"], semantic)

    tokens = re.findall(r'[A-Za-z0-9_.]+', question)
    for token in tokens:
        leaf = token.split('.')[-1]
        for name_to_check, base in ((token, 1.0), (leaf, 0.8 if leaf != token else 0.0)):
            if base == 0.0 or len(name_to_check) < 3 or name_to_check.lower() in STOP_WORDS or name_to_check not in graph.name_index:
                continue
            candidates = graph.name_index[name_to_check]
            factor = 1.0 if len(candidates) == 1 else 0.5 if len(candidates) <= 3 else 0.25
            for node_id in candidates:
                entry = candidate_scores.setdefault(node_id, {"lexical": 0.0, "semantic": 0.0})
                entry["lexical"] = max(entry["lexical"], base * factor)


    ranked_scores = []
    for node_id in candidate_scores:
        node_data = graph.G.nodes.get(node_id, {})
        entity_type = node_data.get('type')
        if entity_type not in ["function_definition", "class_definition", "module"]:
            continue
        score = (0.6 * candidate_scores[node_id]["lexical"]) + (0.4 * candidate_scores[node_id]["semantic"])

        if is_test_path(node_data.get('file'), repo_root):
            score -= 0.2
        out_calls = len([e for e in graph.G.successors(node_id) if graph.G.get_edge_data(node_id, e, {}).get('type') == 'calls'])
        score += min(out_calls, 5) * 0.02
        ranked_scores.append((score, node_id))
    
    ranked_scores.sort(reverse=True)
    for score, node_id in ranked_scores:
        if score > 0:
            return node_id
    return None
    
class ContextBuilder:
    """Accumulates prompt sections under one character budget.

    Every part added (plus a newline) counts against the budget; space for the final "omitted" marker is always
    reserved, so the rendered sections together never exceed the budget.
    """
    OMIT_RESERVE = 80
    TRUNC_RESERVE = 80
    MIN_USEFUL = 200

    def __init__(self, budget: int, snippet_limit: int):
        self.budget = budget
        self.snippet_limit = snippet_limit
        self.used = 0
        self.omitted = 0
        self.sections = {}

    def remaining(self) -> int:
        return self.budget - self.OMIT_RESERVE - self.used

    def _put(self, section: str, text: str):
        self.sections.setdefault(section, []).append(text)
        self.used += len(text) + 1

    def add_text(self, section: str, text: str, max_len: int = None) -> bool:
        """Add a short entry, truncating it (with a marker) when it is over max_len or the remaining space."""
        limit = self.remaining() - 1
        if max_len is not None:
            limit = min(limit, max_len)
        if len(text) > limit:
            keep = limit - self.TRUNC_RESERVE
            if keep < self.MIN_USEFUL // 2:
                self.omitted += 1
                return False
            text = text[:keep] + f"\n... [truncated: showing {keep} of {len(text)} chars]"
        self._put(section, text)
        return True

    def add_code(self, section: str, header: str, code: str) -> bool:
        """Add `header` + code, capping the code at the per-snippet limit and the remaining space."""
        space = self.remaining() - len(header) - 1
        if space < 0:
            self.omitted += 1
            return False
        if len(code) > min(self.snippet_limit, space):
            limit = min(self.snippet_limit, space - self.TRUNC_RESERVE)
            if limit < self.MIN_USEFUL:
                self.omitted += 1
                return False
            code = code[:limit] + f"\n... [truncated: showing {limit} of {len(code)} chars]"
        self._put(section, header + code)
        return True

    def render(self, section: str) -> str:
        parts = list(self.sections.get(section, []))
        if section == "snippets" and self.omitted:
            parts.append(f"[{self.omitted} more entries omitted: context budget reached]")
        return "\n".join(parts)


def module_outline(graph, node_id: str) -> str:
    """Signature-level summary of the definitions in a module's file, used instead of an oversized module body."""
    module = graph.G.nodes[node_id]
    defs = [
        (data.get('start_line') or 0, data)
        for _, data in graph.G.nodes(data=True)
        if data.get('file') == module.get('file') and data.get('type') in DEFINITION_TYPES
    ]
    lines = []
    for _, data in sorted(defs, key=lambda d: d[0]):
        code = (data.get('code') or '').strip()
        signature = code.splitlines()[0] if code else ''
        lines.append(f"{data.get('name')} (lines {line_range(data)}): {signature}")
    return "Module outline (file too large to include in full):\n" + "\n".join(lines)


def metadata_line(data: dict, node_id: str) -> str:
    return f"Symbol: {data.get('name', node_id)} | File: {data.get('file')} | Lines: {line_range(data)}"


def answer_question(owner:str, repo_name:str, question:str) -> dict:
    vector_res = search(owner, repo_name, question, n_results=5)
    if not vector_res or not vector_res['documents'] or not vector_res['documents'][0]:
        return "No context found"
    graph = get_graph(owner, repo_name)
    seed_node = resolve_seed_node(graph, question, vector_res, checkout_path(validate_repo_id(owner, repo_name)))
    hits =collapse_vector_hits(graph, vector_res)

    traversed_nodes = []
    relationships = []
    full_code_shown = set()
    ctx = ContextBuilder(config.RAG_CONTEXT_CHAR_BUDGET, config.RAG_SNIPPET_CHAR_LIMIT)

    traversal_dir = question_direction(question)
    is_reverse = traversal_dir == "in"
    cited_nodes = []

    if graph and seed_node:
        traversed_nodes = graph.bfs(seed_node, max_depth=4, max_nodes=15, direction=traversal_dir) or []
        if traversed_nodes:
            if is_reverse:
                items = []
                for n in traversed_nodes:
                    if n != seed_node:
                        edge = graph.G.get_edge_data(n, seed_node)
                        rel_type = edge.get('type', 'calls') if edge else 'references'
                        items.append(f"{graph.G.nodes[n].get('name', n)} ({rel_type})")
                relationships.append(f"Incoming relationships to '{graph.G.nodes[seed_node].get('name', seed_node)}': {', '.join(items)}")

            else:
                node_names = [graph.G.nodes[n].get('name', n) for n in traversed_nodes]
                relationships.append(f"Execution Call Flow: {' -> '.join(node_names)}")
            full_code_nodes = select_nodes_for_full_code(graph, seed_node, traversed_nodes, question, max_full_code=4)

            for rel in relationships:
                ctx.add_text("relationships", rel, max_len=config.RAG_CONTEXT_CHAR_BUDGET // 4)

            # Priority: seed code, then the other full-code picks, then one-line metadata, then related vector hits.
            ordered = [seed_node] + [n for n in traversed_nodes if n in full_code_nodes and n != seed_node]
            metadata_only = [n for n in traversed_nodes if n not in ordered]
            for node_id in ordered:
                data = graph.G.nodes.get(node_id, {})
                code = data.get('code')
                header = f"File: {data.get('file')}\nSymbol: {data.get('name')}\nLines: {line_range(data)}\nCode:\n"
                if code and data.get('type') == 'module' and len(code) > ctx.snippet_limit:
                    ctx.add_text("snippets", f"File: {data.get('file')}\nSymbol: {data.get('name')}\n" + module_outline(graph, node_id), max_len=ctx.snippet_limit)
                elif code and ctx.add_code("snippets", header, code):
                    full_code_shown.add(node_id)
                else:
                    metadata_only.append(node_id)
            for node_id in metadata_only:
                ctx.add_text("snippets", metadata_line(graph.G.nodes.get(node_id, {}), node_id))

            in_traversal = set(traversed_nodes)
            extra = [h for h in hits if h["node_id"] is None or h["node_id"] not in in_traversal]
            for hit in extra[:config.RAG_MAX_EXTRA_VECTOR_HITS]:
                meta = hit["meta"]
                data = graph.G.nodes[hit["node_id"]] if hit["node_id"] else {}
                code = data.get('code') if data.get('type') in DEFINITION_TYPES else None
                file_path = data.get('file') or meta.get('file')
                header = (f"File: {file_path}\n" if file_path else "") + (f"Symbol: {data.get('name')}\n" if data else "") + f"Lines: {line_range(data or meta)}\nCode:\n"
                ctx.add_code("related", header, code or hit["doc"])

    if traversed_nodes:
        cited_nodes = list(traversed_nodes)
    else:
        for hit in hits:
            meta = hit["meta"]
            node_id = hit["node_id"]
            node_data = graph.G.nodes[node_id] if graph and node_id else {}
            shown = ctx.add_code("snippets", f"File: {meta.get('file')}\nLines: {line_range(node_data or meta)}\nCode:\n", hit["doc"])
            if shown and node_id:
                # Cite only verified graph entities whose code is really in the prompt.
                cited_nodes.append(node_id)
                full_code_shown.add(node_id)

            if graph and node_id:
                callers = [graph.G.nodes[nid].get('name', nid) for nid in graph.get_callers(node_id)]
                callees = [graph.G.nodes[nid].get('name', nid) for nid in graph.get_callees(node_id)]
                symbol_name = meta.get('name', node_id)
                if callers:
                    ctx.add_text("relationships", f"Functions that call '{symbol_name}': {', '.join(callers)}", max_len=2000)
                if callees:
                    ctx.add_text("relationships", f"'{symbol_name}' calls these functions: {', '.join(callees)}", max_len=2000)

    system_prompt="""
You are RepoGraph, an AI assistant for understanding software repositories.

Your task is to answer questions about the repository using ONLY the repository
context provided to you in the prompt.

The context may contain source-code snippets, file paths, symbols, and structural
relationships extracted from the repository's knowledge graph and semantic
retrieval system.

Rules:

1. Treat the provided repository context as the authoritative source for
repository-specific claims.

2. Do not invent files, functions, classes, variables, relationships, behavior,
or implementation details that are not supported by the provided context.

3. You may use your general programming knowledge to explain what the provided
code is doing, but clearly distinguish general explanations from facts about
this repository.

4. When the retrieved context is insufficient to answer the question reliably,
say so explicitly. Do not fill missing repository information with guesses.

5. When possible, identify the relevant file, class, function, or module in your
answer so that the developer can locate the information in the repository.

6. When relationships such as CALLS, IMPORTS, DEFINES, CONTAINS, or INHERITS are
provided, use them to explain how the relevant parts of the codebase are
connected.

7. Prefer precise technical explanations over vague summaries.

8. Do not modify code or propose that code exists when it is not present in the
supplied repository context.

9. If multiple pieces of context appear relevant but provide conflicting
information, explicitly mention the conflict rather than silently choosing
one.

10. Structure your answer appropriately for the question. For a simple lookup,
    answer directly. For an architectural question, explain the relevant
    components and their relationships.
    
You must distinguish between:

1. FACTS DIRECTLY SUPPORTED BY THE PROVIDED REPOSITORY CONTEXT.
2. GENERAL PROGRAMMING KNOWLEDGE.

For repository-specific claims, do not rely on your pretrained knowledge
when the relevant source is absent from the provided context.

If a required file, symbol, implementation, or relationship is not present
in the provided context, explicitly state that it could not be verified.

Do not reconstruct missing repository code from general knowledge.

If general knowledge would help explain a missing concept, label it
explicitly as general knowledge and do not present it as evidence from
the repository.
    """
    related = ctx.render("related")
    related_block = f"""
    <semantically_related>
    {related}
    </semantically_related>
    """ if related else ""
    user_prompt=f"""User Question: {question}

    <code_snippets>
    {ctx.render("snippets")}
    </code_snippets>

    <graph_relationships>
    {ctx.render("relationships")}
    </graph_relationships>
    {related_block}"""
    provider = get_llm_provider()
    answer_text = provider.generate_response(system_prompt, user_prompt)
    if not isinstance(answer_text, str) or not answer_text.strip():
        raise LLMEmptyResponse()
    sources = []
    for n in cited_nodes:
        data = graph.G.nodes.get(n, {})
        sources.append({
            "symbol": data.get("name", n),
            "file": data.get("file"),
            "lines": line_range(data),
            "hydrated": "full_code" if n in full_code_shown else "metadata"
        })
    return {
        "answer": answer_text,
        "seed_symbol": graph.G.nodes[seed_node].get("name", seed_node) if seed_node and graph.G.has_node(seed_node) else None,
        "traversal_direction": traversal_dir,
        "traversed_path": [graph.G.nodes[n].get("name", n) for n in cited_nodes],
        "sources": sources
    }