from collections import deque
import networkx as nx

GRAPH_SCHEMA_VERSION = 3

MAX_CANDIDATES = 10


def display_path(file, owner: str = None, repo: str = None):
    """Repo-relative path for a stored absolute file path, so errors do not expose the server's layout."""
    if not file or not owner or not repo:
        return file
    path = str(file).replace('\\', '/')
    for marker in (f"/repositories/{owner}/{repo}/", f"/{owner}/{repo}/"):
        head, found, tail = path.partition(marker)
        if found and tail:
            return tail
    return path.rsplit('/', 1)[-1]


def symbol_candidates(graph, matches: list, owner: str = None, repo: str = None, limit: int = MAX_CANDIDATES) -> list:
    """Describe ambiguous matches for a client: node id, qualified name, file and 1-based line (None for modules)."""
    out = []
    for node_id in matches[:limit]:
        data = graph.G.nodes.get(node_id, {})
        start = data.get('start_line')
        out.append({
            "node_id": node_id,
            "name": data.get('name', node_id),
            "file": display_path(data.get('file'), owner, repo),
            "line": start + 1 if isinstance(start, int) and data.get('type') != 'module' else None,
        })
    return out


def ambiguity_detail(graph, name: str, matches: list, owner: str = None, repo: str = None) -> str:
    shown = []
    for c in symbol_candidates(graph, matches, owner, repo):
        where = f"{c['file']} line {c['line']}" if c['line'] is not None else f"{c['file']}"
        shown.append(f"{c['name']} ({where})")
    more = f", and {len(matches) - len(shown)} more" if len(matches) > len(shown) else ""
    return f"'{name}' is ambiguous: {len(matches)} matches: " + "; ".join(shown) + more + ". Pass a qualified name (for example Class.method) or a node id."


def _node_label(G, node_id, owner, repo):
    data = G.nodes[node_id]
    if data.get('type') == 'module' and data.get('file'):
        return display_path(data['file'], owner, repo)
    return data.get('name', node_id)


def _edge_has_kind(edge, kind):
    return kind in (edge.get('kinds') or [edge.get('type')])


def node_detail(graph, node_id, owner: str = None, repo: str = None) -> dict:
    G = graph.G
    data = G.nodes[node_id]
    start, end = data.get('start_line'), data.get('end_line')
    has_lines = isinstance(start, int) and isinstance(end, int)

    def ref(other):
        return {"id": other, "name": _node_label(G, other, owner, repo)}

    imports = []
    for target in G.successors(node_id):
        edge = G.edges[node_id, target]
        if _edge_has_kind(edge, 'imports'):
            imports.append({"target": target, "name": _node_label(G, target, owner, repo), "names": list(edge.get('names', []))})
    imported_by = []
    for source in G.predecessors(node_id):
        edge = G.edges[source, node_id]
        if _edge_has_kind(edge, 'imports'):
            imported_by.append({"source": source, "name": _node_label(G, source, owner, repo), "names": list(edge.get('names', []))})

    def ordered(items):
        return sorted(items, key=lambda item: (item["name"], item.get("target") or item.get("source") or item["id"]))

    return {
        "id": node_id,
        "name": _node_label(G, node_id, owner, repo),
        "type": data.get('type', 'module'),
        "file": display_path(data.get('file'), owner, repo) if data.get('file') else None,
        "start_line": start + 1 if has_lines else None,
        "end_line": end + 1 if has_lines else None,
        "metrics": data.get('metrics'),
        "imports": ordered(imports),
        "imported_by": ordered(imported_by),
        "callers": ordered([ref(n) for n in graph.get_callers(node_id)]),
        "callees": ordered([ref(n) for n in graph.get_callees(node_id)]),
    }


class RepoGraph:
    def __init__(self):
        self.G = nx.DiGraph()
        self.name_index = {}

    def add_entity(self, entity):
        self.G.add_node(entity['id'], **entity)
        self.name_index.setdefault(entity['name'], []).append(entity['id'])
        if entity.get('type') == 'module':
            import os
            basename = os.path.basename(entity['name'])
            stem = os.path.splitext(basename)[0]
            for alias in (basename, stem):
                if alias != entity['name']:
                    self.name_index.setdefault(alias, []).append(entity['id'])

    def find_symbols(self, name: str) -> list:
        """Every node a user-supplied symbol could mean, without picking one.

        An exact node id wins, then an exact name_index hit. A dotted name with no exact hit also matches
        names ending in ".<name>" (so `Inner.run` finds `Outer.Inner.run`).
        """
        if not name:
            return []
        if self.G.has_node(name):
            return [name]
        if name in self.name_index:
            return list(dict.fromkeys(self.name_index[name]))
        if '.' in name:
            suffix = f".{name}"
            found = []
            for indexed_name, ids in self.name_index.items():
                if indexed_name.endswith(suffix):
                    found.extend(ids)
            return list(dict.fromkeys(found))
        return []

    def get_callers(self, func_name):
        return [n for n in self.G.predecessors(func_name) if self.G.edges[n, func_name].get('type') == 'calls']

    def get_callees(self, func_name):
        return [n for n in self.G.successors(func_name) if self.G.edges[func_name, n].get('type') == 'calls']

    def bfs(self, seed_node, max_depth:int = 3, max_nodes:int = 20, direction:str = "out"):
        if not self.G.has_node(seed_node):
            return None
        ordered_nodes = [seed_node]
        visited = {seed_node}
        q = deque([(seed_node,0)])
        while q and len(visited) < max_nodes:
            curr_node,depth = q.popleft()
            if depth >= max_depth:
                continue
            if direction == 'in':
                neighbors = [(n, self.G.get_edge_data(n, curr_node)) for n in self.G.predecessors(curr_node)]
            elif direction == 'out':
                neighbors = [(n, self.G.get_edge_data(curr_node, n)) for n in self.G.successors(curr_node)]
            for neighbor,edge_data in neighbors:
                if edge_data and edge_data.get('type') in ('calls', 'inherits', 'defines'):
                    if neighbor not in visited:
                        visited.add(neighbor)
                        ordered_nodes.append(neighbor)
                        q.append((neighbor, depth + 1))
                if len(visited) >= max_nodes:
                    break
        return ordered_nodes
        