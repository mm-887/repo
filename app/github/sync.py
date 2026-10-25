import logging
import os
import shutil
import stat
import sys
import tempfile
from git import Repo
from git.exc import GitCommandError
from app import config
from app.github.repo_ref import RepoRef, checkout_path, parse_repo_url

log = logging.getLogger(__name__)

class CloneError(Exception):
    pass

class RepoAlreadyExists(CloneError):
    def __init__(self, ref: RepoRef, path: str):
        super().__init__(f"Repo {ref.owner}/{ref.repo} already exists")
        self.ref = ref
        self.path = path

class SuspiciousCheckout(CloneError):
    def __init__(self, ref: RepoRef, path: str):
        super().__init__(f"{ref.owner}/{ref.repo} exists but is not a valid git checkout")
        self.ref = ref
        self.path = path


class CloneFailed(CloneError):
    pass

class RefreshRefused(CloneError):
    pass

class RefreshFailed(CloneError):
    pass

def _rmtree(path: str):
    def clear_and_retry(func, p, *_):
        try:
            os.chmod(p, stat.S_IWRITE)
            func(p)
        except OSError:
            pass

    if sys.version_info >= (3, 12):
        shutil.rmtree(path, onexc=clear_and_retry)
    else:
        shutil.rmtree(path, onerror=clear_and_retry)
    if os.path.exists(path):
        log.warning("Temporary clone left behind: %s", path)

def clone_repo(repo_url: str):
    ref = parse_repo_url(repo_url)
    final = checkout_path(ref)

    if os.path.exists(final):
        if os.path.isfile(os.path.join(final, ".git", "HEAD")):
            raise RepoAlreadyExists(ref, final)
        raise SuspiciousCheckout(ref, final)

    os.makedirs(config.TMP_DIR, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix=f"{ref.owner}_{ref.repo}-", dir=config.TMP_DIR)
    try:
        # Shallow: only the latest commit is needed to parse the tree and record its SHA.
        Repo.clone_from(ref.url + ".git", tmp, depth=1)
    except GitCommandError:
        _rmtree(tmp)
        raise CloneFailed(f"Could not clone {ref.owner}/{ref.repo}: repository not found, private, or unreachable")
    except Exception:
        _rmtree(tmp)
        raise CloneFailed("Clone failed")
    except BaseException:
        _rmtree(tmp)
        raise

    try:
        os.makedirs(os.path.dirname(final), exist_ok=True)
        os.rename(tmp, final)
    except OSError:
        _rmtree(tmp)
        raise CloneFailed("Clone failed")
    return final, ref.owner, ref.repo

def _same_remote(url: str, ref: RepoRef) -> bool:
    s = (url or "").strip().rstrip("/")
    if s.lower().endswith(".git"):
        s = s[:-4]
    return s.lower() == ref.url.lower()

def refresh_checkout(ref: RepoRef) -> dict:
    path = checkout_path(ref)
    try:
        repo = Repo(path)
        previous = repo.head.commit.hexsha
        origin_url = repo.remotes.origin.url
        dirty = repo.is_dirty(untracked_files=False)
    except Exception:
        raise RefreshFailed(f"Could not read the checkout of {ref.owner}/{ref.repo}")
    if not _same_remote(origin_url, ref):
        raise RefreshRefused(f"The origin of {ref.owner}/{ref.repo} is not {ref.url}; refusing to refresh it.")
    if dirty:
        raise RefreshRefused(f"{ref.owner}/{ref.repo} has local changes to tracked files; refusing to refresh it.")

    try:
        fetch_args = {"depth": 1} if os.path.isfile(os.path.join(path, ".git", "shallow")) else {}
        repo.git.fetch("origin", "HEAD", **fetch_args)
        current = repo.git.rev_parse("FETCH_HEAD").strip()
    except Exception:
        raise RefreshFailed(f"Could not fetch {ref.owner}/{ref.repo}: repository not found, private, or unreachable")
    if current == previous:
        return {"previous": previous, "current": current, "changed": False}
    try:
        repo.git.reset("--hard", current)
    except Exception:
        raise RefreshFailed(f"Could not update the checkout of {ref.owner}/{ref.repo}")
    return {"previous": previous, "current": current, "changed": True}

def rollback_checkout(ref: RepoRef, sha: str) -> bool:
    try:
        Repo(checkout_path(ref)).git.reset("--hard", sha)
        return True
    except Exception:
        log.warning("Could not roll back %s/%s to %s", ref.owner, ref.repo, sha)
        return False