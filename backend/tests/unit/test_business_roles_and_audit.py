"""Job-role presets and the automatic business audit trail."""

import uuid

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.core import business_audit
from app.core.audit import AuditEntry
from app.core.audit_log import AuditContext, reset_audit_context, set_audit_context
from app.core.business_roles import PRESETS, business_matrix, effective_permissions, role_allows
from app.core.permissions import Role, permission_registry
from app.modules.items.models import ItemsCategory


@pytest.fixture(autouse=True)
def _perms():
    saved = (dict(permission_registry._permissions), dict(permission_registry._module_permissions))
    for mod in ("sales", "crm", "gl", "items", "inventory", "purchasing"):
        permission_registry.register_module_permissions(
            mod, {f"{mod}.read": Role.VIEWER, f"{mod}.write": Role.EDITOR, f"{mod}.post": Role.MANAGER}
        )
    permission_registry.register("users.read", Role.MANAGER)
    yield
    permission_registry._permissions, permission_registry._module_permissions = saved


def test_accountant_posts_gl_reads_sales_never_touches_crm():
    assert role_allows("manager", "accountant", "gl.post")
    assert role_allows("manager", "accountant", "sales.read")
    assert not role_allows("manager", "accountant", "sales.write")
    assert not role_allows("manager", "accountant", "crm.read")
    # Non-business permissions still follow the base role.
    assert role_allows("manager", "accountant", "users.read")


def test_sales_and_purchasing_presets():
    sales = set(effective_permissions("manager", "sales"))
    assert {"crm.post", "sales.post", "items.read"} <= sales
    assert "items.write" not in sales and "gl.read" not in sales
    purch = set(effective_permissions("manager", "purchasing"))
    assert {"purchasing.post", "inventory.write", "items.write"} <= purch
    assert "sales.read" not in purch


def test_readonly_and_owner():
    assert not role_allows(PRESETS["readonly"]["role"], "readonly", "sales.write")
    assert role_allows(PRESETS["readonly"]["role"], "readonly", "sales.read")
    assert role_allows(PRESETS["owner"]["role"], "owner", "gl.post")


def test_matrix_lists_every_preset():
    m = business_matrix()
    assert [p["key"] for p in m["presets"]] == list(PRESETS)
    assert "gl.post" in m["permissions"]


def test_verb_from_path():
    rid = str(uuid.uuid4())
    assert business_audit.verb_from_path(f"POST /api/v1/sales/documents/{rid}/post/") == "post"
    assert business_audit.verb_from_path("POST /api/v1/banking/transactions/x/reconcile") == "reconcile"
    assert business_audit.verb_from_path(f"PATCH /api/v1/items/{rid}") is None


def test_flush_writes_create_update_delete_entries():
    engine = create_engine("sqlite://")
    for table in (ItemsCategory.__table__, AuditEntry.__table__):
        table.create(engine)
    actor = str(uuid.uuid4())
    token = set_audit_context(AuditContext(actor_id=actor, request_path="POST /api/v1/items/categories/"))
    try:
        with Session(engine) as s:
            cat = ItemsCategory(name="Tools", description="")
            s.add(cat)
            s.flush()
            cat.name = "Hand tools"
            s.flush()
            s.delete(cat)
            s.flush()
            rows = s.execute(select(AuditEntry).order_by(AuditEntry.created_at)).scalars().all()
    finally:
        reset_audit_context(token)
    by_action = {r.action: r for r in rows}
    assert set(by_action) == {"create", "update", "delete"}
    assert all(r.entity_type == "items.category" and str(r.user_id) == actor for r in rows)
    upd = by_action["update"].details
    assert upd["before"] == {"name": "Tools"} and upd["after"] == {"name": "Hand tools"}
    assert by_action["create"].details["module"] == "items"
    assert by_action["create"].entity_id == str(cat.id)
    assert by_action["delete"].details["before"]["name"] == "Hand tools"
