import os
import re
from dataclasses import dataclass
from app import config

OWNER_RE = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$")
REPO_RE = re.compile(r"^[A-Za-z0-9._-]{1,100}$")
IPV4_RE = re.compile(r"^\d{1,3}(\.\d{1,3}){3}$")
WINDOWS_RESERVED = {"con", "prn", "aux", "nul"} | {f"com{i}" for i in range(1, 10)} | {f"lpt{i}" for i in range(1, 10)}
GITHUB_PREFIX = "https://github.com/"

class InvalidRepoError(ValueError):
    pass

@dataclass(frozen=True)
class RepoRef:
    owner: str
    repo: str

    @property
    def url(self) -> str:
        return f"{GITHUB_PREFIX}{self.owner}/{self.repo}"

def validate_repo_id(owner: str, repo: str) -> RepoRef:
    if not isinstance(owner, str) or not OWNER_RE.match(owner):
        raise InvalidRepoError("Invalid repository owner: use 1-39 letters, digits or hyphens.")
    if not isinstance(repo, str) or not REPO_RE.match(repo) or repo in (".", ".."):
        raise InvalidRepoError("Invalid repository name: use 1-100 letters, digits, '.', '_' or '-'.")
    if repo.split(".")[0].lower() in WINDOWS_RESERVED:
        raise InvalidRepoError("Invalid repository name: reserved name.")
    collection = f"{owner}.{repo}"
    if ".." in collection or not collection[-1].isalnum() or IPV4_RE.match(collection):
        raise InvalidRepoError(f"Repository name '{owner}/{repo}' is not supported (vector-store naming rules).")
    return RepoRef(owner, repo)

def parse_repo_url(url: str) -> RepoRef:
    if not isinstance(url, str):
        raise InvalidRepoError("Repository URL must be a string.")
    s = url.strip()
    if not s:
        raise InvalidRepoError("Repository URL is empty.")
    if any(c in s for c in "%\\?#") or any(c.isspace() for c in s):
        raise InvalidRepoError("Repository URL contains unsupported characters.")
    if "://" in s:
        if not s.startswith(GITHUB_PREFIX):
            raise InvalidRepoError("Only https://github.com/<owner>/<repo> URLs are supported.")
        s = s[len(GITHUB_PREFIX):]
    if s.endswith("/"):
        s = s[:-1]
    if s.lower().endswith(".git"):
        s = s[:-4]
    parts = s.split("/")
    if len(parts) != 2 or not all(parts):
        raise InvalidRepoError("Repository URL must look like https://github.com/<owner>/<repo>.")
    return validate_repo_id(parts[0], parts[1])

def checkout_path(ref: RepoRef) -> str:
    base = os.path.realpath(config.REPOS_DIR)
    path = os.path.realpath(os.path.join(base, ref.owner, ref.repo))
    try:
        inside = os.path.commonpath([base, path]) == base
    except ValueError:
        inside = False
    if not inside or len(os.path.relpath(path, base).split(os.sep)) != 2:
        raise InvalidRepoError("Repository path is outside repository storage.")
    return path