import os
import math
from app import config
from fastapi import HTTPException
from app.graph.registry import get_graph
from fastapi import FastAPI, Query as QueryParam, Request
from fastapi.responses import JSONResponse
from app.github.repo_ref import InvalidRepoError, checkout_path, parse_repo_url, validate_repo_id
from app.github.repo_lock import RepoBusy, repo_operation
from app.github.sync import (
    clone_repo, refresh_checkout, rollback_checkout, CloneFailed, RefreshFailed, RefreshRefused, RepoAlreadyExists,
    SuspiciousCheckout,
)
from pydantic import BaseModel
from app.parser.pipeline import IndexLimitExceeded, index_repo
from app.graph import manifest
from app.graph.vector_store import search
from app.graph.store import ambiguity_detail, display_path, node_detail
from app.github.source_files import SourceNotFound, SourceNotText, SourcePathError, read_source
from app.llm.interface import LLMError, LLMQuotaExceeded
from app.rag.engine import answer_question
import networkx as nx
from fastapi.middleware.cors import CORSMiddleware

class RepoUrl(BaseModel):
    repo_url: str
class Query(BaseModel):
    question: str

app = FastAPI(title="RepoGraph", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def _host_name(host_header: str) -> str:
    host = host_header.strip().lower()
    if host.startswith("["):
        return host[1:].split("]", 1)[0]
    return host.rsplit(":", 1)[0] if host.count(":") == 1 else host

@app.middleware("http")
async def request_forgery_guard(request: Request, call_next):
    if _host_name(request.headers.get("host", "")) not in [h.lower() for h in config.ALLOWED_HOSTS]:
        return JSONResponse(status_code=400, content={"detail": "Host not allowed."})
    origin = request.headers.get("origin")
    if request.method not in ("GET", "HEAD", "OPTIONS") and origin is not None and origin not in config.ALLOWED_ORIGINS:
        return JSONResponse(status_code=403, content={"detail": "Cross-origin request rejected."})
    return await call_next(request)


def _check_text(value: str, limit: int, field: str, allow_empty: bool = False) -> str:
    if not allow_empty and not value.strip():
        raise HTTPException(status_code=400, detail=f"{field} must not be empty.")
    if len(value) > limit:
        raise HTTPException(status_code=400, detail=f"{field} is too long ({len(value)} characters; the limit is {limit}).")
    return value


@app.get("/")
async def root():
    return {"message": "Hello World", "status": "running", "app": "RepoGraph"}
@app.exception_handler(InvalidRepoError)
async def invalid_repo_handler(request: Request, exc: InvalidRepoError):
    return JSONResponse(status_code=400, content={"detail": str(exc)})

@app.exception_handler(RepoBusy)
async def repo_busy_handler(request: Request, exc: RepoBusy):
    return JSONResponse(
        status_code=409,
        content={"detail": f"{exc.ref.owner}/{exc.ref.repo} is already being cloned or indexed; wait for it to finish and try again."},
    )

@app.exception_handler(IndexLimitExceeded)
async def index_limit_handler(request: Request, exc: IndexLimitExceeded):
    return JSONResponse(status_code=413, content={"detail": str(exc)})

@app.exception_handler(LLMError)
async def llm_error_handler(request: Request, exc: LLMError):
    status = 429 if isinstance(exc, LLMQuotaExceeded) else 500
    return JSONResponse(status_code=status, content={"detail": exc.message})

@app.post("/repos/clone")
def clone_repo_endpoint(repo: RepoUrl):
    ref = parse_repo_url(repo.repo_url)
    with repo_operation(ref):
        try:
            full_path, owner, repo_name = clone_repo(repo.repo_url)
        except RepoAlreadyExists as e:
            full_path, owner, repo_name = e.path, e.ref.owner, e.ref.repo
        except SuspiciousCheckout as e:
            raise HTTPException(
                status_code=409,
                detail=f"{e.ref.owner}/{e.ref.repo} exists in repository storage but is not a valid git checkout; remove it manually and retry.",
            )
        except CloneFailed as e:
            raise HTTPException(status_code=500, detail=str(e))
        except InvalidRepoError:
            raise
        except Exception:
            raise HTTPException(status_code=500, detail="Clone failed")

        graph = index_repo(owner, repo_name)
    return {
        "message": "Repo cloned successfully", 
        "full_path": full_path, 
        "owner": owner, 
        "repo_name": repo_name,
        "graph": {
            "nodes": graph.G.number_of_nodes(),
            "edges": graph.G.number_of_edges()
        }
    }
@app.get("/repos/{owner}/{repo_name}/query")
async def query_endpoint(owner: str, repo_name: str, function_name: str):
    validate_repo_id(owner, repo_name)
    _check_text(function_name, config.MAX_SYMBOL_CHARS, "function_name")
    graph = get_graph(owner, repo_name)
    if not graph:
        raise HTTPException(status_code=404, detail="Repo not found")
    matches = graph.find_symbols(function_name)
    if not matches:
        raise HTTPException(status_code=404, detail="Function not found")
    if len(matches) > 1:
        raise HTTPException(status_code=409, detail=ambiguity_detail(graph, function_name, matches, owner, repo_name))
    node_id = matches[0]
    callers= [graph.G.nodes[nid].get('name', nid) for nid in graph.get_callers(node_id)]
    callees = [graph.G.nodes[nid].get('name', nid) for nid in graph.get_callees(node_id)]
    return {
            "function": function_name,
            "callers": callers,
            "callees": callees,
            "node_id": node_id,
        }
    
@app.post("/repos/{owner}/{repo_name}/index")
def index_repo_endpoint(owner: str, repo_name: str, refresh: bool = True):
    ref = validate_repo_id(owner, repo_name)
    with repo_operation(ref):
        path = checkout_path(ref)
        if not os.path.exists(path):
            raise HTTPException(status_code=404, detail="Repo not found")
        refreshed = None
        if refresh:
            try:
                refreshed = refresh_checkout(ref)
            except RefreshRefused as e:
                raise HTTPException(status_code=409, detail=str(e))
            except RefreshFailed as e:
                raise HTTPException(status_code=500, detail=str(e))
            moved = refreshed["changed"]
            try:
                graph = index_repo(owner, repo_name, refreshed_from=refreshed["previous"] if moved else None)
            except BaseException:
                # Keep the checkout in step with the still-stored previous index.
                if moved:
                    rollback_checkout(ref, refreshed["previous"])
                raise
        else:
            graph = index_repo(owner, repo_name)
        commit_sha = manifest.get_commit_sha(path)
    result = {
        "message": "Repo indexed successfully",
        "owner": owner,
        "repo_name": repo_name,
        "graph": {
            "nodes": graph.G.number_of_nodes(),
            "edges": graph.G.number_of_edges()
        },
        "commit_sha": commit_sha,
    }
    if refreshed is not None:
        result["refresh"] = refreshed
    return result

@app.get("/repos/{owner}/{repo_name}/search")
def search_endpoint(owner: str, repo_name: str, query: str):
    validate_repo_id(owner, repo_name)
    _check_text(query, config.MAX_QUESTION_CHARS, "query")
    results = search(owner, repo_name, query)
    if not results:
        raise HTTPException(status_code=404, detail="No results found")
    return results
    
@app.post("/repos/{owner}/{repo_name}/ask")
def ask_endpoint(owner: str, repo_name: str, query: Query):
    validate_repo_id(owner, repo_name)
    _check_text(query.question, config.MAX_QUESTION_CHARS, "question")
    result = answer_question(owner, repo_name, query.question)
    if not result:
        raise HTTPException(status_code=404, detail="Could not answer question")
    if isinstance(result, str):
        return {"answer": result}
    return result

@app.get("/repos/{owner}/{repo_name}/debug")
def debug_endpoint(owner: str, repo_name: str, question: str = ""):
    from app.rag.engine import question_direction, resolve_seed_node
    validate_repo_id(owner, repo_name)
    _check_text(question, config.MAX_QUESTION_CHARS, "question", allow_empty=True)
    graph = get_graph(owner, repo_name)
    if not graph:
        return {"error": "Graph not loaded. Re-index first."}
    
    call_edges = [(u, v) for u, v, d in graph.G.edges(data=True) if d.get('type') == 'calls']
    sample_edges = [
        {"from": graph.G.nodes[u].get('name', u), "to": graph.G.nodes[v].get('name', v)}
        for u, v in call_edges[:20]
    ]
    
    result = {
        "nodes": graph.G.number_of_nodes(),
        "edges": graph.G.number_of_edges(),
        "call_edges": len(call_edges),
        "sample_call_edges": sample_edges,
        "name_index_size": len(graph.name_index),
        "sample_names": list(graph.name_index.keys())[:20],
        "index": manifest.index_status(owner, repo_name, graph),
    }
    
    if question:
        vector_res = search(owner, repo_name, question, n_results=5)
        seed = resolve_seed_node(graph, question, vector_res, checkout_path(validate_repo_id(owner, repo_name)))
        seed_name = graph.G.nodes[seed].get('name') if seed else None
        traversal_dir = question_direction(question)
        bfs_result = graph.bfs(seed, max_depth=4, max_nodes=15, direction=traversal_dir) if seed else []
        bfs_names = [graph.G.nodes[n].get('name', n) for n in bfs_result] if bfs_result else []
        result["seed_node_id"] = seed
        result["seed_node_name"] = seed_name
        result["bfs_path"] = bfs_names
        result["traversal_direction"] = traversal_dir
    
    return result

def _spiral_positions(G):
    n = max(G.number_of_nodes(), 1)
    golden_angle = math.pi * (3 - math.sqrt(5))
    return {
        node: (math.sqrt((i + 0.5) / n) * math.cos(i * golden_angle), math.sqrt((i + 0.5) / n) * math.sin(i * golden_angle))
        for i, node in enumerate(G.nodes)
    }

@app.get("/repos/{owner}/{repo_name}/graph")
def get_graph_visual(owner: str, repo_name: str, layout: bool = False):
    validate_repo_id(owner, repo_name)
    graph = get_graph(owner, repo_name)
    if not graph:
        raise HTTPException(status_code=404, detail="Repo not found. Please clone it first.")

    pos = nx.spring_layout(graph.G, k=0.5, iterations=50) if layout else _spiral_positions(graph.G)

    nodes = []
    for node_id, attrs in graph.G.nodes(data=True):
        nodes.append({
            "id": str(node_id),
            "data": {
                "label": attrs.get('name', str(node_id)),
                "type": attrs.get('type', 'module')
            },
            "position": { "x": pos[node_id][0] * 1000, "y": pos[node_id][1] * 1000 }
        })
    edges = []
    for u, v, attrs in graph.G.edges(data=True):
        edges.append({
            "id": f"e{u}-{v}",
            "source": str(u),
            "target": str(v),
            "type": attrs.get('type'),
            "animated": attrs.get('type') == 'calls',
            "style": { "stroke": "#2dd4bf" if attrs.get('type') == 'calls' else "#3f3f46" }
        })
        
    return {
        "nodes": nodes,
        "edges": edges
    }
