"""Every business route declares a permission gate or is explicitly public."""

import importlib

import pytest

from app.dependencies import RequirePermission, RequirePermissionOrApiKey, RequireRole

BUSINESS_ROUTERS = [
    "app.modules.sales.router",
    "app.modules.crm.router",
    "app.modules.items.router",
    "app.modules.inventory.router",
    "app.modules.purchasing.router",
    "app.modules.gl.router",
    "app.modules.banking.router",
    "app.modules.receivables.router",
    "app.modules.appointments.router",
    "app.modules.recurring.router",
    "app.modules.data_import.router",
    "app.core.business_settings_router",
    "app.core.business_roles_router",
    "app.core.audit_router",
]

# (module, method, path) reachable without a permission, each for a stated reason.
PUBLIC_ROUTES: set[tuple[str, str, str]] = set()
PUBLIC_PATH_MARKERS = ("/public/", "/booking/")
# Read-only status endpoints any signed-in user may call.
AUTHENTICATED_ONLY = {
    ("app.core.business_settings_router", "GET"),
}

_GATES = (RequirePermission, RequirePermissionOrApiKey, RequireRole)


def _has_gate(dependant) -> bool:
    for dep in dependant.dependencies:
        if isinstance(dep.call, _GATES) or _has_gate(dep):
            return True
    return False


def _routes():
    for mod_name in BUSINESS_ROUTERS:
        mod = importlib.import_module(mod_name)
        for route in mod.router.routes:
            for method in sorted(getattr(route, "methods", None) or ()):
                yield mod_name, method, route


@pytest.mark.parametrize("mod_name", BUSINESS_ROUTERS)
def test_router_has_routes(mod_name):
    assert importlib.import_module(mod_name).router.routes


def test_every_business_route_is_gated_or_public():
    missing = []
    for mod_name, method, route in _routes():
        if method in ("HEAD", "OPTIONS"):
            continue
        if (mod_name, method, route.path) in PUBLIC_ROUTES:
            continue
        if any(m in route.path for m in PUBLIC_PATH_MARKERS):
            continue
        if (mod_name, method) in AUTHENTICATED_ONLY:
            continue
        if not _has_gate(route.dependant):
            missing.append(f"{method} {route.path} ({mod_name})")
    assert not missing, "Business routes without a permission gate:\n" + "\n".join(missing)
