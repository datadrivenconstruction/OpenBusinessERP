"""Appointments module manifest."""

from app.core.module_loader import ModuleManifest

manifest = ModuleManifest(
    name="oe_appointments",
    version="0.1.0",
    display_name="Appointments",
    description="Services, staff/room resources with working hours, bookings, online booking page and reminders",
    author="OpenBusinessERP Core Team",
    category="business",
    depends=["oe_contacts"],
    auto_install=True,
    enabled=True,
)
