import os

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app import config
from app.main import app as api

DIST_DIR = os.path.join(config.PROJECT_ROOT, "frontend", "dist")
INDEX_FILE = os.path.join(DIST_DIR, "index.html")

app = FastAPI(title="RepoGraph", docs_url=None, redoc_url=None, openapi_url=None)
app.mount("/api", api)

assets_dir = os.path.join(DIST_DIR, "assets")
if os.path.isdir(assets_dir):
    app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")


@app.get("/{path:path}", include_in_schema=False)
async def spa(path: str):
    candidate = os.path.realpath(os.path.join(DIST_DIR, path))
    inside = candidate == os.path.realpath(DIST_DIR) or candidate.startswith(os.path.realpath(DIST_DIR) + os.sep)
    if path and inside and os.path.isfile(candidate):
        return FileResponse(candidate)
    if not os.path.isfile(INDEX_FILE):
        raise HTTPException(status_code=404, detail="Frontend build not found.")
    return FileResponse(INDEX_FILE)
