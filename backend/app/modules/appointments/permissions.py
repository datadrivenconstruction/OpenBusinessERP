"""Appointments permission definitions."""

from app.core.permissions import Role, permission_registry


def register_appointments_permissions() -> None:
    permission_registry.register_module_permissions(
        "appointments",
        {
            "appointments.read": Role.VIEWER,
            "appointments.write": Role.EDITOR,
            # Online booking, reminders, retention purge and client data erasure.
            "appointments.manage": Role.MANAGER,
        },
    )
