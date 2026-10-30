# DDC-CWICR-OE: DataDrivenConstruction · OpenBusinessERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Company-type presets for the onboarding wizard and the Modules page.

Each preset is a *role-based starting point*: it declares which optional
modules a given kind of company sees by default.  The user picks a profile
during onboarding (or switches it later on ``/modules``) and the chosen module
set is written to ``module_preferences``, which the sidebar honours - so a
profile genuinely shapes what the app looks like, not just a counter.

Single source of truth
----------------------
The module identifiers here MUST match the frontend onboarding catalogue in
``frontend/src/features/onboarding/modules.ts`` (the ``ALL_MODULES`` keys) and
the ``moduleKey`` the sidebar gates on.  Keep the three in sync: a key that
exists here but nowhere in the sidebar simply has no visible effect; a sidebar
key missing here is never reachable from a profile.

Core modules are always on (platform infrastructure plus the handful of
surfaces every company needs).  Profiles only ever toggle the *functional*
modules, so a profile can never lock a user out of Projects, Settings, etc.
"""

from __future__ import annotations

from typing import Any

# ── Always-on modules ─────────────────────────────────────────────────────────
# Platform infrastructure + the few surfaces every company needs regardless of
# profile. These are never disabled by a profile switch, so the user can always
# reach Projects, Contacts, the dashboard and the admin/setup area.
_CORE_MODULES: list[str] = [
    "projects",
    "contacts",
    "dashboards",
    "project_intelligence",
    "notifications",
    "users",
    "teams",
    "uploads",
    "jobs",
    "search",
    "backup",
    "admin",
    "i18n_foundation",
    "collaboration_locks",
]

# Construction-pack core: cost database, resource catalogue and assembly library
# back every estimating workflow, so construction profiles never hide them.
# Business profiles do not force them on (they stay selectable, default off).
CONSTRUCTION_CORE: list[str] = [
    "costs",
    "assemblies",
]

# ── Functional modules, grouped (mirror of modules.ts groups) ───────────────────
# costs / catalog / assemblies are intentionally NOT here: they are core of the
# construction pack (see CONSTRUCTION_CORE).
_ESTIMATION = ["boq", "validation", "cost_match"]
_TAKEOFF = ["takeoff", "dwg_takeoff", "cad"]
_BIM: list[str] = []
_AI = ["ai", "erp_chat", "compliance_ai", "ai_agents"]
_PLANNING = ["schedule", "schedule_advanced", "tasks", "costmodel", "eac"]
_FINANCE = ["sales", "gl", "finance", "funding", "procurement", "tendering", "changeorders"]
_COMMERCIAL = [
    "bid_management",
    "contracts",
    "variations",
    "crm",
    "supplier_catalogs",
    "property_dev",
    "moc",
]
_OPERATIONS = ["service", "equipment", "resources", "daily_diary", "subcontractors", "portal"]
_COMMUNICATION = ["meetings", "rfi", "submittals", "transmittals", "correspondence"]
_DOCUMENTS = ["documents", "markups"]
_QUALITY = ["inspections", "ncr", "safety", "punchlist", "risk", "hse_advanced"]
_QMS = ["qms", "compliance", "compliance_docs", "requirements"]
_FIELD = ["fieldreports", "collaboration", "field_diary", "payroll"]
_ESG = ["carbon"]
# Business-side operations with no construction counterpart.
_BOOKING = ["appointments"]
_BI = ["bi_dashboards", "reporting", "project_controls"]
_ENTERPRISE = ["enterprise_workflows", "full_evm", "rfq_bidding", "integrations"]

# Region-specific packs are chosen on the onboarding region step / via partner
# packs, not by a company profile, so they are not part of any profile's set.
#
# That sentence was true of the presets and false of the code beneath them.
# ``modules_for`` iterated ``_ALL_MODULES``, which includes these, and wrote
# ``False`` for every one of them under every profile including Full
# Enterprise - so a company profile did decide them, and decided them off.
# They carry no sidebar row (see the note at the foot of ``navCatalog.ts``),
# so the only thing that flag reached was the toggle on ``/modules``, which
# then read "off" for a pack ``regional_packs.py`` imports unconditionally and
# consults on every BOQ validation. A switch reporting off about a module that
# is on is worse than no switch.
#
# The list also stood at eight while thirteen packs sit in
# ``backend/app/modules/*_pack``, so five of them were already absent from the
# map and read as on, and which half of the thirteen a reader saw depended on
# nothing they could see. ``test_regional_list_matches_the_packs_on_disk``
# fails when a pack is added without a line here.
_REGIONAL = [
    "asia_pac_pack",
    "china_pack",
    "dach_pack",
    "india_pack",
    "latam_pack",
    "mexico_pack",
    "middle_east_pack",
    "russia_pack",
    "sa_pack",
    "uk_pack",
    "us_ca_pack",
    "us_pack",
    "us_tx_pack",
]

# Every functional module, in display order (used by Full Enterprise).
_ALL_FUNCTIONAL: list[str] = [
    *_ESTIMATION,
    *_TAKEOFF,
    *_BIM,
    *_AI,
    *_PLANNING,
    *_FINANCE,
    *_COMMERCIAL,
    *_OPERATIONS,
    *_COMMUNICATION,
    *_DOCUMENTS,
    *_QUALITY,
    *_QMS,
    *_FIELD,
    *_ESG,
    *_BOOKING,
    *_BI,
    *_ENTERPRISE,
]

# The complete module registry the onboarding POST iterates over when it writes
# module_preferences. Mirrors the ALL_MODULES keys in modules.ts.
_ALL_MODULES: list[str] = [*_CORE_MODULES, *CONSTRUCTION_CORE, *_ALL_FUNCTIONAL, *_REGIONAL]

# ── Preset definitions ────────────────────────────────────────────────────────


class CompanyPreset:
    """Immutable descriptor for a company-type onboarding preset.

    ``enabled_modules`` is what the profile switches on (the recommended set).
    ``optional_modules`` are add-ons the apps step offers unchecked; they are
    never written to preferences unless the user picks them.
    """

    __slots__ = (
        "key", "label", "description", "icon", "enabled_modules", "optional_modules", "tags", "section", "tax_hint",
    )

    def __init__(
        self,
        key: str,
        label: str,
        description: str,
        icon: str,
        enabled_modules: list[str],
        tags: list[str] | None = None,
        optional_modules: list[str] | None = None,
        section: str = "",
        tax_hint: str = "",
    ) -> None:
        self.key = key
        self.label = label
        self.description = description
        self.icon = icon
        # De-duplicate while preserving order; a profile only lists functional
        # modules, core modules are merged in by ``modules_for`` at write time.
        self.enabled_modules = list(dict.fromkeys(enabled_modules))
        recommended = set(self.enabled_modules)
        self.optional_modules = [m for m in dict.fromkeys(optional_modules or []) if m not in recommended]
        self.tags = tags or []
        # Industry step grouping (business pack) and a VAT note shown with the profile.
        self.section = section
        self.tax_hint = tax_hint

    def to_dict(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "label": self.label,
            "description": self.description,
            "icon": self.icon,
            "tags": self.tags,
            "enabled_modules": self.enabled_modules,
            "recommended_modules": self.enabled_modules,
            "optional_modules": self.optional_modules,
            "module_count": len(self.enabled_modules),
            "section": self.section,
            "tax_hint": self.tax_hint,
            "pack": "business" if self.key in BUSINESS_PRESET_KEYS else "construction",
        }


# ── Business (non-construction) industries ───────────────────────────────────
# OpenBusinessERP profiles. Every company sells, books and files, so the base is
# on everywhere; each industry adds what its day-to-day work needs (recommended)
# and offers the rest as add-ons (optional). sales depends on gl.
_BUSINESS_BASE = [
    "crm",
    "sales",
    "gl",
    "finance",
    "documents",
    "tasks",
    "bi_dashboards",
    "ai",
    "erp_chat",
]

_BUSINESS_PRESETS: list[CompanyPreset] = [
    # Trade & production
    CompanyPreset(
        key="trade_distribution",
        label="Wholesale & Distribution",
        description="Buy from suppliers, hold stock and sell on to business customers at a margin.",
        icon="Truck",
        section="trade",
        tags=["Sales orders", "Purchasing", "Suppliers", "Margins"],
        enabled_modules=[*_BUSINESS_BASE, "procurement", "supplier_catalogs", "contracts"],
        optional_modules=["integrations", "enterprise_workflows", "portal", "inspections", "risk", "ai_agents"],
    ),
    CompanyPreset(
        key="retail_ecommerce",
        label="Retail & E-commerce",
        description="Sell to consumers in a shop or online, with stock, returns and customer service.",
        icon="ShoppingCart",
        section="trade",
        tags=["Online shop", "Stock", "Customers", "Returns"],
        enabled_modules=[*_BUSINESS_BASE, "procurement", "supplier_catalogs", "service", "integrations"],
        optional_modules=["portal", "contracts", "enterprise_workflows", "inspections", "ai_agents"],
    ),
    CompanyPreset(
        key="manufacturing",
        label="Manufacturing",
        description="Turn materials into products, with production planning, quality control and equipment.",
        icon="Factory",
        section="trade",
        tags=["Purchasing", "Production", "Quality", "Equipment"],
        enabled_modules=[
            *_BUSINESS_BASE,
            "procurement",
            "supplier_catalogs",
            "equipment",
            "schedule",
            "qms",
            "inspections",
            "ncr",
        ],
        optional_modules=["safety", "risk", "contracts", "enterprise_workflows", "integrations", "ai_agents"],
    ),
    CompanyPreset(
        key="craft_trades",
        label="Craft Trades & Workshops",
        description="Electricians, plumbers, joiners and other trades: jobs, materials, hours on the job and invoices.",
        icon="Hammer",
        section="trade",
        tags=["Jobs", "Materials", "Hours", "Invoices"],
        enabled_modules=[*_BUSINESS_BASE, "service", "schedule", "procurement", "supplier_catalogs", "equipment"],
        optional_modules=["inspections", "safety", "contracts", "portal", "ai_agents"],
    ),
    CompanyPreset(
        key="food_production",
        label="Food & Agriculture",
        description="Farms, bakeries, dairies and breweries: batches, cold chain, hygiene checks and trade customers.",
        icon="Wheat",
        section="trade",
        tags=["Batches", "Hygiene", "Trade customers", "Seasons"],
        enabled_modules=[
            *_BUSINESS_BASE,
            "procurement",
            "supplier_catalogs",
            "equipment",
            "schedule",
            "qms",
            "inspections",
        ],
        optional_modules=["ncr", "safety", "funding", "contracts", "integrations", "ai_agents"],
    ),
    CompanyPreset(
        key="franchise_multisite",
        label="Franchise & Multi-location",
        description="Branches or franchisees under one brand: shared catalogue, central purchasing and site audits.",
        icon="Store",
        section="trade",
        tags=["Branches", "Central purchasing", "Site audits", "Royalties"],
        enabled_modules=[
            *_BUSINESS_BASE,
            "procurement",
            "supplier_catalogs",
            "contracts",
            "inspections",
            "enterprise_workflows",
            "portal",
        ],
        optional_modules=["qms", "service", "meetings", "risk", "integrations", "ai_agents"],
    ),
    # Services
    CompanyPreset(
        key="professional_services",
        label="Consulting & Advisory",
        description="Management and finance consultancies billing day rates, fixed-fee projects and retainers.",
        icon="Briefcase",
        section="services",
        tags=["Clients", "Engagements", "Billing", "Contracts"],
        enabled_modules=[*_BUSINESS_BASE, "contracts", "schedule", "meetings", "portal"],
        optional_modules=["correspondence", "enterprise_workflows", "procurement", "risk", "integrations", "ai_agents"],
    ),
    CompanyPreset(
        key="law_firm",
        label="Law Firm",
        description="Matters, client mandates, billable hours, court deadlines and fee notes.",
        icon="Scale",
        section="services",
        tags=["Matters", "Billable hours", "Deadlines", "Fee notes"],
        enabled_modules=[*_BUSINESS_BASE, "contracts", "schedule", "correspondence", "meetings", "portal"],
        optional_modules=["enterprise_workflows", "risk", "integrations", "ai_agents"],
    ),
    CompanyPreset(
        key="tax_advisory",
        label="Accounting & Tax Advisory",
        description="Bookkeeping, payroll and tax returns for client companies, billed per mandate or monthly fee.",
        icon="Calculator",
        section="services",
        tags=["Mandates", "Filing deadlines", "Monthly fees", "Documents"],
        enabled_modules=[
            *_BUSINESS_BASE,
            "contracts",
            "schedule",
            "portal",
            "correspondence",
            "enterprise_workflows",
        ],
        optional_modules=["meetings", "risk", "integrations", "ai_agents"],
    ),
    CompanyPreset(
        key="it_agency",
        label="IT & Digital Agency",
        description="Software, web and marketing teams running client projects, support and retainers.",
        icon="Code2",
        section="services",
        tags=["Clients", "Projects", "Support", "Retainers"],
        enabled_modules=[*_BUSINESS_BASE, "contracts", "schedule", "service", "portal"],
        optional_modules=["meetings", "risk", "integrations", "enterprise_workflows", "ai_agents"],
    ),
    CompanyPreset(
        key="creative_studio",
        label="Creative & Marketing Studio",
        description="Design, branding, photo and content studios: briefs, campaigns, usage rights and retainers.",
        icon="Palette",
        section="services",
        tags=["Briefs", "Campaigns", "Retainers", "Usage rights"],
        enabled_modules=[*_BUSINESS_BASE, "contracts", "schedule", "meetings", "portal"],
        optional_modules=["service", "enterprise_workflows", "integrations", "ai_agents"],
    ),
    CompanyPreset(
        key="real_estate",
        label="Real Estate & Property Management",
        description="Brokerage, lettings and property management: owners, tenants, listings, service charges and repairs.",
        icon="KeyRound",
        section="services",
        tags=["Listings", "Tenants", "Repairs", "Service charges"],
        enabled_modules=[*_BUSINESS_BASE, "contracts", "service", "inspections", "portal", "schedule"],
        optional_modules=["equipment", "correspondence", "enterprise_workflows", "risk", "ai_agents"],
    ),
    CompanyPreset(
        key="field_service",
        label="Field Service & Maintenance",
        description="Install, repair and maintain equipment at customer sites with mobile technicians.",
        icon="Wrench",
        section="services",
        tags=["Work orders", "Technicians", "Equipment", "Inspections"],
        enabled_modules=[*_BUSINESS_BASE, "service", "equipment", "schedule", "inspections", "portal"],
        optional_modules=["appointments", "contracts", "procurement", "supplier_catalogs", "safety", "risk", "ai_agents"],
    ),
    CompanyPreset(
        key="logistics",
        label="Logistics & Transport",
        description="Move goods for customers with your own fleet, drivers and delivery schedules.",
        icon="Route",
        section="services",
        tags=["Fleet", "Dispatch", "Safety", "Contracts"],
        enabled_modules=[*_BUSINESS_BASE, "equipment", "schedule", "safety", "contracts"],
        optional_modules=["procurement", "inspections", "risk", "service", "integrations", "ai_agents"],
    ),
    # Health & care
    CompanyPreset(
        key="medical_practice",
        label="Medical & Dental Practice",
        description="GP, specialist and dental practices: patients, appointments, cost plans, private billing and consumables.",
        icon="Stethoscope",
        section="health",
        tags=["Patients", "Appointments", "Private billing", "Consumables"],
        enabled_modules=[*_BUSINESS_BASE, "appointments", "schedule", "procurement", "supplier_catalogs", "qms", "inspections"],
        optional_modules=["portal", "equipment", "safety", "enterprise_workflows", "integrations", "ai_agents"],
        tax_hint=(
            "Medical and dental treatment is VAT-exempt in the EU (DE: § 4 Nr. 14 UStG). Treatment items "
            "default to the exempt tax code; cosmetic treatments, reports for insurers and product sales stay taxable."
        ),
    ),
    CompanyPreset(
        key="therapy_wellness",
        label="Therapy, Physio & Wellness",
        description="Physiotherapy, psychotherapy, osteopathy and wellness practices: clients, session series and packages.",
        icon="HeartPulse",
        section="health",
        tags=["Clients", "Session series", "Packages", "Appointments"],
        enabled_modules=[*_BUSINESS_BASE, "appointments", "schedule", "portal", "procurement"],
        optional_modules=["qms", "inspections", "contracts", "integrations", "ai_agents"],
        tax_hint=(
            "Therapy by licensed practitioners is usually VAT-exempt (DE: § 4 Nr. 14 UStG); "
            "wellness, fitness and product sales are taxable."
        ),
    ),
    CompanyPreset(
        key="beauty_salon",
        label="Beauty Salon & Spa",
        description="Hair, beauty, nail and spa businesses: bookings, treatments, retail products and gift vouchers.",
        icon="Sparkles",
        section="health",
        tags=["Bookings", "Treatments", "Retail products", "Vouchers"],
        enabled_modules=[*_BUSINESS_BASE, "appointments", "schedule", "procurement", "supplier_catalogs", "integrations"],
        optional_modules=["portal", "service", "inspections", "ai_agents"],
    ),
    # Hospitality & leisure
    CompanyPreset(
        key="restaurant_cafe",
        label="Restaurant & Café",
        description="Restaurants, cafés, bars and caterers: menus, suppliers, food cost, hygiene checks and events.",
        icon="UtensilsCrossed",
        section="hospitality",
        tags=["Food cost", "Suppliers", "Hygiene", "Events"],
        enabled_modules=[*_BUSINESS_BASE, "procurement", "supplier_catalogs", "inspections", "schedule"],
        optional_modules=["equipment", "qms", "safety", "contracts", "integrations", "ai_agents"],
        tax_hint=(
            "Food and drinks served on the premises carry the standard rate; takeaway food often has a "
            "reduced rate (DE: 7 %)."
        ),
    ),
    CompanyPreset(
        key="small_hotel",
        label="Hotel & Guesthouse",
        description="Small hotels, guesthouses and holiday lets: guests, room nights, groups, housekeeping and upkeep.",
        icon="BedDouble",
        section="hospitality",
        tags=["Guests", "Room nights", "Groups", "Housekeeping"],
        enabled_modules=[*_BUSINESS_BASE, "schedule", "service", "procurement", "inspections", "contracts"],
        optional_modules=["equipment", "portal", "safety", "integrations", "ai_agents"],
        tax_hint=(
            "Overnight stays carry a reduced VAT rate in many countries (DE: 7 %); breakfast, "
            "drinks and extras are taxed at the standard rate."
        ),
    ),
    CompanyPreset(
        key="fitness_studio",
        label="Fitness & Sports Studio",
        description="Gyms, yoga and dance studios: memberships, classes, trainers and equipment care.",
        icon="Dumbbell",
        section="hospitality",
        tags=["Memberships", "Classes", "Trainers", "Equipment"],
        enabled_modules=[*_BUSINESS_BASE, "appointments", "contracts", "schedule", "equipment", "integrations"],
        optional_modules=["portal", "service", "inspections", "safety", "ai_agents"],
    ),
    # Public & non-profit
    CompanyPreset(
        key="education_training",
        label="Education & Training",
        description="Academies, language schools and training providers: courses, enrolments, trainers and funded places.",
        icon="GraduationCap",
        section="public",
        tags=["Courses", "Enrolments", "Trainers", "Funding"],
        enabled_modules=[*_BUSINESS_BASE, "schedule", "contracts", "portal", "meetings"],
        optional_modules=["appointments", "funding", "qms", "enterprise_workflows", "integrations", "ai_agents"],
        tax_hint=(
            "Recognised education and vocational training is often VAT-exempt "
            "(DE: § 4 Nr. 21 UStG, with a certificate from the state authority)."
        ),
    ),
    CompanyPreset(
        key="nonprofit",
        label="Non-profit & Association",
        description="Charities, foundations and member associations managing grants, budgets and approvals.",
        icon="HeartHandshake",
        section="public",
        tags=["Members", "Grants", "Budgets", "Approvals"],
        enabled_modules=[*_BUSINESS_BASE, "funding", "meetings", "enterprise_workflows"],
        optional_modules=["portal", "contracts", "procurement", "correspondence", "risk", "ai_agents"],
    ),
]

# Every business module once, for the "all business apps" profile.
_BUSINESS_ALL = list(
    dict.fromkeys(m for p in _BUSINESS_PRESETS for m in [*p.enabled_modules, *p.optional_modules])
)
_BUSINESS_PRESETS.append(
    CompanyPreset(
        key="business_all",
        label="Something else",
        description="Start with every business app switched on and turn off what you do not use.",
        icon="LayoutGrid",
        tags=["All apps"],
        enabled_modules=_BUSINESS_ALL,
    )
)

#: Keys of the business profiles, in display order (the onboarding industry step).
BUSINESS_PRESET_KEYS: list[str] = [p.key for p in _BUSINESS_PRESETS]


COMPANY_PRESETS: dict[str, CompanyPreset] = {
    "general_contractor": CompanyPreset(
        key="general_contractor",
        label="General Contractor",
        description="We build projects end to end - estimating, procurement, site management and handover.",
        icon="Building2",
        tags=["BOQ", "Site", "Safety", "Finance"],
        enabled_modules=[
            "boq",
            "costs",
            "assemblies",
            "validation",
            "takeoff",
            "dwg_takeoff",
            "schedule",
            "tasks",
            "costmodel",
            "finance",
            "funding",
            "procurement",
            "changeorders",
            "contracts",
            "variations",
            "equipment",
            "resources",
            "daily_diary",
            "subcontractors",
            "payroll",
            "field_diary",
            "meetings",
            "rfi",
            "submittals",
            "transmittals",
            "documents",
            "markups",
            "inspections",
            "ncr",
            "safety",
            "punchlist",
            "risk",
            "qms",
            "moc",
            "fieldreports",
            "reporting",
            "project_controls",
            "bi_dashboards",  # project_controls depends on it
            "cad",  # takeoff depends on it
        ],
    ),
    "estimator": CompanyPreset(
        key="estimator",
        label="Cost Estimator / Quantity Surveyor",
        description="We price work - quantity takeoff, cost databases, BoQ and tender pricing.",
        icon="Calculator",
        tags=["Takeoff", "Costs", "BOQ", "Tender"],
        enabled_modules=[
            "boq",
            "costs",
            "assemblies",
            "validation",
            "cost_match",
            "takeoff",
            "dwg_takeoff",
            "ai",
            "tendering",
            "funding",
            "supplier_catalogs",
            "documents",
            "reporting",
            "cad",  # measuring from drawings
            "procurement",  # supplier_catalogs depends on it
        ],
    ),
    "architecture_engineering": CompanyPreset(
        key="architecture_engineering",
        label="Architecture / Engineering Office",
        description="We design buildings - BIM models, drawings, the CDE and design coordination.",
        icon="Pencil",
        tags=["BIM", "CDE", "Drawings", "RFI"],
        enabled_modules=[
            "takeoff",
            "dwg_takeoff",
            "documents",
            "markups",
            "rfi",
            "submittals",
            "transmittals",
            "correspondence",
            "boq",
            "costs",
            "validation",
            "requirements",
            "compliance_docs",
            "carbon",
            "reporting",
            "funding",
            "cad",  # takeoff depends on it
            "collaboration",  # opencde_api depends on it
        ],
    ),
    "construction_manager": CompanyPreset(
        key="construction_manager",
        label="Project / Construction Manager",
        description="We run the programme - schedule, cost control, communication and quality oversight.",
        icon="ClipboardList",
        tags=["Schedule", "RFI", "Cost control", "Quality"],
        enabled_modules=[
            "schedule",
            "schedule_advanced",
            "tasks",
            "costmodel",
            "eac",
            "meetings",
            "rfi",
            "submittals",
            "transmittals",
            "correspondence",
            "documents",
            "markups",
            "inspections",
            "ncr",
            "punchlist",
            "risk",
            "qms",
            "moc",
            "finance",
            "funding",
            "procurement",
            "changeorders",
            "contracts",
            "variations",
            "fieldreports",
            "daily_diary",
            "field_diary",
            "payroll",
            "boq",
            "costs",
            "requirements",
            "reporting",
            "bi_dashboards",
            "project_controls",
            "resources",  # payroll depends on it
        ],
    ),
    "real_estate_developer": CompanyPreset(
        key="real_estate_developer",
        label="Real Estate Developer",
        description="We develop and sell property - plots and buyers, budgets, contracts and handover.",
        icon="Home",
        tags=["Property", "Sales", "Finance", "Contracts"],
        enabled_modules=[
            "property_dev",
            "crm",
            "supplier_catalogs",
            "contracts",
            "variations",
            "finance",
            "funding",
            "procurement",
            "changeorders",
            "tendering",
            "bid_management",
            "schedule",
            "tasks",
            "costmodel",
            "boq",
            "costs",
            "documents",
            "portal",
            "meetings",
            "requirements",
            "carbon",
            "reporting",
            "bi_dashboards",
        ],
    ),
    "subcontractor": CompanyPreset(
        key="subcontractor",
        label="Subcontractor / Trade Contractor",
        description="We deliver a trade package - our scope, quantities, schedule and site paperwork.",
        icon="HardHat",
        tags=["Takeoff", "Schedule", "Site", "Safety"],
        enabled_modules=[
            "boq",
            "costs",
            "validation",
            "takeoff",
            "dwg_takeoff",
            "schedule",
            "tasks",
            "daily_diary",
            "field_diary",
            "payroll",
            "resources",
            "equipment",
            "fieldreports",
            "rfi",
            "submittals",
            "safety",
            "inspections",
            "punchlist",
            "changeorders",
            "variations",
            "documents",
            "funding",
            "markups",
            "contracts",  # pay applications to the main contractor
            "cad",  # takeoff depends on it
        ],
    ),
    "owner_client": CompanyPreset(
        key="owner_client",
        label="Owner / Client",
        description="We commission and oversee projects - reporting, documents, approvals and compliance.",
        icon="Briefcase",
        tags=["Reporting", "Documents", "Approvals"],
        enabled_modules=[
            "reporting",
            "bi_dashboards",
            "project_controls",
            "documents",
            "meetings",
            "rfi",
            "correspondence",
            "validation",
            "inspections",
            "requirements",
            "compliance",
            "finance",
            "funding",
            "schedule",
            "boq",
            "costs",
            "risk",
            "contracts",  # the owner signs the contract
            "changeorders",  # and approves every change to it
        ],
    ),
    "bim_vdc": CompanyPreset(
        key="bim_vdc",
        label="BIM / VDC Coordinator",
        description="We coordinate models - federation, clash detection, model requirements and the CDE.",
        icon="Box",
        tags=["BIM", "Clash", "CDE", "Requirements"],
        enabled_modules=[
            "takeoff",
            "dwg_takeoff",
            "cad",
            "documents",
            "markups",
            "requirements",
            "validation",
            "collaboration",
            "boq",
            "costs",
            "reporting",
            "funding",
        ],
    ),
    "civil_infrastructure": CompanyPreset(
        key="civil_infrastructure",
        label="Civil / Infrastructure Contractor",
        description="We build roads, bridges, earthworks and utilities - heavy plant, mass quantities and a tight programme.",
        icon="Construction",
        tags=["Earthworks", "Plant", "Schedule", "HSE"],
        enabled_modules=[
            "boq",
            "validation",
            "takeoff",
            "dwg_takeoff",
            "cad",
            "schedule",
            "schedule_advanced",
            "tasks",
            "costmodel",
            "eac",
            "finance",
            "funding",
            "procurement",
            "changeorders",
            "contracts",
            "variations",
            "equipment",
            "resources",
            "daily_diary",
            "subcontractors",
            "payroll",
            "field_diary",
            "fieldreports",
            "inspections",
            "ncr",
            "safety",
            "punchlist",
            "risk",
            "hse_advanced",
            "qms",
            "documents",
            "markups",
            "project_controls",
            "reporting",
            "carbon",
            "rfi",  # same RFI cycle as a building site
            "submittals",  # same submittal cycle
            "meetings",  # same site meetings
            "bi_dashboards",  # project_controls depends on it
        ],
    ),
    "mep_contractor": CompanyPreset(
        key="mep_contractor",
        label="MEP / Building Services Contractor",
        description="We install mechanical, electrical and plumbing systems - coordinated models, submittals and commissioning.",
        icon="Wrench",
        tags=["MEP", "Submittals", "Coordination", "Service"],
        enabled_modules=[
            "boq",
            "validation",
            "takeoff",
            "dwg_takeoff",
            "schedule",
            "tasks",
            "procurement",
            "funding",
            "supplier_catalogs",
            "submittals",
            "rfi",
            "transmittals",
            "inspections",
            "ncr",
            "punchlist",
            "service",
            "equipment",
            "resources",
            "daily_diary",
            "field_diary",
            "documents",
            "markups",
            "changeorders",
            "variations",
            "contracts",
            "reporting",
            "safety",  # live electrical, hot work, work at height
            "cad",  # takeoff depends on it
        ],
    ),
    "design_build": CompanyPreset(
        key="design_build",
        label="Design-Build Contractor",
        description="We carry a project from design into delivery - one team owning the model, the price and the build.",
        icon="PencilRuler",
        tags=["BIM", "Design", "Build", "Contracts"],
        enabled_modules=[
            "takeoff",
            "dwg_takeoff",
            "boq",
            "validation",
            "schedule",
            "tasks",
            "costmodel",
            "finance",
            "funding",
            "procurement",
            "contracts",
            "changeorders",
            "variations",
            "documents",
            "markups",
            "rfi",
            "submittals",
            "transmittals",
            "requirements",
            "inspections",
            "ncr",
            "safety",
            "carbon",
            "reporting",
            "cad",  # takeoff depends on it
            "collaboration",  # opencde_api depends on it
        ],
    ),
    "homebuilder": CompanyPreset(
        key="homebuilder",
        label="Home Builder / Residential",
        description="We build and sell homes - plots and buyers, a buildable budget, subcontractors and handover.",
        icon="House",
        tags=["Residential", "Sales", "Site", "Schedule"],
        enabled_modules=[
            "property_dev",
            "crm",
            "portal",
            "boq",
            "validation",
            "takeoff",
            "schedule",
            "tasks",
            "procurement",
            "funding",
            "subcontractors",
            "contracts",
            "changeorders",
            "variations",
            "daily_diary",
            "field_diary",
            "inspections",
            "punchlist",
            "safety",
            "documents",
            "markups",
            "reporting",
            "cad",  # takeoff depends on it
        ],
    ),
    "commercial_manager": CompanyPreset(
        key="commercial_manager",
        label="Commercial / Contracts Manager",
        description="We protect the margin - contracts, variations, progress claims, change and cost reporting.",
        icon="Handshake",
        tags=["Contracts", "Variations", "Claims", "Cost control"],
        enabled_modules=[
            "contracts",
            "variations",
            "changeorders",
            "procurement",
            "tendering",
            "bid_management",
            "boq",
            "finance",
            "eac",
            "full_evm",
            "correspondence",
            "rfi",
            "submittals",
            "documents",
            "risk",
            "reporting",
            "bi_dashboards",
            "project_controls",
        ],
    ),
    "procurement_manager": CompanyPreset(
        key="procurement_manager",
        label="Procurement / Supply Chain",
        description="We buy the work and the materials - tenders, supplier catalogues, subcontracts and orders.",
        icon="Truck",
        tags=["Procurement", "Tender", "Suppliers", "Contracts"],
        enabled_modules=[
            "procurement",
            "tendering",
            "rfq_bidding",
            "bid_management",
            "supplier_catalogs",
            "contracts",
            "changeorders",
            "variations",
            "boq",
            "subcontractors",
            "documents",
            "correspondence",
            "reporting",
            "bi_dashboards",
        ],
    ),
    "scheduler_planner": CompanyPreset(
        key="scheduler_planner",
        label="Planner / Scheduler",
        description="We own the programme - the critical path, resources, earned value and schedule risk.",
        icon="CalendarClock",
        tags=["Schedule", "Critical path", "EVM", "Risk"],
        enabled_modules=[
            "schedule",
            "schedule_advanced",
            "tasks",
            "costmodel",
            "eac",
            "full_evm",
            "project_controls",
            "risk",
            "resources",
            "equipment",
            "reporting",
            "funding",
            "bi_dashboards",
            "boq",  # bim_hub, costmodel, reporting, schedule depends on it
            "finance",  # full_evm depends on it
        ],
    ),
    "site_supervisor": CompanyPreset(
        key="site_supervisor",
        label="Site Manager / Superintendent",
        description="We run the site day to day - the diary, photos, labour and plant, inspections and the punch list.",
        icon="Hammer",
        tags=["Site diary", "Photos", "Safety", "Punch list"],
        enabled_modules=[
            "daily_diary",
            "field_diary",
            "fieldreports",
            "tasks",
            "schedule",
            "inspections",
            "punchlist",
            "safety",
            "ncr",
            "payroll",
            "resources",
            "equipment",
            "subcontractors",
            "rfi",
            "meetings",
            "documents",
            "funding",
            "markups",
            "collaboration",
            "boq",  # schedule depends on it
            "contracts",  # subcontractors depends on it
        ],
    ),
    "quality_manager": CompanyPreset(
        key="quality_manager",
        label="Quality Manager (QA/QC)",
        description="We prove the work is right - inspections, non-conformances, the QMS and the handover record.",
        icon="BadgeCheck",
        tags=["QA/QC", "Inspections", "NCR", "Handover"],
        enabled_modules=[
            "inspections",
            "ncr",
            "qms",
            "compliance",
            "compliance_docs",
            "requirements",
            "punchlist",
            "validation",
            "documents",
            "markups",
            "submittals",
            "transmittals",
            "fieldreports",
            "meetings",
            "reporting",
            "boq",  # bim_hub, reporting, validation depends on it
        ],
    ),
    "hse_manager": CompanyPreset(
        key="hse_manager",
        label="Health, Safety & Environment",
        description="We keep the site safe and compliant - safety plans, incidents, risk and environmental duties.",
        icon="ShieldCheck",
        tags=["Safety", "Incidents", "Risk", "Compliance"],
        enabled_modules=[
            "safety",
            "hse_advanced",
            "inspections",
            "ncr",
            "punchlist",
            "risk",
            "compliance",
            "compliance_docs",
            "requirements",
            "fieldreports",
            "daily_diary",
            "field_diary",
            "documents",
            "meetings",
            "reporting",
            "carbon",
            "boq",  # bim_hub, reporting depends on it
        ],
    ),
    "sustainability_esg": CompanyPreset(
        key="sustainability_esg",
        label="Sustainability / ESG Lead",
        description="We measure and cut impact - embodied and operational carbon, ESG evidence and reporting.",
        icon="Leaf",
        tags=["Carbon", "ESG", "LCA", "Reporting"],
        enabled_modules=[
            "carbon",
            "compliance",
            "compliance_docs",
            "requirements",
            "validation",
            "bi_dashboards",
            "reporting",
            "funding",
            "documents",
            "boq",  # bim_hub, reporting, validation depends on it
        ],
    ),
    "facility_manager": CompanyPreset(
        key="facility_manager",
        label="Facility / Asset Manager",
        description="We operate the finished asset - maintenance, equipment, compliance and whole-life cost.",
        icon="Building",
        tags=["O&M", "Assets", "Maintenance", "Compliance"],
        enabled_modules=[
            "service",
            "equipment",
            "resources",
            "documents",
            "inspections",
            "ncr",
            "compliance",
            "compliance_docs",
            "requirements",
            "safety",
            "hse_advanced",
            "schedule",
            "tasks",
            "finance",
            "funding",
            "procurement",
            "portal",
            "reporting",
            "bi_dashboards",
            "carbon",
            "boq",  # bim_hub, reporting, schedule depends on it
        ],
    ),
    "government_agency": CompanyPreset(
        key="government_agency",
        label="Public Sector / Government Agency",
        description="We commission public works - tenders, compliance, contracts and independent oversight.",
        icon="Landmark",
        tags=["Tendering", "Compliance", "Contracts", "Oversight"],
        enabled_modules=[
            "tendering",
            "bid_management",
            "rfq_bidding",
            "contracts",
            "compliance",
            "compliance_docs",
            "requirements",
            "validation",
            "documents",
            "correspondence",
            "meetings",
            "finance",
            "funding",
            "boq",
            "risk",
            "inspections",
            "reporting",
            "bi_dashboards",
            "project_controls",
            "procurement",  # rfq_bidding depends on it
        ],
    ),
    **{p.key: p for p in _BUSINESS_PRESETS},
    "full_enterprise": CompanyPreset(
        key="full_enterprise",
        label="Full Enterprise",
        description="We need the whole platform - every module across the full construction lifecycle.",
        icon="Boxes",
        tags=[],
        enabled_modules=list(_ALL_FUNCTIONAL),
    ),
}


# ── Company-size presets ──────────────────────────────────────────────────────
# A parallel dimension to the role grid above. Where ``COMPANY_PRESETS`` answers
# "what kind of work do you do", these answer "how big is your team". The
# onboarding wizard no longer offers them: team size says how many people use
# the tool, not which tools they use, so the wizard asks what the company does.
# They stay served and saveable because accounts that picked one keep its key
# as their ``company_type`` (and ``company_size``), and a stored answer has to
# read back and save again unchanged.
#
# They reuse the exact same machinery: a size maps to a functional-module set
# which ``modules_for`` turns into the ``module_preferences`` map the sidebar
# honours (core modules are always merged in, so a size can never hide
# Projects/Settings/costs/catalog/assemblies). Kept intentionally separate from
# ``COMPANY_PRESETS`` so the two dimensions never pollute each other's grid; the
# keys carry a ``size_`` prefix and still satisfy the onboarding id regex
# ``^[a-z][a-z0-9_]{1,48}$``.
SIZE_PRESETS: dict[str, CompanyPreset] = {
    "size_solo": CompanyPreset(
        key="size_solo",
        label="Solo / Freelancer",
        description="Just me - quick takeoff, a priced BoQ and a clean report, without the overhead.",
        icon="HardHat",
        tags=["Takeoff", "BOQ", "Reports"],
        enabled_modules=[
            "boq",
            "takeoff",
            "validation",
            "ai",
            "reporting",
            "cad",  # takeoff depends on it
        ],
    ),
    "size_small": CompanyPreset(
        key="size_small",
        label="Small Team",
        description="A handful of us - estimating, a schedule, procurement and the day-to-day paperwork.",
        icon="Briefcase",
        tags=["Estimating", "Schedule", "Procurement"],
        enabled_modules=[
            "boq",
            "validation",
            "cost_match",
            "takeoff",
            "dwg_takeoff",
            "ai",
            "schedule",
            "tasks",
            "procurement",
            "changeorders",
            "contracts",
            "variations",
            "documents",
            "markups",
            "reporting",
            "cad",  # takeoff depends on it
        ],
    ),
    "size_medium": CompanyPreset(
        key="size_medium",
        label="Mid-sized Company",
        description="A full contractor - estimating, site, procurement, quality and cost control end to end.",
        icon="Building2",
        tags=["Site", "Finance", "Quality"],
        # Mirror the broad general-contractor role set: a mid-sized company
        # typically runs the same wide span of the lifecycle. Reused from the
        # role grid so the two never drift.
        enabled_modules=list(COMPANY_PRESETS["general_contractor"].enabled_modules),
    ),
    "size_large": CompanyPreset(
        key="size_large",
        label="Large Enterprise",
        description="The whole organisation - every module across the full construction lifecycle.",
        icon="Boxes",
        tags=["Enterprise", "All modules", "Lifecycle"],
        enabled_modules=list(_ALL_FUNCTIONAL),
    ),
}


def get_preset(company_type: str) -> CompanyPreset | None:
    """Return a preset by key, or ``None`` if unknown."""
    return COMPANY_PRESETS.get(company_type)


def get_size_preset(company_size: str) -> CompanyPreset | None:
    """Return a company-size preset by key, or ``None`` if unknown."""
    return SIZE_PRESETS.get(company_size)


def is_saveable_company_type(key: str) -> bool:
    """Whether ``key`` may be saved as a user's ``company_type``.

    Both catalogues count. The onboarding wizard offers only the company
    profiles now, but accounts that chose a team size in an earlier release
    carry a ``size_*`` key as their ``company_type``, and a client built
    before that change still sends one. Refusing those would turn an answer
    the user already gave into an error on their next save.
    """
    return key in COMPANY_PRESETS or key in SIZE_PRESETS


def is_saveable_company_size(key: str) -> bool:
    """Whether ``key`` may be saved as a user's ``company_size``."""
    return key in SIZE_PRESETS


