import logging
import os
from app import config
from app.github.repo_ref import checkout_path, validate_repo_id
from app.graph import manifest
from app.graph.registry import store_graph
from app.graph.resolver import link
from app.graph.store import RepoGraph
from app.parser.extractor import extract_entities
from app.parser.python_parser import parse_python_file
from app.graph.vector_store import index_entities

log = logging.getLogger(__name__)

# Never traversed, at any depth.
EXCLUDED_DIRS = {
    ".git", ".hg", ".svn", "venv", ".venv", "site-packages", "node_modules", "__pycache__",
    ".tox", ".nox", ".eggs", ".mypy_cache", ".pytest_cache",
}
# Excluded only at the repository root (a package named `build` can legitimately live deeper, e.g. src/build).
ROOT_EXCLUDED_DIRS = {"build", "dist"}


def iter_python_files(repo_path):
    """Yield absolute paths of *.py files, pruning excluded directories without descending into them."""
    for dirpath, dirnames, filenames in os.walk(repo_path, followlinks=False):
        at_root = os.path.abspath(dirpath) == os.path.abspath(repo_path)
        dirnames[:] = sorted(
            d for d in dirnames
            if d not in EXCLUDED_DIRS
            and not (at_root and d in ROOT_EXCLUDED_DIRS)
            and not os.path.isfile(os.path.join(dirpath, d, "pyvenv.cfg"))
        )
        for name in sorted(filenames):
            if name.endswith(".py"):
                yield os.path.join(dirpath, name)


def _inside(root, path):
    try:
        return os.path.commonpath([os.path.realpath(root), os.path.realpath(path)]) == os.path.realpath(root)
    except ValueError:
        return False


class IndexLimitExceeded(Exception):
    """The checkout has more Python files or bytes than INDEX_MAX_FILES / INDEX_MAX_TOTAL_BYTES. The message is user-facing."""


def check_workload(repo_path):
    """Raise IndexLimitExceeded before any parsing if the checkout is over the file-count or total-size cap."""
    files = 0
    total = 0
    for file_path in iter_python_files(repo_path):
        files += 1
        if files > config.INDEX_MAX_FILES:
            raise IndexLimitExceeded(f"Repository has more than {config.INDEX_MAX_FILES} Python files; indexing was not started.")
        try:
            total += os.path.getsize(file_path)
        except OSError:
            continue
        if total > config.INDEX_MAX_TOTAL_BYTES:
            raise IndexLimitExceeded(f"Python files exceed {config.INDEX_MAX_TOTAL_BYTES} bytes in total; indexing was not started.")


def build_graph(owner, repo_name):
    """Parse the checkout into a graph. Returns (graph, entities, report); one bad file never aborts the run.

    report = {"parsed": int, "skipped": [{"path": <repo-relative>, "reason": <short code>}]}
    Raises IndexLimitExceeded before parsing when the checkout is over the workload caps.
    """
    repo_path = checkout_path(validate_repo_id(owner, repo_name))
    check_workload(repo_path)
    repo_graph = RepoGraph()
    all_entities = []
    all_relationships = []
    parsed = 0
    skipped = []

    def skip(file_path, reason):
        rel = os.path.relpath(file_path, repo_path).replace("\\", "/")
        skipped.append({"path": rel, "reason": reason})
        log.warning("Skipping %s in %s/%s: %s", rel, owner, repo_name, reason)

    for file_path in iter_python_files(repo_path):
        if not _inside(repo_path, file_path):
            skip(file_path, "outside_repo")
            continue
        try:
            if os.path.getsize(file_path) > config.INDEX_MAX_FILE_BYTES:
                skip(file_path, "too_large")
                continue
        except OSError as e:
            skip(file_path, f"parse_error:{type(e).__name__}")
            continue
        try:
            tree = parse_python_file(file_path)
        except Exception as e:
            skip(file_path, f"parse_error:{type(e).__name__}")
            continue
        try:
            entities, relationships = extract_entities(tree, str(file_path))
        except Exception as e:  # includes RecursionError from deeply nested code
            skip(file_path, f"extract_error:{type(e).__name__}")
            continue
        parsed += 1
        for entity in entities:
            repo_graph.add_entity(entity)
        all_entities.extend(entities)
        all_relationships.extend(relationships)

    link(repo_graph, all_relationships, repo_path)

    return repo_graph, all_entities, {"parsed": parsed, "skipped": skipped}


def process_repo(owner, repo_name):
    """Build the graph and embed its entities. Does not persist the graph (see index_repo)."""
    repo_graph, all_entities, _ = build_graph(owner, repo_name)
    index_entities(owner, repo_name, all_entities)
    return repo_graph


def index_repo(owner, repo_name, refreshed_from=None):
    """Build, index vectors and persist the graph, recording an index manifest around the writes.

    The manifest is written as state 'indexing' before any store changes and as 'complete' only after the
    vectors and the pickle both succeeded, so an interrupted run is detectable (index_status -> 'incomplete').
    """
    repo_graph, all_entities, report = build_graph(owner, repo_name)
    repo_path = checkout_path(validate_repo_id(owner, repo_name))
    pending = manifest.begin_manifest(owner, repo_name, repo_path, report, refreshed_from=refreshed_from)
    vector_result = index_entities(owner, repo_name, all_entities)
    store_graph(owner, repo_name, repo_graph)
    manifest.complete_manifest(owner, repo_name, pending, repo_graph, vector_result)
    return repo_graph
