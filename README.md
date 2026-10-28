---
title: <name>
sdk: docker
app_port: 7860
---

# RepoGraph

**AI-powered code intelligence platform that turns any GitHub repository into a queryable knowledge graph.**

RepoGraph clones a GitHub repository, parses its Python source with [Tree-sitter](https://tree-sitter.github.io/tree-sitter/), builds a full call/inheritance/import graph with [NetworkX](https://networkx.org/), indexes the code into a vector store ([ChromaDB](https://www.trychroma.com/)), and exposes both a REST API and an MCP server so you can ask natural-language questions about the codebase — answered with graph-aware RAG powered by Google Gemini.

---

## Features

- **Automatic repository cloning** — provide a GitHub URL and the system shallow-clones it for indexing.
- **Tree-sitter parsing** — extracts every module, class, and function, plus call, inheritance, and import relationships.
- **Knowledge graph** — a directed graph (NetworkX `DiGraph`) with edges for `calls`, `defines`, `imports`, and `inherits`, plus full Python MRO resolution.
- **Semantic vector search** — code entities are embedded with `all-MiniLM-L6-v2` and stored in ChromaDB for similarity retrieval.
- **Graph-aware RAG** — questions are answered by combining BFS traversal of the knowledge graph with vector search results, then sending curated context to Google Gemini.
- **Interactive graph UI** — a React + TypeScript frontend renders the knowledge graph with an AI chat panel for asking questions.
- **MCP server** — exposes tools (`repo_clone`, `repo_search_symbols`, `repo_trace_call_flow`, `repo_find_callers_and_subclasses`, `repo_ask`) over the Model Context Protocol for IDE and agent integration.
- **Index manifests** — every indexing run records a JSON manifest with commit SHA, graph stats, and file-level skip reports for auditability.
- **Incremental refresh** — re-index a repo by pulling the latest commit and diffing against the previous index, with automatic rollback on failure.

---

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                      Frontend (React + Vite)                   │
│   Graph Canvas (xyflow/sigma)  ·  AI Chat Panel  ·  Toolbar    │
└────────────────────────┬───────────────────────────────────────┘
                         │  HTTP (REST)
┌────────────────────────▼───────────────────────────────────────┐
│                      FastAPI Backend                           │
│                                                                │
│  ┌──────────┐  ┌─────────┐  ┌────────┐  ┌──────┐  ┌────────┐   │
│  │ github/  │  │ parser/ │  │ graph/ │  │ rag/ │  │  llm/  │   │
│  │  clone   │  │  tree-  │  │  store │  │engine│  │ gemini │   │
│  │  sync    │──│  sitter │──│  graph │──│  RAG │──│provider│   │
│  │  refresh │  │  extract│  │  vector│  │      │  │        │   │
│  └──────────┘  └─────────┘  └────────┘  └──────┘  └────────┘   │
│                                                                │
└────────────────────────────────────────────────────────────────┘
         │                  │                    │
    Git Repos          Pickle + JSON         ChromaDB
   (data/repos)       (data/graphs)        (data/chromadb)
```

---

## Tech Stack

| Layer            | Technology                                                                         |
| ---------------- | ---------------------------------------------------------------------------------- |
| **Backend**      | Python 3.12+, FastAPI, Uvicorn                                                     |
| **Parsing**      | Tree-sitter (`tree-sitter-python`)                                                 |
| **Graph**        | NetworkX                                                                           |
| **Vector Store** | ChromaDB, Sentence Transformers (`all-MiniLM-L6-v2`)                               |
| **LLM**          | Google Gemini (`google-genai` SDK)                                                 |
| **MCP**          | `mcp` ≥ 2.0 (stdio transport)                                                      |
| **Frontend**     | React 19, TypeScript, Vite, TailwindCSS, xyflow, Sigma.js, Zustand, TanStack Query |
| **Git**          | GitPython                                                                          |

---

## Getting Started

### Prerequisites

- Python 3.12+
- Node.js 20+
- Git
- A [Google Gemini API key](https://aistudio.google.com/apikey)
- A [GitHub Personal Access Token](https://github.com/settings/tokens) (for cloning private repos; public repos work without one)

### 1. Clone the project

```bash
git clone https://github.com/mm-887/RepoGraph.git
cd RepoGraph
```

### 2. Backend setup

```bash
python -m venv venv

# Windows
venv\Scripts\activate
# macOS / Linux
source venv/bin/activate

pip install -r requirements.txt
```

### 3. Configure environment

Create a `.env` file in the project root:

```env
GITHUB_TOKEN=ghp_your_github_token
GEMINI_API_KEY=your_gemini_api_key

# Optional overrides (shown with defaults)
# GEMINI_MODEL=gemini-3-flash-preview
# INDEX_MAX_FILES=20000
# INDEX_MAX_FILE_BYTES=1048576
# INDEX_MAX_TOTAL_BYTES=104857600
# RAG_CONTEXT_CHAR_BUDGET=24000
# RAG_SNIPPET_CHAR_LIMIT=8000
# MAX_QUESTION_CHARS=2000
```

### 4. Start the backend

```bash
uvicorn app.main:app --reload
```

The API is available at `http://localhost:8000`. Interactive docs at `http://localhost:8000/docs`.

### 5. Frontend setup

```bash
cd frontend
npm install
npm run dev
```

The UI is available at `http://localhost:5173`.

---

## API Reference

### Clone & index a repository

```
POST /repos/clone
```

```json
{ "repo_url": "https://github.com/owner/repo" }
```

Clones the repository and indexes it in one step. Returns graph statistics (node/edge counts).

### Re-index a repository

```
POST /repos/{owner}/{repo}/index?refresh=true
```

Pulls the latest commit, re-parses and re-indexes. Supports automatic rollback on failure.

### Query a symbol's call graph

```
GET /repos/{owner}/{repo}/query?function_name=my_function
```

Returns the callers and callees of a specific function or method.

### Semantic search

```
GET /repos/{owner}/{repo}/search?query=database connection
```

Searches the vector store for code entities matching the query.

### Ask a question (RAG)

```
POST /repos/{owner}/{repo}/ask
```

```json
{ "question": "How does the authentication middleware work?" }
```

Returns an AI-generated answer with source citations, seed symbol, traversal path, and traversal direction.

### Get graph data (for visualization)

```
GET /repos/{owner}/{repo}/graph?layout=false
```

Returns all nodes and edges for rendering in the frontend.

### Debug endpoint

```
GET /repos/{owner}/{repo}/debug?question=optional
```

Returns internal graph stats, name index samples, index consistency, and (optionally) the seed node and BFS path for a question.

---

### Available tools

| Tool                               | Description                                              |
| ---------------------------------- | -------------------------------------------------------- |
| `repo_clone`                       | Clone and index a GitHub repository                      |
| `repo_search_symbols`              | Semantic search across indexed code entities             |
| `repo_trace_call_flow`             | BFS forward traversal from a symbol (what does it call?) |
| `repo_find_callers_and_subclasses` | BFS reverse traversal to a symbol (what calls it?)       |
| `repo_ask`                         | Ask a natural-language question about the repository     |

---

## Project Structure

```
RepoGraph/
├── app/
│   ├── main.py              # FastAPI application, routes, middleware
│   ├── config.py             # Environment config and constants
│   ├── mcp_server.py         # MCP server (stdio transport)
│   ├── github/
│   │   ├── repo_ref.py       # URL parsing, validation, path resolution
│   │   ├── repo_lock.py      # Concurrency guard (one operation per repo)
│   │   └── sync.py           # Git clone, refresh, rollback
│   ├── parser/
│   │   ├── python_parser.py  # Tree-sitter Python parser
│   │   ├── extractor.py      # AST traversal → entities & relationships
│   │   └── pipeline.py       # Indexing pipeline (parse → graph → vectors)
│   ├── graph/
│   │   ├── store.py          # RepoGraph class (NetworkX DiGraph + BFS)
│   │   ├── resolver.py       # Import/call/inheritance linker (MRO)
│   │   ├── registry.py       # In-memory graph cache + pickle persistence
│   │   ├── vector_store.py   # ChromaDB indexing and search
│   │   └── manifest.py       # Index manifest (state tracking, consistency)
│   ├── rag/
│   │   └── engine.py         # RAG engine (seed selection, context building, LLM call)
│   └── llm/
│       ├── interface.py      # Abstract LLM provider + error hierarchy
│       ├── factory.py        # Singleton provider factory
│       └── gemini_provider.py # Google Gemini implementation
├── frontend/                 # React + Vite + TypeScript
│   └── src/
│       ├── App.tsx           # Router and workspace layout
│       ├── components/
│       │   ├── graph/        # Graph canvas and toolbar
│       │   ├── agent/        # AI chat panel
│       │   ├── layout/       # Header and shell
│       │   └── common/       # Shared UI components
│       ├── api/              # Backend API client
│       ├── store/            # Zustand state management
│       ├── graph/            # Graph rendering logic
│       └── hooks/            # Custom React hooks
├── data/                     # Runtime data (gitignored)
│   ├── repositories/        # Cloned repos
│   ├── graphs/              # Pickled graph files + manifests
│   └── chromadb/            # Vector store
├── requirements.txt
├── .env                      # API keys (gitignored)
└── .gitignore
```

---

## How It Works

### 1. Parsing

When a repository is cloned or re-indexed, every `.py` file is parsed with Tree-sitter. The [extractor](app/parser/extractor.py) walks the AST and emits:

- **Entities**: modules, classes, and functions (with full source code, file path, and line ranges)
- **Relationships**: `calls`, `defines`, `imports`, `inherits`

### 2. Graph linking

The [resolver](app/graph/resolver.py) converts raw string references into resolved graph edges:

- Builds a module index (dotted paths, `__init__.py` packages)
- Resolves imports (absolute, relative, star imports, aliases)
- Resolves calls through scope chains, `self`/`cls` references, and `super()`
- Computes full C3-linearized MRO for class hierarchies
- Resolves inheritance edges to actual graph nodes

### 3. Vector indexing

Each entity is converted to a retrieval document (code + metadata) and embedded using `all-MiniLM-L6-v2` via [ChromaDB](app/graph/vector_store.py). Large entities are chunked with overlap. Stale entries from previous runs are automatically cleaned up.

### 4. RAG answering

The [RAG engine](app/rag/engine.py):

1. Runs a vector search for the question
2. Picks a **seed node** using a blended lexical + semantic score (with test-file demotion and call-count bonus)
3. Determines **traversal direction** (`out` for "how does X work" vs. `in` for "what calls X")
4. Runs BFS on the knowledge graph from the seed
5. Selects the most relevant traversed nodes for full code inclusion (embedding similarity)
6. Assembles a budgeted context (code snippets + graph relationships + related vector hits)
7. Sends the context to Gemini with a grounding system prompt
8. Returns the answer, source citations, traversal path, and seed symbol

---

## Environment Variables

| Variable                    | Default                   | Description                              |
| --------------------------- | ------------------------- | ---------------------------------------- |
| `GITHUB_TOKEN`              | —                         | GitHub PAT for cloning                   |
| `GEMINI_API_KEY`            | —                         | Google Gemini API key                    |
| `GEMINI_MODEL`              | `gemini-3-flash-preview`  | Gemini model to use                      |
| `INDEX_MAX_FILES`           | `20000`                   | Max Python files per repo                |
| `INDEX_MAX_FILE_BYTES`      | `1048576`                 | Max single file size (1 MB)              |
| `INDEX_MAX_TOTAL_BYTES`     | `104857600`               | Max total Python bytes (100 MB)          |
| `RAG_CONTEXT_CHAR_BUDGET`   | `24000`                   | Character budget for LLM context         |
| `RAG_SNIPPET_CHAR_LIMIT`    | `8000`                    | Max chars per code snippet               |
| `RAG_MAX_EXTRA_VECTOR_HITS` | `3`                       | Extra vector hits beyond graph traversal |
| `MAX_QUESTION_CHARS`        | `2000`                    | Max question length                      |
| `MAX_SYMBOL_CHARS`          | `300`                     | Max symbol name length                   |
| `MCP_MAX_SEARCH_RESULTS`    | `20`                      | Max MCP search results                   |
| `ALLOWED_ORIGINS`           | `localhost:5173-5175`     | CORS allowed origins                     |
| `ALLOWED_HOSTS`             | `localhost,127.0.0.1,::1` | Allowed Host header values               |

---
