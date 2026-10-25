import json
import logging
import uuid
from datetime import datetime, timezone

from app.graph.registry import _get_graph_path, atomic_write
from app.graph.store import GRAPH_SCHEMA_VERSION

log = logging.getLogger(__name__)

MANIFEST_VERSION = 1
MAX_SKIPPED_RECORDED = 200

def manifest_path(owner, repo_name):
    return _get_graph_path(owner, repo_name)[: -len(".pickle")] + ".manifest.json"

def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")

def get_commit_sha(repo_path):
    try:
        from git import Repo
        return Repo(repo_path).head.commit.hexsha
    except Exception:
        return None

def read_manifest(owner, repo_name):
    try:
        with open(manifest_path(owner, repo_name), "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None

def write_manifest(owner, repo_name, data):
    atomic_write(manifest_path(owner, repo_name), lambda f: json.dump(data, f, indent=2), mode="w")

def begin_manifest(owner, repo_name, repo_path, report, refreshed_from=None):
    skipped = report.get("skipped", [])
    data = {
        "manifest_version": MANIFEST_VERSION,
        "graph_schema_version": GRAPH_SCHEMA_VERSION,
        "state": "indexing",
        "index_id": uuid.uuid4().hex,
        "started_at": now_iso(),
        "completed_at": None,
        "commit_sha": get_commit_sha(repo_path),
        "refreshed_from": refreshed_from,
        "graph": None,
        "vectors": None,
        "files": {"parsed": report.get("parsed", 0), "skipped": len(skipped)},
        "skipped_files": skipped[:MAX_SKIPPED_RECORDED],
    }
    write_manifest(owner, repo_name, data)
    return data

def complete_manifest(owner, repo_name, data, graph, vector_result):
    data = dict(data)
    data["state"] = "complete"
    data["completed_at"] = now_iso()
    data["graph"] = {"nodes": graph.G.number_of_nodes(), "edges": graph.G.number_of_edges()}
    data["vectors"] = vector_result
    write_manifest(owner, repo_name, data)
    return data

def index_status(owner, repo_name, graph=None):
    m = read_manifest(owner, repo_name)
    if m is None:
        return {"status": "legacy", "state": None, "commit_sha": None, "indexed_at": None,
                "graph_schema_version": None, "files_parsed": None, "files_skipped": None}
    files = m.get("files") or {}
    if m.get("state") != "complete":
        status = "incomplete"
    elif m.get("graph_schema_version") != GRAPH_SCHEMA_VERSION:
        status = "schema_mismatch"
    elif graph is not None and m.get("graph") != {"nodes": graph.G.number_of_nodes(), "edges": graph.G.number_of_edges()}:
        status = "graph_mismatch"
    else:
        status = "consistent"
    return {
        "status": status,
        "state": m.get("state"),
        "commit_sha": m.get("commit_sha"),
        "indexed_at": m.get("completed_at"),
        "graph_schema_version": m.get("graph_schema_version"),
        "files_parsed": files.get("parsed"),
        "files_skipped": files.get("skipped"),
    }