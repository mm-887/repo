from app import config
from app.github.repo_ref import validate_repo_id
import logging, os, pickle, tempfile
log = logging.getLogger(__name__)
REGISTRY = {}
_SIGNATURES = {}

def atomic_write(file_path, write_fn, mode="wb"):
    fd, tmp_path = tempfile.mkstemp(dir=os.path.dirname(file_path), suffix=".tmp")
    try:
        with os.fdopen(fd, mode) as f:
            write_fn(f)
        os.replace(tmp_path, file_path)
    except BaseException:
        try:
            os.remove(tmp_path)
        except OSError:
            pass
        raise

def _signature(file_path):
    try:
        st = os.stat(file_path)
    except OSError:
        return None
    return (st.st_mtime_ns, st.st_size)

def store_graph(owner, repo_name, graph):
    file_path = _get_graph_path(owner, repo_name)
    atomic_write(file_path, lambda f: pickle.dump(graph, f))
    key = (owner, repo_name)
    REGISTRY[key] = graph
    _SIGNATURES[key] = _signature(file_path)

def _load_pickle(file_path):
    from app.graph.store import RepoGraph
    with open(file_path, "rb") as f:
        graph = pickle.load(f)
    if not isinstance(graph, RepoGraph):
        raise TypeError(f"unexpected object in graph pickle: {type(graph).__name__}")
    return graph

def _warn_if_inconsistent(owner, repo_name, graph):
    from app.graph import manifest
    try:
        status = manifest.index_status(owner, repo_name, graph)
    except Exception:
        log.exception("Could not check index consistency for %s/%s", owner, repo_name)
        return
    if status["status"] not in ("consistent", "legacy"):
        log.warning("Index for %s/%s is %s (manifest state: %s)", owner, repo_name, status["status"], status.get("state"))

def get_graph(owner, repo_name):
    key = (owner, repo_name)
    file_path = _get_graph_path(owner, repo_name)
    cached = REGISTRY.get(key)
    if cached is not None:
        sig = _signature(file_path)
        if sig is None or sig == _SIGNATURES.get(key):
            return cached
        try:
            graph = _load_pickle(file_path)
        except Exception:
            log.exception("Could not reload graph %s/%s; keeping the cached graph", owner, repo_name)
            _SIGNATURES[key] = sig  
            return cached
        REGISTRY[key] = graph
        _SIGNATURES[key] = sig
        _warn_if_inconsistent(owner, repo_name, graph)
        return graph
    if os.path.exists(file_path):
        sig = _signature(file_path)
        graph = _load_pickle(file_path)
        REGISTRY[key] = graph
        _SIGNATURES[key] = sig
        _warn_if_inconsistent(owner, repo_name, graph)
        return graph
    return None

def _get_graph_path(owner: str, repo_name: str) -> str:
    validate_repo_id(owner, repo_name)
    return os.path.join(config.GRAPHS_DIR, f"{owner}_{repo_name}.pickle")