import tree_sitter_python as tspython
from tree_sitter import Language, Parser

PY_LANGUAGE = Language(tspython.language())

parser = Parser(PY_LANGUAGE)

def parse_python_file(file_path: str):
    with open(file_path, "rb") as f:
        code = f.read()
    tree = parser.parse(code)
    return tree