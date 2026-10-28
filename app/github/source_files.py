import os
from app import config
from app.github.repo_ref import checkout_path
from app.parser.pipeline import _inside

LANGUAGES = {
    ".py": "python",
    ".js": "javascript",
    ".jsx": "javascript",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".json": "json",
    ".md": "markdown",
    ".toml": "toml",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".html": "html",
    ".css": "css",
}
BINARY_SNIFF_BYTES = 8192


class SourcePathError(ValueError):
    pass


class SourceNotFound(LookupError):
    pass


class SourceNotText(ValueError):
    pass


def _is_git_part(part):
    return part.rstrip(". ").lower() == ".git"


def parse_relative_path(path):
    if not isinstance(path, str) or not path.strip():
        raise SourcePathError("path must not be empty.")
    if "\0" in path or "\\" in path or ":" in path or path.startswith("/"):
        raise SourcePathError("path must be repository-relative and use '/' separators.")
    parts = path.split("/")
    if any(p in ("", ".", "..") for p in parts):
        raise SourcePathError("path must not contain empty, '.' or '..' components.")
    if any(_is_git_part(p) for p in parts):
        raise SourcePathError("path must not point into git metadata.")
    return parts


def read_source(ref, path):
    parts = parse_relative_path(path)
    root = checkout_path(ref)
    if not os.path.isdir(root):
        raise SourceNotFound("Repo not found")
    real = os.path.realpath(os.path.join(root, *parts))
    if not _inside(root, real):
        raise SourcePathError("path resolves outside the repository.")
    resolved = os.path.relpath(real, root).split(os.sep)
    if any(_is_git_part(p) for p in resolved):
        raise SourcePathError("path must not point into git metadata.")
    if not os.path.isfile(real):
        raise SourceNotFound("File not found")

    cap = config.SOURCE_MAX_BYTES
    with open(real, "rb") as f:
        data = f.read(cap + 1)
    truncated = len(data) > cap
    data = data[:cap]
    if b"\0" in data[:BINARY_SNIFF_BYTES]:
        raise SourceNotText("File is binary and cannot be shown as text.")
    if truncated:
        cut = data.rfind(b"\n")
        if cut > 0:
            data = data[:cut + 1]
    content = data.decode("utf-8", errors="replace")
    lines = content.count("\n") + (1 if content and not content.endswith("\n") else 0)
    return {
        "path": "/".join(parts),
        "language": LANGUAGES.get(os.path.splitext(parts[-1])[1].lower(), "text"),
        "content": content,
        "lines": lines,
        "truncated": truncated,
    }
