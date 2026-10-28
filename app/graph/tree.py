from app.graph.store import display_path

ROLLUP_KEYS = ("loc", "tokens", "total_complexity")


def _empty_rollup():
    return {"files": 0, "loc": 0, "tokens": 0, "total_complexity": 0, "max_complexity": 0}


def _file_entry(name, path, node_id, metrics):
    return {"name": name, "path": path, "type": "file", "node_id": node_id, "metrics": metrics or None}


def _add_file(rollup, metrics):
    rollup["files"] += 1
    if not metrics:
        return
    for key in ROLLUP_KEYS:
        rollup[key] += int(metrics.get(key) or 0)
    rollup["max_complexity"] = max(rollup["max_complexity"], int(metrics.get("max_complexity") or 0))


def _finish(folder):
    children = folder.pop("_children")
    for child in children.values():
        if child["type"] == "dir":
            _finish(child)
            for key in ROLLUP_KEYS + ("files",):
                folder["rollup"][key] += child["rollup"][key]
            folder["rollup"]["max_complexity"] = max(folder["rollup"]["max_complexity"], child["rollup"]["max_complexity"])
        else:
            _add_file(folder["rollup"], child["metrics"])
    ordered = sorted(children.values(), key=lambda c: (c["type"] != "dir", c["name"].lower(), c["name"]))
    folder["children"] = ordered


def build_tree(graph, owner: str, repo: str) -> dict:
    root = {"name": repo, "path": "", "type": "dir", "rollup": _empty_rollup(), "_children": {}}
    seen = set()
    for node_id, data in graph.G.nodes(data=True):
        if data.get("type") != "module" or not data.get("file"):
            continue
        path = display_path(data["file"], owner, repo)
        if not path or path in seen:
            continue
        seen.add(path)
        parts = path.split("/")
        folder = root
        for i, part in enumerate(parts[:-1]):
            sub = folder["_children"].get(part)
            if sub is None or sub["type"] != "dir":
                sub = {"name": part, "path": "/".join(parts[: i + 1]), "type": "dir", "rollup": _empty_rollup(), "_children": {}}
                folder["_children"][part] = sub
            folder = sub
        folder["_children"][parts[-1]] = _file_entry(parts[-1], path, str(node_id), data.get("metrics"))
    _finish(root)
    return root
