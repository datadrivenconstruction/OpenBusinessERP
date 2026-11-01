"""Automatic audit trail for the business modules.

A ``before_flush`` hook turns every insert / update / delete of a business-module
row into an ``oe_core_audit_log`` entry carrying who, when, what and a
before/after summary of the changed columns. Doing it at the ORM boundary means
a new service method cannot forget to audit itself. Workflow verbs (post, send,
reconcile, ...) are taken from the request path that caused the change.
"""

from __future__ import annotations

import logging
import uuid
from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from typing import Any

from sqlalchemy import event, inspect
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

TABLE_PREFIXES: dict[str, str] = {
    "oe_sales_": "sales",
    "oe_crm_": "crm",
    "oe_items_": "items",
    "oe_inventory_": "inventory",
    "oe_purchasing_": "purchasing",
    "oe_gl_": "gl",
    "oe_bank_": "banking",
    "oe_dunning_": "receivables",
    "oe_ar_": "receivables",
    "oe_appointments_": "appointments",
    "oe_recurring_": "recurring",
    "oe_data_import_": "data_import",
}
# Counters and per-row import staging would drown the log without saying who did what.
SKIP_TABLES = frozenset({"oe_sales_sequence", "oe_purchasing_sequence", "oe_data_import_record"})
SKIP_COLUMNS = frozenset({"id", "created_at", "updated_at"})
VERBS = frozenset(
    {
        "post",
        "send",
        "reconcile",
        "unreconcile",
        "void",
        "cancel",
        "approve",
        "reject",
        "issue",
        "pay",
        "receive",
        "match",
        "unmatch",
        "convert",
        "win",
        "lose",
        "close",
        "reopen",
        "reverse",
        "confirm",
        "complete",
        "run",
        "import",
        "commit",
        "credit",
    }
)
_MAX_STR = 200


def module_for_table(table: str) -> str | None:
    if table in SKIP_TABLES:
        return None
    for prefix, module in TABLE_PREFIXES.items():
        if table.startswith(prefix):
            return module
    return None


def entity_type_for(table: str, module: str) -> str:
    for prefix in TABLE_PREFIXES:
        if table.startswith(prefix):
            rest = table[len(prefix) :]
            return f"{module}.{rest}" if rest else module
    return table


def verb_from_path(request_path: str | None) -> str | None:
    """Last non-id path segment of a mutating request when it names a workflow verb."""
    if not request_path:
        return None
    path = request_path.split(" ", 1)[-1].split("?", 1)[0]
    for seg in reversed([s for s in path.split("/") if s]):
        seg = seg.lower().replace("-", "_")
        head = seg.split("_", 1)[0]
        if seg in VERBS:
            return seg
        if head in VERBS:
            return seg
        return None
    return None


def _summ(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, (dict, list)):
        s = str(value)
        return s if len(s) <= _MAX_STR else s[:_MAX_STR] + "…"
    s = str(value)
    return s if len(s) <= _MAX_STR else s[:_MAX_STR] + "…"


def _column_keys(obj: Any) -> list[str]:
    return [a.key for a in inspect(obj).mapper.column_attrs if a.key not in SKIP_COLUMNS]


def _snapshot(obj: Any) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key in _column_keys(obj):
        val = obj.__dict__.get(key)
        if val is not None:
            out[key] = _summ(val)
    return out


def _diff(obj: Any) -> tuple[dict[str, Any], dict[str, Any]]:
    state = inspect(obj)
    before: dict[str, Any] = {}
    after: dict[str, Any] = {}
    for key in _column_keys(obj):
        hist = state.attrs[key].history
        if not hist.has_changes():
            continue
        old = hist.deleted[0] if hist.deleted else None
        new = hist.added[0] if hist.added else None
        if old == new:
            continue
        before[key] = _summ(old)
        after[key] = _summ(new)
    return before, after


def build_entries(session: Session) -> list[dict[str, Any]]:
    """Describe the pending business changes in ``session`` as audit-entry kwargs."""
    from app.core.audit_log import get_audit_context

    ctx = get_audit_context()
    request_path = getattr(ctx, "request_path", None) if ctx else None
    verb = verb_from_path(request_path)
    actor = ctx.actor_id if ctx else None
    ip = ctx.ip_address if ctx else None

    rows: list[dict[str, Any]] = []

    def add(obj: Any, action: str, before: dict | None, after: dict | None) -> None:
        table = getattr(obj, "__tablename__", "")
        module = module_for_table(table)
        if module is None:
            return
        details: dict[str, Any] = {"module": module, "before": before, "after": after}
        if request_path:
            details["request"] = request_path
        oid = getattr(obj, "id", None)
        rows.append(
            {
                "action": action,
                "entity_type": entity_type_for(table, module),
                "entity_id": str(oid) if oid is not None else None,
                "user_id": actor,
                "ip_address": ip,
                "details": details,
            }
        )

    for obj in list(session.new):
        if getattr(obj, "id", 0) is None and module_for_table(getattr(obj, "__tablename__", "")):
            obj.id = uuid.uuid4()  # the column default would only fire after this hook
        add(obj, "create", None, _snapshot(obj))
    for obj in list(session.dirty):
        if not session.is_modified(obj, include_collections=False):
            continue
        before, after = _diff(obj)
        if not after and not before:
            continue
        add(obj, verb or "update", before, after)
    for obj in list(session.deleted):
        add(obj, "delete", _snapshot(obj), None)
    return rows


@event.listens_for(Session, "before_flush")
def _audit_business_changes(session: Session, _flush_context: Any, _instances: Any) -> None:
    if session.info.get("skip_business_audit"):
        return
    try:
        rows = build_entries(session)
    except Exception:  # audit capture must never block a business write
        logger.exception("business audit: capture failed")
        return
    if not rows:
        return
    from app.core.audit import AuditEntry

    for row in rows:
        user_id = row.pop("user_id")
        try:
            row["user_id"] = uuid.UUID(str(user_id)) if user_id else None
        except ValueError:
            row["user_id"] = None
        session.add(AuditEntry(**row))
