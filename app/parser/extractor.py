from app.parser.metrics import MetricsTracker, add_module_totals


def _text(node):
    return node.text.decode("utf-8", "replace")


def flatten_attr(node):
    """Dotted text of a call target. `super()` is kept as a marker; any other non-name receiver becomes `<expr>`,
    which the resolver treats as unresolvable (so `foo().bar()` is no longer flattened to `foo.bar`)."""
    if node is None:
        return ""
    if node.type == "identifier":
        return _text(node)
    if node.type == "attribute":
        left = flatten_attr(node.child_by_field_name("object"))
        right = flatten_attr(node.child_by_field_name("attribute"))
        if left and right:
            return f"{left}.{right}"
        return left or right
    if node.type == "call":
        func = node.child_by_field_name("function")
        if func is not None and func.type == "identifier" and _text(func) == "super":
            return "super()"
    return "<expr>"


def _base_name(node):
    """Dotted name of a class base, or None for things that are not a (possibly subscripted) name."""
    if node.type == "subscript":  # Generic[T] -> Generic
        node = node.child_by_field_name("value")
        if node is None:
            return None
    if node.type in ("identifier", "attribute"):
        name = flatten_attr(node)
        return name if "<" not in name else None
    return None  # keyword_argument (metaclass=...), calls, splats


def _dotted_text(node):
    return _text(node) if node is not None else ""


def _import_names(node):
    """(dotted_name, alias) for each item of an `import` / `from ... import` name list."""
    out = []
    for child in node.children_by_field_name("name"):
        if child.type == "aliased_import":
            alias = child.child_by_field_name("alias")
            out.append((_dotted_text(child.child_by_field_name("name")), _text(alias) if alias is not None else None))
        else:
            out.append((_text(child), None))
    return out


def _import_relationships(node, module_id):
    if node.type == "import_statement":
        return [
            {"type": "imports", "from": module_id, "to": name, "level": 0, "name": None, "alias": alias}
            for name, alias in _import_names(node)
        ]
    # import_from_statement
    module_node = node.child_by_field_name("module_name")
    level, module = 0, ""
    if module_node is not None:
        if module_node.type == "relative_import":
            for child in module_node.children:
                if child.type == "import_prefix":
                    level = _text(child).count(".")
                elif child.type == "dotted_name":
                    module = _text(child)
        else:
            module = _text(module_node)
    records = [
        {"type": "imports", "from": module_id, "to": module, "level": level, "name": name, "alias": alias}
        for name, alias in _import_names(node)
    ]
    if any(child.type == "wildcard_import" for child in node.children):
        records.append({"type": "imports", "from": module_id, "to": module, "level": level, "name": "*", "alias": None})
    return records


def traverse(node, entities, file_path, relationships, scope=(None, "", None), tracker=None):
    """scope = (entity id of the innermost module/class/function, its qualified name '' for a module, module id).

    Definitions are named by their qualified name (`Class.method`, `outer.inner`, `Outer.Inner.method`) and get a
    `defines` edge from their direct parent scope. Calls are attributed to the innermost scope, so module-level
    calls belong to the module entity.
    """
    if tracker is None:
        tracker = MetricsTracker()
    scope_id, prefix, module_id = scope
    kind = node.type
    tracker.visit(node)

    if kind == "module":
        entity_name = str(file_path)
        module_id = f"{file_path}:{entity_name}:{node.start_point.row}"
        entity = {
            "type": "module",
            "name": entity_name,
            "id": module_id,
            "start_line": node.start_point.row,
            "end_line": node.end_point.row,
            "file": file_path,
            "code": node.text.decode("utf-8", errors="replace"),
        }
        entities.append(entity)
        scope = (module_id, "", module_id)
        tracker.push(entity)
        for child in node.children:
            traverse(child, entities, file_path, relationships, scope, tracker)
        tracker.pop()
        return

    elif kind in ("function_definition", "class_definition"):
        name_node = node.child_by_field_name("name")
        # An ERROR-recovered definition can lack a name; skip it (children are still traversed in the current scope).
        if name_node is not None:
            raw = _text(name_node)
            entity_name = f"{prefix}.{raw}" if prefix else raw
            entity_id = f"{file_path}:{entity_name}:{node.start_point.row}"
            entity = {
                "type": kind,
                "name": entity_name,
                "id": entity_id,
                "start_line": node.start_point.row,
                "end_line": node.end_point.row,
                "file": file_path,
                "code": node.text.decode("utf-8", errors="replace"),
            }
            entities.append(entity)
            if scope_id:
                relationships.append({"type": "defines", "from": scope_id, "to": entity_id})

            supers = node.child_by_field_name("superclasses") if kind == "class_definition" else None
            if supers is not None:
                for child in supers.children:
                    base = _base_name(child)
                    if base:
                        relationships.append({"type": "inherits", "from": entity_id, "to": base})

            inner = (entity_id, entity_name, module_id)
            tracker.push(entity)
            for child in node.children:
                # base-class expressions are evaluated in the enclosing scope
                traverse(child, entities, file_path, relationships, scope if supers is not None and child.id == supers.id else inner, tracker)
            tracker.pop()
            return

    elif kind == "call":
        func_node = node.child_by_field_name("function")
        if func_node is not None and scope_id:
            relationships.append({"type": "calls", "from": scope_id, "to": flatten_attr(func_node)})

    elif kind in ("import_statement", "import_from_statement"):
        if module_id:  # lazy imports inside functions still bind names for the whole module (approximation)
            relationships.extend(_import_relationships(node, module_id))
        tracker.visit_leaves(node)
        return

    for child in node.children:
        traverse(child, entities, file_path, relationships, scope, tracker)


def extract_entities(tree, file_path):
    entities = []
    relationships = []
    traverse(tree.root_node, entities, file_path, relationships)
    module = next((e for e in entities if e["type"] == "module"), None)
    if module is not None:
        add_module_totals(module, entities, relationships)
    return entities, relationships
