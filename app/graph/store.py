from collections import deque
import networkx as nx

GRAPH_SCHEMA_VERSION = 2

MAX_CANDIDATES = 10


def display_path(file, owner: str = None, repo: str = None):
    if not file or not owner or not repo:
        return file
    path = str(file).replace('\\', '/')
    for marker in (f"/repositories/{owner}/{repo}/", f"/{owner}/{repo}/"):
        head, found, tail = path.partition(marker)
        if found and tail:
            return tail
    return path.rsplit('/', 1)[-1]


def symbol_candidates(graph, matches: list, owner: str = None, repo: str = None, limit: int = MAX_CANDIDATES) -> list:
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