import os
from dotenv import load_dotenv

load_dotenv()
TOKEN = os.getenv("GITHUB_TOKEN")

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPOS_DIR = os.path.join(PROJECT_ROOT, "data", "repositories")
GRAPHS_DIR = os.path.join(PROJECT_ROOT, "data", "graphs")
os.makedirs(GRAPHS_DIR, exist_ok=True)
CHROMA_DIR = os.getenv("CHROMA_DIR", os.path.join(PROJECT_ROOT, "data", "chromadb"))
TMP_DIR = os.path.join(PROJECT_ROOT, "data", "tmp")

INDEX_MAX_FILE_BYTES = int(os.getenv("INDEX_MAX_FILE_BYTES", "1048576"))
SOURCE_MAX_BYTES = int(os.getenv("SOURCE_MAX_BYTES", "1048576"))
RAG_CONTEXT_CHAR_BUDGET = int(os.getenv("RAG_CONTEXT_CHAR_BUDGET", "24000"))
RAG_SNIPPET_CHAR_LIMIT = int(os.getenv("RAG_SNIPPET_CHAR_LIMIT", "8000"))
RAG_MAX_EXTRA_VECTOR_HITS = int(os.getenv("RAG_MAX_EXTRA_VECTOR_HITS", "3"))

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3-flash-preview")


def _csv(name, default):
    return [v.strip() for v in os.getenv(name, default).split(",") if v.strip()]


MAX_QUESTION_CHARS = int(os.getenv("MAX_QUESTION_CHARS", "2000"))
MAX_SYMBOL_CHARS = int(os.getenv("MAX_SYMBOL_CHARS", "300"))
MCP_MAX_SEARCH_RESULTS = int(os.getenv("MCP_MAX_SEARCH_RESULTS", "20"))
INDEX_MAX_FILES = int(os.getenv("INDEX_MAX_FILES", "20000"))
INDEX_MAX_TOTAL_BYTES = int(os.getenv("INDEX_MAX_TOTAL_BYTES", str(100 * 1024 * 1024)))
ALLOWED_ORIGINS = _csv(
    "ALLOWED_ORIGINS",
    ",".join(f"http://{h}:{p}" for p in (5173, 5174, 5175) for h in ("localhost", "127.0.0.1")),
)
ALLOWED_HOSTS = _csv("ALLOWED_HOSTS", "localhost,127.0.0.1,::1")