def get_all_presets() -> list[dict[str, Any]]:
    """Return all presets as serialisable dicts (for the GET endpoint)."""
    return [p.to_dict() for p in COMPANY_PRESETS.values()]


def get_all_size_presets() -> list[dict[str, Any]]:
    """Return all company-size presets as serialisable dicts (for the GET endpoint)."""
    return [p.to_dict() for p in SIZE_PRESETS.values()]


def _core_for(pack: str) -> list[str]:
    return list(_CORE_MODULES) if pack == "business" else [*_CORE_MODULES, *CONSTRUCTION_CORE]


def is_core_module(key: str, pack: str = "construction") -> bool:
    """Whether a module key is always-on (never disabled by a profile of ``pack``)."""
    return key in _core_for(pack)


def get_core_modules(pack: str = "construction") -> list[str]:
    """The always-on module keys, in the order they are declared.

    The profile picker needs this to tell a reader the truth about a switch.
    Every preset's ``enabled_modules`` is the *functional* set, and some of
    them re-list a core key, so a screen that subtracts one profile from
    another without knowing which keys are core reports modules as lost that
    nothing can lose. Returns a copy, because the caller is a serialiser and a
    handed-out module-level list is one mutation away from a profile that can
    hide Projects.
    """
    return _core_for(pack)


def modules_for(enabled_modules: list[str], pack: str = "construction") -> dict[str, bool]:
    """Build the full ``module_preferences`` map for a chosen module set.

    Every module a profile governs is given an explicit ``True``/``False`` so
    the sidebar can hide what the profile leaves out. Core modules are forced
    on, so a profile can never hide Projects, Settings, the admin area, etc.

    Regional packs are governed by the market, not the role, so they get no
    entry at all and keep whatever the region step or the applied partner pack
    decided. Writing ``False`` for them, which is what iterating the whole
    registry used to do, told every reader their country pack was switched off.
    """
    chosen = set(enabled_modules)
    regional = set(_REGIONAL)
    core = set(_core_for(pack))
    prefs: dict[str, bool] = {}
    for key in _ALL_MODULES:
        if key in regional:
            continue
        prefs[key] = True if key in core else key in chosen
    return prefs
