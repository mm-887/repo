import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app import config
from app.github.repo_ref import InvalidRepoError
from app.github.sync import CloneFailed, RepoAlreadyExists, SuspiciousCheckout, clone_repo
from mcp.server.mcpserver import MCPServer
from app.graph.vector_store import search
from app.graph.registry import get_graph
from app.graph.store import ambiguity_detail, symbol_candidates
from app.llm.interface import LLMError
from app.rag.engine import answer_question

mcp = MCPServer("RepoGraph")

def _single_symbol(graph, owner: str, repo_name: str, symbol: str):
    matches = graph.find_symbols(symbol)
    if not matches:
        return None, {"error": "Function not found"}
    if len(matches) > 1:
        return None, {
            "error": ambiguity_detail(graph, symbol, matches, owner, repo_name),
            "candidates": symbol_candidates(graph, matches, owner, repo_name),
        }
    return matches[0], None

@mcp.tool()
def repo_clone(repo_url: str) -> dict:
    try:
        full_path, owner, repo_name = clone_repo(repo_url)
    except InvalidRepoError as e:
        return {"error": str(e)}
    except RepoAlreadyExists as e:
        return {"error": f"{e.ref.owner}/{e.ref.repo} is already cloned; use the HTTP API to re-index it."}
    except SuspiciousCheckout as e:
        return {"error": f"{e.ref.owner}/{e.ref.repo} exists in repository storage but is not a valid git checkout; remove it manually and retry."}
    except CloneFailed as e:
        return {"error": str(e)}
    return {
        "message": "Repository cloned successfully",
        "full_path": full_path,
        "owner": owner,
        "repo_name": repo_name,
    }

@mcp.tool()
def repo_search_symbols(owner:str, repo_name:str, query:str, limit:int = 5) -> dict:
    if not query.strip():
        return {"error": "query must not be empty."}
    if len(query) > config.MAX_QUESTION_CHARS:
        return {"error": f"query is too long ({len(query)} characters; the limit is {config.MAX_QUESTION_CHARS})."}
    limit = max(1, min(limit, config.MCP_MAX_SEARCH_RESULTS))
    return search(owner, repo_name, query, n_results=limit)

@mcp.tool()
def repo_trace_call_flow(owner:str, repo_name:str, symbol:str) -> dict:
    graph = get_graph(owner, repo_name)
    if not graph:
        return {"error": "Graph not found"}
    node_id, error = _single_symbol(graph, owner, repo_name, symbol)
    if error:
        return error
    path = graph.bfs(node_id, max_depth = 3, max_nodes=20, direction="out")
    nodes = [graph.G.nodes[nid].get('name', nid) for nid in path if nid != node_id] if path else []
    return {"seed": symbol, "call_flow":nodes}
    
@mcp.tool()
def repo_find_callers_and_subclasses(owner:str, repo_name:str, symbol:str) -> dict:
    graph = get_graph(owner, repo_name)
    if not graph:
        return {"error": "Graph not found"}
    node_id, error = _single_symbol(graph, owner, repo_name, symbol)
    if error:
        return error
    path = graph.bfs(node_id, max_depth = 3, max_nodes=20, direction="in")
    nodes = [graph.G.nodes[nid].get('name', nid) for nid in path if nid != node_id] if path else []
    return {"seed": symbol, "callers_and_subclasses":nodes}

@mcp.tool()
def repo_ask(owner:str, repo_name:str, question:str) -> dict:
    if not question.strip():
        return {"error": "question must not be empty."}
    if len(question) > config.MAX_QUESTION_CHARS:
        return {"error": f"question is too long ({len(question)} characters; the limit is {config.MAX_QUESTION_CHARS})."}
    try:
        result = answer_question(owner, repo_name, question)
    except LLMError as e:
        return {"error": e.message}
    if isinstance(result,str):
        return {"answer": result}
    return result

if __name__ == "__main__":
    mcp.run(transport="stdio")