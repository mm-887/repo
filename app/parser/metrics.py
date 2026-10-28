DECISION_TYPES = frozenset({
    "if_statement",
    "elif_clause",
    "for_statement",
    "while_statement",
    "except_clause",
    "except_group_clause",
    "boolean_operator",
    "conditional_expression",
    "if_clause",
    "case_clause",
})


def count_loc(code):
    return sum(1 for line in code.split("\n") if line.strip())


class MetricsTracker:
    def __init__(self):
        self.open = []

    def push(self, entity):
        self.open.append({"entity": entity, "tokens": 0, "decisions": 0})

    def pop(self):
        frame = self.open.pop()
        entity = frame["entity"]
        entity["metrics"] = {
            "complexity": 1 + frame["decisions"],
            "tokens": frame["tokens"],
            "loc": count_loc(entity["code"]),
        }

    def visit_leaves(self, node):
        stack = [node]
        while stack:
            current = stack.pop()
            if current.child_count:
                stack.extend(current.children)
            else:
                self.visit(current)

    def visit(self, node):
        if not self.open:
            return
        kind = node.type
        if kind == "comment":
            return
        if node.child_count == 0:
            if node.end_byte > node.start_byte:
                for frame in self.open:
                    frame["tokens"] += 1
        elif kind in DECISION_TYPES:
            self.open[-1]["decisions"] += 1


def add_module_totals(module_entity, entities, relationships):
    complexities = [e["metrics"]["complexity"] for e in entities if "metrics" in e]
    module_entity["metrics"].update({
        "total_complexity": sum(complexities),
        "max_complexity": max(complexities),
        "imports": sum(1 for r in relationships if r["type"] == "imports"),
    })
