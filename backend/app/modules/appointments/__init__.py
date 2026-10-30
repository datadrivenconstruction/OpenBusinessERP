"""Appointments: services, bookable resources, bookings, online booking and reminders.

Rows are tenant-scoped via ``tenant_id`` (company tenant, see app.core.tenant_scope).
Only scheduling data is stored - never clinical or other special-category details.
"""


async def on_startup() -> None:
    from app.modules.appointments.permissions import register_appointments_permissions

    register_appointments_permissions()
