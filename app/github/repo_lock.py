import threading
from contextlib import contextmanager
from app.github.repo_ref import RepoRef

_guard = threading.Lock()
_busy = set()

class RepoBusy(Exception):
    def __init__(self, ref: RepoRef):
        super().__init__(f"{ref.owner}/{ref.repo} is already being cloned or indexed")
        self.ref = ref

def _key(ref: RepoRef):
    return (ref.owner.casefold(), ref.repo.casefold())

@contextmanager
def repo_operation(ref: RepoRef):
    key = _key(ref)
    with _guard:
        if key in _busy:
            raise RepoBusy(ref)
        _busy.add(key)
    try:
        yield
    finally:
        with _guard:
            _busy.discard(key)