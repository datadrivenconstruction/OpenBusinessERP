"""Built-in job-role presets for small businesses.

The RBAC core is a hierarchy (viewer < editor < manager < admin), which cannot say
"the accountant posts journals but never touches the pipeline". A preset pairs a
base role with a per-module grant over the business modules; permissions outside
those modules still follow the base role. The preset key lives in
``user.metadata_["business_role"]`` and is applied on every request when the
token is rehydrated from the database.
"""

from __future__ import annotations

from typing import Any, Literal

from app.core.permissions import permission_registry

BUSINESS_MODULES: tuple[str, ...] = (
    "sales",
    "crm",
    "items",
    "inventory",
    "purchasing",
    "gl",
    "banking",
    "receivables",
    "appointments",
    "data_import",
)

Access = Literal["full", "read"]

PRESETS: dict[str, dict[str, Any]] = {
    "owner": {"role": "admin", "grants": None},
    "accountant": {
        "role": "manager",
        "grants": {
            "gl": "full",
            "banking": "full",
            "receivables": "full",
            "data_import": "full",
            "sales": "read",
            "purchasing": "read",
            "items": "read",
            "inventory": "read",
        },
    },
    "sales": {
        "role": "manager",
        "grants": {"crm": "full", "sales": "full", "appointments": "full", "items": "read"},
    },
    "purchasing": {
        "role": "manager",
        "grants": {"purchasing": "full", "inventory": "full", "items": "full"},
    },
    "readonly": {"role": "viewer", "grants": None},
}


def preset_of(metadata: dict[str, Any] | None) -> str | None:
    key = (metadata or {}).get("business_role")
    return key if key in PRESETS else None


def _grant_allows(grants: dict[str, str], permission: str) -> bool:
    module, _, action = permission.partition(".")
    if module not in BUSINESS_MODULES:
        return True
    access = grants.get(module)
    if access == "full":
        return True
    return access == "read" and action == "read"


def role_allows(role: str, preset: str | None, permission: str) -> bool:
    """Live check: base role grants it and the preset (if any) does not withhold it."""
    if not permission_registry.role_has_permission(role, permission):
        return False
    grants = PRESETS.get(preset or "", {}).get("grants")
    return True if grants is None else _grant_allows(grants, permission)


def effective_permissions(role: str, preset: str | None) -> list[str]:
    perms = permission_registry.get_role_permissions(role)
    grants = PRESETS.get(preset or "", {}).get("grants")
    if grants is None:
        return perms
    return [p for p in perms if _grant_allows(grants, p)]


def business_matrix() -> dict[str, Any]:
    """Preset x business-permission matrix for the Settings → Team UI."""
    modules = permission_registry.list_modules()
    perms = [p for m in BUSINESS_MODULES for p in sorted(modules.get(m, []))]
    presets = []
    for key, spec in PRESETS.items():
        allowed = set(effective_permissions(spec["role"], key))
        presets.append(
            {
                "key": key,
                "role": spec["role"],
                "permissions": [p for p in perms if p in allowed],
            }
        )
    return {"modules": list(BUSINESS_MODULES), "permissions": perms, "presets": presets}
