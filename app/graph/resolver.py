import os

EDGE_PRIORITY = ("calls", "inherits", "defines", "imports")
_DEFS = ("function_definition", "class_definition")

def add_edge(G, src, dst, kind, **attrs):
    if G.has_edge(src, dst):
        data = G.edges[src, dst]
        kinds = set(data.get("kinds") or [data.get("type")])
        kinds.add(kind)
        data["kinds"] = sorted(kinds, key=EDGE_PRIORITY.index)
        data["type"] = data["kinds"][0]
        if "names" in attrs:
            data["names"] = sorted(set(data.get("names", [])) | set(attrs["names"]))
        return
    G.add_edge(src, dst, type=kind, kinds=[kind], **attrs)

def _norm(path):
    return os.path.normcase(os.path.normpath(os.path.abspath(path)))

class _Linker:
    def __init__(self, graph, relationships, repo_root):
        self.graph = graph
        self.G = graph.G
        self.root = _norm(repo_root)
        self.relationships = relationships

        self.members = {}      
        self.by_file = {}        
        self.file_of = {}        
        self.dotted_index = {}   
        self.chain = {}          
        self.prefixes = set()    
        self.dirs = set()        
        self.records = {}        
        self.bases = {}          
        self.parent = {}         
        self._bindings = {}
        self._stars = {}
        self._mro = {}
        self._module_of = {}
        self._build_indexes()

    def _build_indexes(self):
        for node_id, data in self.G.nodes(data=True):
            if data.get("type") == "module" and data.get("file"):
                f = _norm(data["file"])
                self.by_file[f] = node_id
                self.file_of[node_id] = f
                d = os.path.dirname(f)
                while d.startswith(self.root) and d not in self.dirs:
                    self.dirs.add(d)
                    d = os.path.dirname(d)
        for mid, f in self.file_of.items():
            is_init = os.path.basename(f) == "__init__.py"
            stem = os.path.splitext(os.path.basename(f))[0]
            d, parts = os.path.dirname(f), ([] if is_init else [stem])
            while os.path.join(d, "__init__.py") in self.by_file and d != os.path.dirname(d):
                parts.insert(0, os.path.basename(d))
                d = os.path.dirname(d)
            self.chain[mid] = (".".join(parts), d)
            self._register(".".join(parts), mid, d)

            rel = os.path.relpath(f, self.root).split(os.sep)
            rel[-1] = stem
            if is_init:
                rel.pop()
            self._register(".".join(rel), mid, self.root)

        for rel in self.relationships:
            kind = rel.get("type")
            if kind == "defines":
                child = self.G.nodes.get(rel["to"], {}).get("name")
                if child and self.G.has_node(rel["from"]):
                    self.members.setdefault(rel["from"], {})[child.rsplit(".", 1)[-1]] = rel["to"]  # last definition wins
                    self.parent[rel["to"]] = rel["from"]
            elif kind == "imports":
                self.records.setdefault(rel["from"], []).append(rel)

    def _register(self, dotted, mid, root):
        if not dotted:
            return
        self.dotted_index.setdefault(dotted, {})[mid] = root
        parts = dotted.split(".")
        for i in range(1, len(parts) + 1):
            self.prefixes.add(".".join(parts[:i]))

    def module_of(self, node_id):
        if node_id not in self._module_of:
            file = self.G.nodes.get(node_id, {}).get("file")
            self._module_of[node_id] = self.by_file.get(_norm(file)) if file else None
        return self._module_of[node_id]

    def lookup_module(self, dotted, importer):
        cands = self.dotted_index.get(dotted)
        if not cands:
            return None
        if len(cands) == 1:
            return next(iter(cands))
        for root in (self.chain.get(importer, (None, None))[1], self.root):
            hits = [m for m, r in cands.items() if r == root]
            if len(hits) == 1:
                return hits[0]
        return None

    def _path_submodule(self, directory, name):
        p = os.path.join(directory, name)
        mid = self.by_file.get(_norm(p + ".py")) or self.by_file.get(os.path.join(_norm(p), "__init__.py"))
        if mid:
            return ("mod", mid)
        if _norm(p) in self.dirs:
            return ("dir", _norm(p))
        return None

    def submodule(self, state, name, importer):
        kind = state[0]
        if kind == "mod":
            f = self.file_of[state[1]]
            return self._path_submodule(os.path.dirname(f), name) if os.path.basename(f) == "__init__.py" else None
        if kind == "dir":
            return self._path_submodule(state[1], name)
        if kind == "ns":
            dotted = f"{state[1]}.{name}"
            mid = self.lookup_module(dotted, importer)
            if mid:
                return ("mod", mid)
            return ("ns", dotted) if dotted in self.prefixes else None
        return None

    def lookup_in_module(self, mid, name, seen=None):
        member = self.members.get(mid, {}).get(name)
        if member:
            return ("ent", member)
        bound = self.bindings_of(mid).get(name)
        if bound:
            return bound
        seen = (seen or set()) | {mid}
        for star in self._stars.get(mid, ()):
            if star not in seen:
                found = self.lookup_in_module(star, name, seen)
                if found:
                    return found
        return None

    def mro(self, cid):
        if cid in self._mro:
            return self._mro[cid]
        self._mro[cid] = [cid]  
        bases = self.bases.get(cid, [])
        seqs = [list(self.mro(b)) for b in bases] + [list(bases)]
        out = [cid]
        seqs = [s for s in seqs if s]
        while seqs:
            for seq in seqs:
                head = seq[0]
                if not any(head in s[1:] for s in seqs):
                    break
            else:  
                out = [cid]
                for b in bases:
                    out.extend(c for c in self.mro(b) if c not in out)
                break
            out.append(head)
            seqs = [[c for c in s if c != head] for s in seqs]
            seqs = [s for s in seqs if s]
        self._mro[cid] = out
        return out

    def class_member(self, cid, name, skip_self=False):
        for c in self.mro(cid)[1 if skip_self else 0:]:
            member = self.members.get(c, {}).get(name)
            if member:
                return member
        return None

    def enclosing_class(self, node_id):
        seen = set()
        while node_id and node_id not in seen:
            seen.add(node_id)
            if self.G.nodes.get(node_id, {}).get("type") == "class_definition":
                return node_id
            node_id = self.parent.get(node_id)
        return None

    def bindings_of(self, mid):
        if mid in self._bindings:
            return self._bindings[mid]
        bindings = self._bindings[mid] = {}
        self._stars[mid] = []
        for rec in self.records.get(mid, ()):
            self._bind(mid, rec, bindings)
        return bindings

    def _import_base(self, mid, rec):
        level, dotted = rec["level"], rec["to"]
        if level == 0:
            found = self.lookup_module(dotted, mid)
            if found:
                return ("mod", found)
            return ("ns", dotted) if dotted in self.prefixes else ("ext", dotted)
        directory = os.path.dirname(self.file_of[mid])
        for _ in range(level - 1):
            directory = os.path.dirname(directory)
        state = ("dir", _norm(directory))
        init = self.by_file.get(os.path.join(_norm(directory), "__init__.py"))
        if init:
            state = ("mod", init)
        for part in dotted.split(".") if dotted else ():
            state = self.submodule(state, part, mid)
            if state is None:
                return None
        return state

    def _bind(self, mid, rec, bindings):
        name, alias = rec["name"], rec["alias"]
        if name is None:
            full = rec["to"]
            top = full.split(".")[0]
            target = full if alias else top
            found = self.lookup_module(target, mid)
            state = ("mod", found) if found else (("ns", target) if target in self.prefixes else ("ext", target))
            bindings[alias or top] = state
            edge_mod = self.lookup_module(full, mid)
            if edge_mod:
                self._import_edge(mid, edge_mod, [full])
            elif state[0] == "ext" or full not in self.prefixes:
                self._import_edge(mid, None, [full], external=full)
            return

        base = self._import_base(mid, rec)
        if base is None:
            return
        if base[0] == "ext":
            if name == "*":
                self._import_edge(mid, None, ["*"], external=base[1])
            else:
                bindings[alias or name] = ("ext", f"{base[1]}.{name}")
                self._import_edge(mid, None, [name], external=base[1])
            return
        if name == "*":
            if base[0] == "mod":
                self._stars[mid].append(base[1])
                self._import_edge(mid, base[1], ["*"])
            return
        found = self.lookup_in_module(base[1], name) if base[0] == "mod" else None
        if found is None:
            found = self.submodule(base, name, mid)
        if found:
            bindings[alias or name] = found
        target = found[1] if found and found[0] in ("ent", "mod") else (base[1] if base[0] == "mod" else None)
        if target:
            self._import_edge(mid, target, [name])

    def _import_edge(self, mid, target, names, external=None):
        if external:
            if not self.G.has_node(external):
                self.G.add_node(external, type="external_module", name=external)
            target = external
        if target and target != mid:
            add_edge(self.G, mid, target, "imports", names=sorted(names))

    def resolve_reference(self, parts, scope_id):
        mid = self.module_of(scope_id)
        if mid is None or not parts or any(not p or "<" in p for p in parts):
            return None
        first = parts[0]

        if first == "super()" and len(parts) == 2:
            cls = self.enclosing_class(scope_id)
            return self.class_member(cls, parts[1], skip_self=True) if cls else None
        if first in ("self", "cls"):  
            cls = self.enclosing_class(scope_id) if len(parts) == 2 else None
            return self.class_member(cls, parts[1]) if cls else None
        if "()" in first:
            return None

        state = self._lookup_first(first, scope_id, mid)
        for attr in parts[1:]:
            state = self._step(state, attr, mid)
            if state is None:
                return None
        return state[1] if state and state[0] == "ent" else None

    def _lookup_first(self, name, scope_id, mid):
        sid, first = scope_id, True
        seen = set()
        while sid and sid != mid and sid not in seen:
            seen.add(sid)
            is_class = self.G.nodes.get(sid, {}).get("type") == "class_definition"
            if not is_class or first:
                member = self.members.get(sid, {}).get(name)
                if member:
                    return ("ent", member)
            first = False
            sid = self.parent.get(sid)
        return self.lookup_in_module(mid, name)

    def _step(self, state, attr, importer):
        if state is None:
            return None
        kind = state[0]
        if kind == "ent":
            if self.G.nodes.get(state[1], {}).get("type") != "class_definition":
                return None
            member = self.class_member(state[1], attr)
            return ("ent", member) if member else None
        if kind == "mod":
            return self.lookup_in_module(state[1], attr) or self.submodule(state, attr, importer)
        if kind in ("dir", "ns"):
            return self.submodule(state, attr, importer)
        return None

    def link(self):
        for mid in list(self.file_of):
            self.bindings_of(mid)

        for rel in self.relationships:
            if rel.get("type") == "defines":
                if self.G.has_node(rel["from"]) and self.G.has_node(rel["to"]):
                    add_edge(self.G, rel["from"], rel["to"], "defines")

        for rel in self.relationships:
            if rel.get("type") != "inherits" or not self.G.has_node(rel["from"]):
                continue
            base = self.resolve_reference(rel["to"].split("."), self.parent.get(rel["from"]) or rel["from"])
            if base and base != rel["from"] and self.G.nodes[base].get("type") == "class_definition":
                self.bases.setdefault(rel["from"], []).append(base)
        self._mro.clear()
        for cls, bases in self.bases.items():
            for base in bases:
                add_edge(self.G, cls, base, "inherits")

        for rel in self.relationships:
            if rel.get("type") != "calls" or not self.G.has_node(rel["from"]):
                continue
            dst = self.resolve_reference(rel["to"].split("."), rel["from"])
            if dst:
                add_edge(self.G, rel["from"], dst, "calls")


def link(graph, relationships, repo_root):
    _Linker(graph, relationships, repo_root).link()