"""Business demo cases: one coherent sample company per business preset.

Each case seeds CRM customers/suppliers and a deal pipeline, ~5 months of
order-to-cash history through :class:`SalesService` (quotes in every state,
orders, invoices paid / due / overdue, payments posted to the GL), supplier
costs posted to the GL, purchase orders and a few tasks. Deterministic (seeded
per case) and idempotent: a GL entry ``source_type="business_demo"`` with the
case key as ``source_id`` marks a case as installed.
"""

from __future__ import annotations

import logging
import random
import uuid
import zlib
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta
from decimal import ROUND_CEILING, Decimal
from typing import Any

from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.business_settings import read_business_settings
from app.modules.crm.models import Account, Opportunity, OpportunityStageHistory, PipelineStage
from app.modules.gl.models import DEFAULT_TENANT, GLAccount, GLFiscalYear, GLJournalEntry, GLJournalLine
from app.modules.gl.service import GLService, LineInput, base_currency
from app.modules.sales.service import LineData, SalesService, default_tax_rate, money

logger = logging.getLogger(__name__)

MARKER_SOURCE = "business_demo"
EXPENSE_SOURCE = "business_demo_expense"
D = Decimal

# GL codes the demo posts costs to, per chart template the sales module knows.
EXPENSE_ACCOUNTS: dict[str, dict[str, str]] = {
    "de_skr03": {
        "bank": "1200", "equity": "0800", "input_vat": "1576", "goods": "3400", "services": "3100",
        "rent": "4210", "wages": "4120", "marketing": "4600", "software": "4806", "other": "4900",
        "revenue": "8400", "payables": "1600", "inventory": "3980", "cogs": "3400", "loan": "0630", "interest": "2100",
    },
    "ifrs_generic": {
        "bank": "1710", "equity": "3000", "input_vat": "1450", "goods": "5000", "services": "5100",
        "rent": "5400", "wages": "5200", "marketing": "5500", "software": "5500", "other": "5500",
        "revenue": "4000", "payables": "2200", "inventory": "1300", "cogs": "5000", "loan": "2000", "interest": "5600",
    },
}
NO_VAT_CATEGORIES = {"wages"}

_CRM_STAGES = (
    ("lead", "Lead", 0, 10, False, False, False, "#94a3b8"),
    ("qualified", "Qualified", 1, 25, False, False, False, "#38bdf8"),
    ("proposal", "Proposal", 2, 50, False, False, False, "#a78bfa"),
    ("negotiation", "Negotiation", 3, 75, False, False, False, "#f59e0b"),
    ("won", "Won", 4, 100, True, True, False, "#22c55e"),
    ("lost", "Lost", 5, 0, True, False, True, "#ef4444"),
)


class BusinessDemoError(Exception):
    pass


@dataclass(frozen=True)
class Case:
    key: str
    company: str
    country: str
    industry: str
    summary: str
    customers: list[tuple[str, str]]  # (name, ISO2)
    suppliers: list[tuple[str, str, str]]  # (name, ISO2, cost category)
    expenses: list[tuple[str, str, int]]  # (label, category, monthly net)
    deals: list[str]
    tasks: list[str]
    b2c: bool = False
    payment_days: int = 30
    quotes: int = 36
    lines_per_doc: tuple[int, int] = (1, 4)
    extra: dict[str, Any] = field(default_factory=dict)


CASES: dict[str, Case] = {
    c.key: c
    for c in (
        Case(
            key="trade_distribution",
            company="Kestrelmark Handel GmbH",
            country="DE",
            industry="Wholesale",
            summary="B2B wholesaler of industrial consumables and packaging, Hamburg.",
            customers=[
                ("Kestner Maschinenbau GmbH", "DE"), ("Varnholt Logistik AG", "DE"), ("Dornquist Metallwaren KG", "DE"),
                ("Zellbrook Verpackung GmbH", "DE"), ("Veldmoor Industrie B.V.", "NL"), ("Tallvik Produktion AB", "SE"),
                ("Brodavka Strojírny s.r.o.", "CZ"), ("Atelier Corvelle SARL", "FR"), ("Felsgrat Werkzeuge GmbH", "AT"),
                ("Valtorne Componenti S.r.l.", "IT"), ("Brzozel Przemysł Sp. z o.o.", "PL"), ("Wendt & Söhne OHG", "DE"),
                ("Quellhain Lebensmitteltechnik GmbH", "DE"), ("Ironhollow Fasteners Inc.", "US"),
            ],
            suppliers=[
                ("Morvenau Industriebedarf GmbH", "DE", "goods"), ("Kuusela Packaging Oy", "FI", "goods"),
                ("Stalwen Steel Components S.A.", "PL", "goods"), ("Spedition Ravensold GmbH", "DE", "services"),
                ("Kaiwerk Lagerflächen GmbH", "DE", "rent"),
            ],
            expenses=[
                ("Warehouse rent Hamburg", "rent", 6800), ("Salaries", "wages", 30000),
                ("Freight forwarding", "services", 4200), ("ERP and EDI subscriptions", "software", 890),
                ("Trade fair and catalogue", "marketing", 1500),
            ],
            deals=[
                "Framework agreement packaging 2027", "Quarterly glove supply", "Fastener vendor-managed inventory",
                "New warehouse consumables bundle", "Export programme Scandinavia", "Cleaning supplies annual contract",
                "Pallet equipment refresh", "Annual label contract",
            ],
            tasks=[
                "Renegotiate freight rates with Spedition Ravensold", "Chase overdue invoices over 30 days",
                "Stock count main warehouse", "Update price list for Q1", "Onboard new customer Veldmoor Industrie",
            ],
            quotes=42,
        ),
        Case(
            key="professional_services",
            company="Brightwell Advisory Partners",
            country="NL",
            industry="Management consulting",
            summary="Management and finance consulting boutique, Amsterdam.",
            customers=[
                ("Duinhaven Foods B.V.", "NL"), ("Lindewaard Housing Cooperative", "NL"), ("Stroomvaart Energy Services N.V.", "NL"),
                ("Kaaiwerk Port Services NV", "BE"), ("Hellmark Privatbank AG", "DE"), ("Vermelin Santé Groupe", "FR"),
                ("Corrigan Fintech Labs Ltd", "IE"), ("Skovlund Design Retail ApS", "DK"), ("Strehlau Mobility GmbH", "AT"),
                ("Arrietza Renewables S.L.", "ES"), ("Kestridge Insurance Group plc", "GB"), ("Ambercove Capital LLC", "US"),
            ],
            suppliers=[
                ("Grachtzijde Offices B.V.", "NL", "rent"), ("Freelance Analytics Collective", "NL", "services"),
                ("Quorvane Research Ltd", "GB", "software"), ("Vliegwiel Travel Desk B.V.", "NL", "other"),
            ],
            expenses=[
                ("Office rent Amsterdam", "rent", 5200), ("Salaries", "wages", 46000),
                ("Associate consultants", "services", 6500), ("Research databases", "software", 1400),
                ("Travel", "other", 1800),
            ],
            deals=[
                "Operating model redesign", "Post-merger integration support", "Pricing strategy review",
                "Finance function benchmarking", "Vendor due diligence", "Board advisory retainer 2027",
                "Cost reduction programme", "ESG reporting readiness",
            ],
            tasks=[
                "Prepare steering committee deck for Stroomvaart Energy", "Staff plan for Q1 engagements",
                "Send timesheet reminders", "Renew professional indemnity insurance", "Write case study Duinhaven Foods",
            ],
            quotes=30,
            lines_per_doc=(1, 3),
        ),
        Case(
            key="manufacturing",
            company="Ferncraig Furniture Works Ltd",
            country="IE",
            industry="Furniture manufacturing",
            summary="Solid-wood furniture maker supplying retailers and hotels, Cork.",
            customers=[
                ("Ardmorrow Home Interiors Ltd", "IE"), ("Clonfern Hotels Group", "IE"), ("Brackenlee Office Interiors Ltd", "IE"),
                ("Tullagh Design Store", "IE"), ("Saltmere Living Ltd", "GB"), ("Glenvarrow Boutique Hotels Ltd", "GB"),
                ("Möbelhaus Wendrich GmbH", "DE"), ("Maison & Bois SARL", "FR"), ("Fjällrum Interiör AB", "SE"),
                ("Casa Ombrella Arredamenti S.r.l.", "IT"), ("Copperline Loft Furnishings Inc.", "US"), ("Quayhouse Co-Working Hub", "IE"),
            ],
            suppliers=[
                ("Ozolkalns Timber SIA", "LV", "goods"), ("Ballyrook Hardware Supplies Ltd", "IE", "goods"),
                ("Glanswerk Finishing Oils B.V.", "NL", "goods"), ("Rathgowan Industrial Estates Ltd", "IE", "rent"),
                ("Wavecrest Freight Ltd", "IE", "services"),
            ],
            expenses=[
                ("Factory rent", "rent", 7500), ("Salaries and wages", "wages", 52000),
                ("Outbound freight", "services", 3100), ("Machine maintenance", "other", 1600),
            ],
            deals=[
                "Hotel refurbishment 120 rooms", "Retail collection autumn line", "Co-working desks rollout",
                "Restaurant seating package", "Export distributor Germany", "Bespoke boardroom table",
                "Student housing furniture", "Showroom display set",
            ],
            tasks=[
                "Order kiln-dried oak for December batch", "Quality check finish on chair series C01",
                "Plan production week 48", "Service the CNC router", "Photograph new walnut collection",
            ],
            quotes=34,
        ),
        Case(
            key="retail_ecommerce",
            company="Little Fern Online Store",
            country="FR",
            industry="E-commerce",
            summary="Online shop for sustainable home and kitchen goods, Lyon.",
            b2c=True,
            payment_days=7,
            quotes=48,
            lines_per_doc=(1, 3),
            customers=[
                ("Camille Durand", "FR"), ("Julien Lefèvre", "FR"), ("Sophie Martin", "FR"), ("Lucas Bernard", "FR"),
                ("Emma Petit", "FR"), ("Hugo Laurent", "FR"), ("Léa Moreau", "FR"), ("Nicolas Girard", "FR"),
                ("Anna Schmidt", "DE"), ("Marco Bianchi", "IT"), ("Laura García", "ES"), ("Pieter de Vries", "NL"),
                ("Boutique Écolo Verdelune", "FR"), ("Concept Store Mirabelle SARL", "FR"), ("Café Botanique Fleurac", "FR"),
            ],
            suppliers=[
                ("Verre & Céramique Atelier SAS", "FR", "goods"), ("Bamboo Goods Wholesale Ltd", "GB", "goods"),
                ("Colivra Business Services", "FR", "services"), ("Vitrinéo Platform SAS", "FR", "software"),
                ("Social Ads Agency Pixane", "FR", "marketing"),
            ],
            expenses=[
                ("Parcel shipping", "services", 1900), ("Shop platform and payments", "software", 420),
                ("Online advertising", "marketing", 2200), ("Salaries", "wages", 9800),
            ],
            deals=[
                "Wholesale order concept stores", "Corporate gifts year-end", "Café merchandise partnership",
                "Marketplace listing expansion", "Subscription box pilot", "Wedding list partnership",
            ],
            tasks=[
                "Prepare Black Friday campaign", "Reorder bestselling glass bottles", "Answer open customer returns",
                "Photograph spring collection", "Review shipping tariffs",
            ],
        ),
        Case(
            key="field_service",
            company="Kaltavia Klimaservice GmbH",
            country="AT",
            industry="HVAC service",
            summary="Heating, ventilation and air-conditioning maintenance and repair, Vienna.",
            customers=[
                ("Hotel Auwinkel GmbH", "AT"), ("Bürozentrum Lindgrund KG", "AT"), ("Gesundheitszentrum Talwies Betriebs GmbH", "AT"),
                ("Supermarkt Hollerer & Co", "AT"), ("Privatschule Sonnhalde", "AT"), ("Wohnhausverwaltung Grabner", "AT"),
                ("Bäckerei Mairhofer", "AT"), ("Datenhalle Ostbrück GmbH", "AT"), ("Fitnessstudio Vitalwerk", "AT"),
                ("Autohaus Steinwender", "AT"), ("Restaurant Zum Silbernen Kranich", "AT"), ("Pharmalog Vendura GmbH", "AT"),
                ("Dunavec Office Park s.r.o.", "SK"),
            ],
            suppliers=[
                ("Frostlinde Kältetechnik Großhandel GmbH", "AT", "goods"), ("Filter & Luft Vertriebs GmbH", "DE", "goods"),
                ("Fuhrpark Leasing Rovena", "AT", "other"), ("Gewerbehof Kranzbach", "AT", "rent"),
            ],
            expenses=[
                ("Salaries technicians", "wages", 41000),
                ("Van leasing and fuel", "other", 3900), ("Workshop rent", "rent", 2800),
                ("Field service app", "software", 520),
            ],
            deals=[
                "Hospital ventilation service contract", "Hotel AC replacement 40 rooms", "Data centre cooling audit",
                "Supermarket chain maintenance 6 sites", "Office park heat pump retrofit", "School ventilation upgrade",
            ],
            tasks=[
                "Schedule winter boiler checks", "Renew F-gas certificates for two technicians",
                "Restock vans with filters", "Follow up quote Datenhalle Ostbrück", "Plan route for Monday call-outs",
            ],
            quotes=40,
            payment_days=14,
        ),
        Case(
            key="logistics",
            company="Wirelka Forwarding Sp. z o.o.",
            country="PL",
            industry="Freight forwarding",
            summary="Road and sea freight forwarder between Central Europe and the Nordics, Gdańsk.",
            customers=[
                ("Sosnowa Meble S.A.", "PL"), ("Morwen Seafood Export Sp. z o.o.", "PL"), ("Wiślan Electronics Sp. z o.o.", "PL"),
                ("Papiernia Jodłowa S.A.", "PL"), ("Hemvind Retail AB", "SE"), ("Fjordheim Home Supplies AS", "NO"),
                ("Kaskmäe Trade OÜ", "EE"), ("Travenhof Spedition Partner GmbH", "DE"), ("Veenhoek Fresh Produce B.V.", "NL"),
                ("Ąžuolis Auto Parts UAB", "LT"), ("Koivuranta Wholesale Oy", "FI"), ("Prairiecrest Machinery Imports LLC", "US"),
                ("Lyngholt Garden Products A/S", "DK"),
            ],
            suppliers=[
                ("Drogwen Carriers Sp. z o.o.", "PL", "services"), ("Vågsund Ferry Lines AB", "SE", "services"),
                ("Paliwex Fuel Card Sp. z o.o.", "PL", "other"), ("Nabrzeże Warehousing", "PL", "rent"),
                ("Spurlicht Telematics GmbH", "DE", "software"),
            ],
            expenses=[
                ("Partner carriers", "services", 58000), ("Ferry bookings", "services", 9500),
                ("Fuel", "other", 7200), ("Warehouse lease", "rent", 6100), ("Salaries dispatch and office", "wages", 24000),
                ("Telematics", "software", 650),
            ],
            deals=[
                "Weekly FTL lane Gdańsk to Oslo", "Seafood reefer programme", "Furniture export consolidation",
                "Contract logistics 1,200 pallets", "Customs brokerage outsourcing", "US import consolidation",
                "Peak season capacity agreement",
            ],
            tasks=[
                "Confirm ferry slots for next week", "Audit carrier insurance certificates", "Update fuel surcharge table",
                "Resolve damaged pallet claim Hemvind Retail", "Plan driver rest schedules",
            ],
            quotes=44,
            lines_per_doc=(1, 3),
        ),
        Case(
            key="it_agency",
            company="Quillbright Digital Ltd",
            country="GB",
            industry="Digital agency",
            summary="Web, app and digital-marketing agency for mid-sized brands, Manchester.",
            customers=[
                ("Ironvale Rail Heritage Trust", "GB"), ("Highcairn Outdoor Ltd", "GB"), ("Tollbridge Craft Brewery", "GB"),
                ("Ravensby Legal LLP", "GB"), ("Spokewell Bike Co.", "GB"), ("Thistlegate Fashion House Ltd", "GB"),
                ("Brynmor Dental Group", "GB"), ("Flinkrad Mobility GmbH", "DE"), ("Feestpoort Event Tickets B.V.", "NL"),
                ("Emberline Coffee Roasters Inc.", "US"), ("Marésia Surf Schools Lda", "PT"), ("Dalesbury Tea Rooms Ltd", "GB"),
                ("Linwick Language Courses Ltd", "GB"),
            ],
            suppliers=[
                ("Nimbusworth Hosting Ltd", "GB", "software"), ("Freelance Dev Network", "GB", "services"),
                ("Millrace Studios Workspace", "GB", "rent"), ("Framewell Media Library Ltd", "GB", "software"),
            ],
            expenses=[
                ("Salaries", "wages", 52000), ("Freelance developers", "services", 8800),
                ("Studio rent", "rent", 4600), ("Hosting and SaaS tools", "software", 2100),
                ("Conferences and marketing", "marketing", 900),
            ],
            deals=[
                "E-commerce replatforming", "Mobile booking app", "Brand refresh and website", "Headless CMS migration",
                "Annual SEO retainer", "Accessibility audit and fixes", "Customer portal MVP",
            ],
            tasks=[
                "Sprint review with Spokewell Bike Co.", "Renew SSL certificates for hosted clients",
                "Update rate card for 2027", "Security patching on managed hosting", "Draft proposal for Ravensby Legal LLP",
            ],
            quotes=32,
            lines_per_doc=(1, 3),
        ),
        Case(
            key="nonprofit",
            company="Grünfeder Umweltverein e.V.",
            country="DE",
            industry="Non-profit",
            summary="Environmental education association running courses, events and member programmes, Leipzig.",
            customers=[
                ("Umweltamt Kreisstadt Auenried", "DE"), ("Stiftung Naturerbe Wiesental", "DE"), ("Grundschule am Erlenbruch", "DE"),
                ("Volkshochschule Auenried", "DE"), ("BioMarkt Kornblume eG", "DE"), ("Energiewerke Talgrund AG", "DE"),
                ("Hochschule Auenried Fachbereich Biologie", "DE"), ("Familienzentrum Weidenhof", "DE"),
                ("Horizon Youth Network", "BE"), ("Klimabündnis Elbtalwiesen e.V.", "DE"), ("Gartenfreunde Sonnenwinkel", "DE"),
            ],
            suppliers=[
                ("Druckerei Papierkranich GmbH", "DE", "marketing"), ("Seminarhaus Schilfufer", "DE", "rent"),
                ("Bio-Catering Löwenzahn", "DE", "services"), ("Vereinswerk Online GmbH", "DE", "software"),
            ],
            expenses=[
                ("Staff salaries", "wages", 21000), ("Office and seminar rooms", "rent", 1900),
                ("Catering for events", "services", 1100), ("Printing and outreach", "marketing", 700),
                ("Membership software", "software", 140),
            ],
            deals=[
                "Municipal environmental education grant", "Foundation programme funding 2027",
                "Corporate volunteering day Energiewerke", "School partnership network", "EU youth exchange project",
                "Annual sponsorship BioMarkt",
            ],
            tasks=[
                "Submit grant report to Stiftung Naturerbe", "Prepare general assembly invitations",
                "Collect member fees for 2027", "Book seminar house for spring camp", "Recruit volunteers for tree planting",
            ],
            quotes=26,
            lines_per_doc=(1, 2),
        ),
        Case(
            key="craft_trades",
            company="Vossberg Elektrotechnik GmbH",
            country="DE",
            industry="Electrical trade",
            summary="Electrical installation, testing and e-mobility business with eight electricians, Stuttgart.",
            customers=[
                ("Hausverwaltung Kesselbach GmbH", "DE"), ("Wohnbau Talblick eG", "DE"), ("Bäckerei Wolfsried KG", "DE"),
                ("Autohaus Brennwald GmbH", "DE"), ("Hotel Rosenhain Betriebs GmbH", "DE"),
                ("Praxisgemeinschaft am Lindenring", "DE"), ("Kita Pusteblume e.V.", "DE"),
                ("Weinstube Rebstöckle", "DE"), ("Schreinerei Voglreiter", "DE"), ("Familie Maier", "DE"),
                ("WEG Birkenweg 12", "DE"), ("Druckerei Lämmerhof GmbH", "DE"),
            ],
            suppliers=[
                ("Elektrogroßhandel Voltaris GmbH", "DE", "goods"), ("Kabelwerk Drahtquell GmbH", "DE", "goods"),
                ("Flottenservice Radwerk GmbH", "DE", "services"), ("Gewerbehof Funkenried GmbH", "DE", "rent"),
            ],
            expenses=[
                ("Workshop and storage rent", "rent", 2400), ("Salaries", "wages", 38000),
                ("Van leasing and fuel", "services", 2600), ("Job and time-capture software", "software", 290),
                ("Online listings and vehicle lettering", "marketing", 450),
            ],
            deals=[
                "Wallbox rollout Autohaus Brennwald", "Annual DGUV V3 testing contract", "LED retrofit for bakery branches",
                "Rewiring of 12 flats Wohnbau Talblick", "Smart home upgrade Familie Maier",
                "Emergency service agreement Hausverwaltung Kesselbach", "Kita electrical safety check",
                "PV maintenance for Druckerei Lämmerhof",
            ],
            tasks=[
                "Order materials for the Maier kitchen rewiring", "DGUV V3 testing round at Hotel Rosenhain",
                "Renew van leases", "Chase final invoice WEG Birkenweg", "Plan apprentice exam preparation",
            ],
            payment_days=14,
            quotes=40,
        ),
        Case(
            key="food_production",
            company="Almtaler Hofkäserei Zennbach GmbH",
            country="DE",
            industry="Food production",
            summary="Farm dairy making mountain cheese, butter and yoghurt from local hay milk, Allgäu.",
            customers=[
                ("Feinkost Gamsgrat KG", "DE"), ("Biomarkt Wiesengrund eG", "DE"), ("Gasthof Zum Hirschsprung", "DE"),
                ("Käsehandel Lindhuber GmbH", "DE"), ("Hotel Gipfelruh", "DE"), ("Metzgerei Hubmann Partyservice", "DE"),
                ("Hofladen-Kooperative Almwiese eG", "DE"), ("Betriebskantine Energiewerke Talgrund", "DE"),
                ("Fromagerie Dubrelle", "FR"), ("Feinkost Seewinkel AG", "CH"), ("Delikatessen Rovelli", "IT"),
            ],
            suppliers=[
                ("Milchhof Weberling GbR", "DE", "goods"), ("Molkereibedarf Kannwerk GmbH", "DE", "goods"),
                ("Kühltransporte Frostfalke GmbH", "DE", "services"), ("Hofgut Hubmann Verpachtung", "DE", "rent"),
            ],
            expenses=[
                ("Dairy and ripening cellar lease", "rent", 2900), ("Salaries", "wages", 22000),
                ("Refrigerated transport", "services", 2100), ("Energy for cooling and boiler", "other", 3200),
                ("Hygiene lab testing", "other", 450), ("Markets and tastings", "marketing", 600),
                ("Batch tracking software", "software", 180),
            ],
            deals=[
                "Cheese counter listing Biomarkt Wiesengrund", "Hotel breakfast supply 2027", "Christmas gift boxes for Energiewerke Talgrund",
                "Export trial Fromagerie Dubrelle", "Canteen dairy supply contract", "Wedding season platters Hubmann",
                "Mountain cheese 12 months for Käsehandel Lindhuber",
            ],
            tasks=[
                "Monthly hygiene swab sampling", "Turn and brush cheese in cellar 2", "Renew organic certification audit",
                "Calibrate cold store temperature loggers", "Plan Christmas gift box production",
            ],
            payment_days=14,
            quotes=36,
            extra={"rates": {"Hard cheese": 7, "Soft cheese": 7, "Dairy": 7, "Gift boxes": 7, "Platters": 7}},
        ),
        Case(
            key="franchise_multisite",
            company="Bohnquell Franchise GmbH",
            country="DE",
            industry="Franchise system",
            summary="Coffee bar franchisor with its own roastery and nine franchise locations, Cologne.",
            customers=[
                ("Hartwig Gastro GmbH (Bohnquell Nord)", "DE"), ("Kaya & Schulte OHG (Bohnquell Altstadt)", "DE"),
                ("Café Uferweg Partners GmbH (Bohnquell Ufer)", "DE"),
                ("Brandauer Systemgastronomie GmbH (Bohnquell West)", "DE"),
                ("Vermolen Koffie B.V. (Bohnquell Grens)", "NL"), ("Lenz & Lenz GbR (Bohnquell Domplatz)", "DE"),
                ("Sauerbrey Food Concepts GmbH (Bohnquell Zeche)", "DE"), ("Petit Café Mosane SRL (Bohnquell Meuse)", "BE"),
                ("Nowaczyk Gastronomie UG (Bohnquell Talbahn)", "DE"),
            ],
            suppliers=[
                ("Rohkaffee Import Kaffeespeicher GmbH", "DE", "goods"), ("Finca Cerro Nublino Exportadora S.A.", "CO", "goods"),
                ("Gastro-Service Tafelwerk GmbH", "DE", "services"), ("Gewerbehof Ziegelfeld GmbH", "DE", "rent"),
            ],
            expenses=[
                ("Roastery and head office rent", "rent", 5200), ("Salaries", "wages", 34000),
                ("Machine servicing for the network", "services", 2800), ("Brand campaigns", "marketing", 4500),
                ("POS and franchise portal", "software", 1200),
            ],
            deals=[
                "New location Bohnquell Bahnhof", "Second site Hartwig Gastro", "Seasonal menu launch spring",
                "Franchise agreement renewal Kaya & Schulte", "Oat drink supply framework", "Airport kiosk concept",
                "Master franchise Benelux",
            ],
            tasks=[
                "Quarterly brand audit Bohnquell Zeche", "Roast plan for the new espresso blend",
                "Send royalty statements for October", "Barista training for the Grens team",
                "Review franchise handbook chapter hygiene",
            ],
            quotes=40,
            extra={"rates": {"Coffee": 7}},
        ),
        Case(
            key="law_firm",
            company="Ashcombe & Ravell LLP",
            country="GB",
            industry="Legal services",
            summary="Commercial law firm with six partners advising owner-managed businesses, Manchester.",
            customers=[
                ("Northmarsh Foods Ltd", "GB"), ("Kellbeck Engineering Ltd", "GB"), ("Fellgate Software Ltd", "GB"),
                ("Harlow & Lytton Retail plc", "GB"), ("Tidemoor Freight Services Ltd", "GB"), ("St Elbrin's Medical Group", "GB"),
                ("Stonebridge Vale Property Holdings Ltd", "GB"), ("Oakmorrow Academy Trust", "GB"),
                ("Kesselring Automotive GmbH", "DE"), ("Lindgrove Media AB", "SE"), ("Mr and Mrs Patel", "GB"),
            ],
            suppliers=[
                ("Quillstone Counsel Chambers", "GB", "services"), ("Lexmoor Research Ltd", "GB", "software"),
                ("Loomhall Office Estates Ltd", "GB", "rent"),
            ],
            expenses=[
                ("Office rent", "rent", 9500), ("Salaries", "wages", 68000), ("Counsel and expert fees", "services", 4200),
                ("Legal research and case management", "software", 1800), ("Professional indemnity insurance", "other", 2100),
                ("Directories and client events", "marketing", 1200),
            ],
            deals=[
                "Acquisition of Harlow & Lytton store portfolio", "Employment handbook refresh Fellgate Software",
                "Trade mark portfolio Northmarsh Foods", "Commercial lease renewals Stonebridge Vale",
                "Academy trust governance retainer", "UK distribution agreements Kesselring Automotive",
                "Shareholder dispute Tidemoor Freight",
            ],
            tasks=[
                "Conflict check for the Stonebridge Vale acquisition", "File defence in Northmarsh v Carter",
                "Renew professional indemnity cover", "Send engagement letter to Lindgrove Media",
                "Month-end WIP review with partners",
            ],
            quotes=34,
            lines_per_doc=(1, 3),
            extra={"rates": {"Disbursements": 0}},
        ),
        Case(
            key="tax_advisory",
            company="Ellerbrink & Partner Steuerberatung mbB",
            country="DE",
            industry="Tax advisory",
            summary="Tax advisory and accounting firm for owner-managed businesses and professionals, Nuremberg.",
            customers=[
                ("Bäckerei Schmiedl GmbH", "DE"), ("Zahnarztpraxis Dr. Ottmers", "DE"), ("Autowerkstatt Langhammer e.K.", "DE"),
                ("Grafikbüro Weißdorn", "DE"), ("Pension Schilfblick GbR", "DE"), ("IT-Systemhaus Bitquelle GmbH", "DE"),
                ("Weinhandel Bauerfeind KG", "DE"), ("Dr. Hanna Vogel", "DE"), ("Kanzlei Rothlauf Rechtsanwälte", "DE"),
                ("Fahrschule Meierling", "DE"), ("Physiotherapie am Weiherpark", "DE"), ("Kräuterwiese Online UG", "DE"),
            ],
            suppliers=[
                ("Lohnservice Zahlwerk GmbH", "DE", "services"), ("Kanzleidaten Genossenschaft eG", "DE", "software"),
                ("Bürohaus Torbogen GmbH", "DE", "rent"),
            ],
            expenses=[
                ("Office rent", "rent", 4800), ("Salaries", "wages", 52000), ("Outsourced payroll runs", "services", 1600),
                ("Tax software and data centre", "software", 2400), ("Liability insurance and chamber fees", "other", 900),
            ],
            deals=[
                "Bookkeeping mandate IT-Systemhaus Bitquelle", "Annual accounts package Weinhandel Bauerfeind",
                "Payroll takeover Bäckerei Schmiedl", "Start-up advice Kräuterwiese", "Tax audit support Autowerkstatt Langhammer",
                "Practice succession planning Dr. Ottmers", "Digital receipts onboarding Pension Schilfblick",
            ],
            tasks=[
                "Monthly VAT pre-returns by the 10th", "Collect receipts from Pension Schilfblick",
                "Prepare annual accounts Weinhandel Bauerfeind", "Reply to tax office query Autowerkstatt Langhammer",
                "Plan filing deadlines for annual returns",
            ],
            payment_days=14,
            quotes=36,
        ),
        Case(
            key="creative_studio",
            company="Studio Zwaanveld B.V.",
            country="NL",
            industry="Creative studio",
            summary="Branding, campaign and content studio with twelve designers and makers, Rotterdam.",
            customers=[
                ("Kademolen Brouwerij B.V.", "NL"), ("Spaakwind Fietsen B.V.", "NL"), ("Cultuurfonds Waterpoort", "NL"),
                ("Kaasmakerij De Vreeling", "NL"), ("Blauwtegel Living B.V.", "NL"), ("Brandauer Mode GmbH", "DE"),
                ("Stichting Scheepshuis", "NL"), ("Windvlinder Energie Coöperatie U.A.", "NL"), ("Lucerna Optics N.V.", "BE"),
                ("Hotel Kadezicht", "NL"), ("Zorggroep Lindehof", "NL"),
            ],
            suppliers=[
                ("Fotostudio Lichtkamer", "NL", "services"), ("Beeldbron Licenties B.V.", "NL", "software"),
                ("Creative Hub Werfkwartier", "NL", "rent"),
            ],
            expenses=[
                ("Studio rent", "rent", 3800), ("Salaries", "wages", 36000),
                ("Freelance photographers and illustrators", "services", 3500),
                ("Design software and stock licences", "software", 1100), ("Portfolio and awards", "marketing", 600),
            ],
            deals=[
                "Rebrand Kademolen Brouwerij", "Spring campaign Spaakwind Fietsen", "Exhibition identity Scheepshuis",
                "Packaging range Kaasmakerij De Vreeling", "Content retainer Windvlinder Energie", "Product film Lucerna Optics",
                "Employer brand Zorggroep Lindehof",
            ],
            tasks=[
                "Present key visual to Spaakwind Fietsen", "Book photographer for Blauwtegel shoot",
                "Renew image usage rights Hotel Kadezicht", "Archive final files Kademolen Brouwerij",
                "Plan content calendar for Windvlinder Energie",
            ],
            quotes=34,
            lines_per_doc=(1, 3),
        ),
        Case(
            key="real_estate",
            company="Wendlach Immobilien GmbH",
            country="AT",
            industry="Real estate",
            summary="Estate agency and property management for 640 residential and commercial units, Graz.",
            customers=[
                ("Eigentümergemeinschaft Ahornweg 24", "AT"), ("Flusswohnen Vermietungs GmbH", "AT"),
                ("Familie Pichler", "AT"), ("Dr. Karin Strobl", "AT"), ("Gewerbeflächen Hochwald AG", "AT"),
                ("Eigentümergemeinschaft Erlengasse 8", "AT"), ("Hotel Burgblick Rosental Betriebs GmbH", "AT"),
                ("Müllner Investments GmbH", "DE"), ("Ing. Thomas Wallner", "AT"), ("Praxisgemeinschaft Lindenau-Süd", "AT"),
                ("Eigentümergemeinschaft Mühlplatz 3", "AT"),
            ],
            suppliers=[
                ("Hausbetreuung Grünmark GmbH", "AT", "services"), ("Wohnfinder Media GmbH", "AT", "marketing"),
                ("Büro am Brunnenplatz GmbH", "AT", "rent"), ("Verwaltwerk Software GmbH", "AT", "software"),
            ],
            expenses=[
                ("Office rent", "rent", 3100), ("Salaries", "wages", 31000), ("Caretaking and cleaning", "services", 2900),
                ("Listing portals and photography", "marketing", 2200), ("Property management software", "software", 650),
            ],
            deals=[
                "Sale of penthouse Ahornweg", "Management mandate Mühlplatz 3", "Letting of retail unit Herrengasse",
                "Valuation portfolio Müllner Investments", "Office lettings Gewerbeflächen Hochwald",
                "Owners' meeting Erlengasse", "Sale of family home Pichler",
            ],
            tasks=[
                "Send service charge statements 2026", "Schedule owners' meeting Ahornweg",
                "Lift inspection follow-up Erlengasse", "Publish listing for penthouse Ahornweg",
                "Collect quotes for roof repair Mühlplatz",
            ],
            payment_days=14,
            quotes=34,
            lines_per_doc=(1, 3),
        ),
        Case(
            key="medical_practice",
            company="Zahnarztpraxis Dr. Ostwald & Kollegen",
            country="DE",
            industry="Dental practice",
            summary="Private dental practice with three dentists, prophylaxis team and in-house lab, Freiburg.",
            customers=[
                ("Martin Keller", "DE"), ("Sabine Wolf", "DE"), ("Familie Huber", "DE"), ("Elena Rossi", "DE"),
                ("Thomas Brandt", "DE"), ("Katharina Schulz", "DE"), ("Jonas Becker", "DE"), ("Ursula Hartmann", "DE"),
                ("Dr. Peter Fuchs", "DE"), ("Miriam Yilmaz", "DE"), ("Georg Albrecht", "DE"), ("Lea Zimmermann", "DE"),
            ],
            suppliers=[
                ("Dentaldepot Weißtanne GmbH", "DE", "goods"), ("Dentallabor Feinzahn GmbH", "DE", "services"),
                ("Ärztehaus Lindenbrunnen GmbH", "DE", "rent"), ("Praxiswerk Software GmbH", "DE", "software"),
            ],
            expenses=[
                ("Practice rent", "rent", 3800), ("Salaries", "wages", 30000), ("External dental lab", "services", 4500),
                ("Consumables and hygiene materials", "goods", 2600), ("Practice software and IT support", "software", 650),
                ("Recall reminders and website", "marketing", 300),
            ],
            deals=[
                "Implant treatment plan Keller", "Full-mouth rehabilitation Hartmann", "Aligner treatment Becker",
                "Prophylaxis programme for Energiewerke staff", "Referral partnership oral surgery practice",
                "Whitening campaign spring", "Second opinion patients via website",
            ],
            tasks=[
                "Autoclave validation and sterilisation log review", "Recall reminders for overdue check-ups",
                "Order composite and impression material", "Annual radiation protection briefing for staff",
                "Update the hygiene plan",
            ],
            quotes=60,
            b2c=True,
            extra={
                "rates": {
                    "Conservative dentistry": 0, "Prophylaxis": 0, "Prosthetics": 0, "Implantology": 0,
                    "Orthodontics": 0, "In-house lab": 7,
                },
                "input_vat": False,
            },
        ),
        Case(
            key="therapy_wellness",
            company="Silbertann Physio & Wellness GmbH",
            country="DE",
            industry="Physiotherapy",
            summary="Physiotherapy and osteopathy practice with wellness massages and courses, Münster.",
            customers=[
                ("Heidbrink Logistik GmbH", "DE"), ("Tennisclub Grün-Gold Heidbrink e.V.", "DE"), ("Anna Krüger", "DE"),
                ("Michael Hoffmann", "DE"), ("Petra Neumann", "DE"), ("Lukas Wagner", "DE"), ("Sophie Schäfer", "DE"),
                ("Gerd Richter", "DE"), ("Laura König", "DE"), ("Orthopädie am Weidensee", "DE"),
            ],
            suppliers=[
                ("Physio-Bedarf Bewegwerk GmbH", "DE", "goods"), ("Wäscherei Schneeweiß", "DE", "services"),
                ("Silbertann Gewerbehof KG", "DE", "rent"),
            ],
            expenses=[
                ("Practice rent", "rent", 3200), ("Salaries", "wages", 24000), ("Laundry service", "services", 450),
                ("Appointment and therapy software", "software", 220), ("Course flyers and website", "marketing", 350),
            ],
            deals=[
                "Corporate health programme Heidbrink Logistik", "Back school for Tennisclub Grün-Gold",
                "Pilates course series autumn", "Referral cooperation Orthopädie am Weidensee",
                "Osteopathy self-pay packages", "Prevention courses with health insurers",
            ],
            tasks=[
                "Check validity of open treatment series", "Service treatment couches and sling table",
                "Renew laundry contract", "Plan autumn course timetable", "Update cleaning and hygiene plan",
            ],
            b2c=True,
            quotes=40,
            lines_per_doc=(1, 3),
            extra={
                "rates": {"Physiotherapy": 0, "Manual therapy": 0, "Lymph drainage": 0, "Osteopathy": 0},
                "input_vat": False,
                "walk_in": "Self-pay patients (card terminal)",
                "walk_in_note": "Card terminal takings",
            },
        ),
        Case(
            key="beauty_salon",
            company="Lorvana Hair & Beauty e.U.",
            country="AT",
            industry="Beauty salon",
            summary="Hair and beauty salon with six stylists, nail bar and retail shelf, Vienna Neubau.",
            customers=[
                ("Hotel Kranzgasse Suites", "AT"), ("Weissl & Weissl Hochzeitsplanung OG", "AT"), ("Julia Gruber", "AT"),
                ("Magdalena Steiner", "AT"), ("Lisa Bauer", "AT"), ("Katrin Hofer", "AT"), ("Andrea Wimmer", "AT"),
                ("Stefanie Mayr", "AT"), ("Modehaus Leitgeb", "AT"), ("Theatergruppe Kulissenwerk", "AT"),
            ],
            suppliers=[
                ("Friseurbedarf Scherenwerk GmbH", "AT", "goods"), ("Kosmetik Großhandel Rosalie", "AT", "goods"),
                ("Textilpflege Flussweiß", "AT", "services"), ("Hausverwaltung Fliedergasse", "AT", "rent"),
            ],
            expenses=[
                ("Salon rent", "rent", 2600), ("Salaries", "wages", 17000), ("Towel and gown laundry", "services", 450),
                ("Online booking system", "software", 160), ("Social media ads", "marketing", 600),
            ],
            deals=[
                "Bridal packages Weissl & Weissl", "Hotel guest styling Kranzgasse Suites", "Fashion show styling Modehaus Leitgeb",
                "Theatre premiere make-up", "Voucher partnership with florist", "Nail bar expansion",
            ],
            tasks=[
                "Order colour stock for December", "Train new stylist on balayage", "Clean and disinfect tools log",
                "Plan Christmas voucher campaign", "Reorder retail shelf best-sellers",
            ],
            b2c=True,
            quotes=36,
            lines_per_doc=(1, 3),
            extra={"walk_in": "Salon guests (card and cash)", "walk_in_note": "Salon takings"},
        ),
        Case(
            key="restaurant_cafe",
            company="Café & Bistro Möwenkai GmbH",
            country="DE",
            industry="Restaurant",
            summary="Harbour-side café bistro with 90 seats, takeaway counter, catering and private events, Kiel.",
            customers=[
                ("Reederei Wellenreiter GmbH", "DE"), ("Agentur Leuchtfeuer Events GmbH", "DE"), ("Segelclub Windkante e.V.", "DE"),
                ("Kanzlei Petersmann & Lundt", "DE"), ("Buchtwerk Software GmbH", "DE"), ("Hochzeitsplanung Seeschwalbe", "DE"),
                ("Forschungsstation Seegras", "DE"), ("Seglarvik Yachting AB", "SE"), ("Hafenkontor Möwenkai GmbH", "DE"),
            ],
            suppliers=[
                ("Frischeküche Großmarkt Kombüse GmbH", "DE", "goods"), ("Getränke Gischt GmbH", "DE", "goods"),
                ("Rösterei Bohnenkai", "DE", "goods"), ("Gebäudereinigung Blankenhorn", "DE", "services"),
                ("Hafenimmobilien Möwenkai GmbH", "DE", "rent"),
            ],
            expenses=[
                ("Restaurant rent", "rent", 5200), ("Salaries", "wages", 32000), ("Cleaning service", "services", 900),
                ("Energy and gas", "other", 2100), ("POS and table reservations", "software", 260),
                ("Local marketing", "marketing", 500),
            ],
            deals=[
                "Summer party Buchtwerk Software", "Regatta catering Segelclub Windkante", "Wedding reception Seeschwalbe",
                "Weekly lunch delivery Hafenkontor", "Christmas dinners Reederei Wellenreiter", "Conference coffee breaks institute",
            ],
            tasks=[
                "Daily HACCP temperature log", "Order fish for the weekend menu", "Deep clean of the extraction hood",
                "Plan staff rota for regatta week", "Check allergen labelling on new menu",
            ],
            b2c=True,
            quotes=30,
            extra={
                "rates": {"Takeaway": 7, "Catering delivery": 7},
                "walk_in": "Restaurant guests (card and cash)",
                "walk_in_note": "Daily takings",
            },
        ),
        Case(
            key="small_hotel",
            company="Landhotel Tannweiher GmbH",
            country="DE",
            industry="Hotel",
            summary="Lakeside country hotel with 34 rooms, seminar rooms and a small spa, Ammersee.",
            customers=[
                ("Segelschule Tannweiher GmbH", "DE"), ("Reisebüro Gipfelglück GmbH", "DE"), ("Pharmaseminare Vendura GmbH", "DE"),
                ("Hochzeit Familie Gruber", "DE"), ("TSV Tannweiher Fußball e.V.", "DE"), ("Wanderreisen Gipfelpfad GmbH", "DE"),
                ("Software Campus Isarlicht GmbH", "DE"), ("Busreisen Hubmann KG", "DE"), ("Lysbro Travel ApS", "DK"),
            ],
            suppliers=[
                ("Gastro-Großhandel Seetal GmbH", "DE", "goods"), ("Brauerei Mönchsquell GmbH", "DE", "goods"),
                ("Großwäscherei Linnenweiß GmbH", "DE", "services"), ("Grundstücksgesellschaft Tannweiher KG", "DE", "rent"),
            ],
            expenses=[
                ("Hotel lease", "rent", 9500), ("Salaries", "wages", 34000), ("Linen and laundry", "services", 2400),
                ("Energy and heating", "other", 3100), ("Property management system and channel manager", "software", 690),
                ("Booking platform commissions", "marketing", 4800),
            ],
            deals=[
                "Spring seminar series Pharmaseminare Vendura", "Wedding Familie Gruber", "Group tours 2027 Busreisen Hubmann",
                "Team offsite Software Campus", "Hiking packages Gipfelpfad", "Scandinavian tour series Lysbro Travel",
            ],
            tasks=[
                "Monthly room inspection checklist", "Service the sauna and steam room", "Update winter rates on booking channels",
                "Confirm rooming list Busreisen Hubmann", "Order linen replacement for 12 rooms",
            ],
            b2c=True,
            quotes=30,
            extra={
                "rates": {"Accommodation": 7},
                "walk_in": "Individual guests (card and booking platforms)",
                "walk_in_note": "Room and restaurant revenue",
            },
        ),
        Case(
            key="fitness_studio",
            company="Studio Vélorine SAS",
            country="FR",
            industry="Fitness studio",
            summary="Boutique fitness and yoga studio with 900 members and corporate programmes, Lyon.",
            customers=[
                ("Lucenne Logiciels SAS", "FR"), ("Cabinet Morvan & Associés", "FR"), ("Groupe Hôtelier Clairval", "FR"),
                ("Association Sportive Belcolline", "FR"), ("Novaterre Tech Campus", "FR"), ("Pharmacie des Tilleuls", "FR"),
                ("Clinique du Parc Ombrelle", "FR"), ("Atelier Soierie Martinel", "FR"),
            ],
            suppliers=[
                ("Sport Équipement Pro SARL", "FR", "goods"), ("Nutrivia Active SAS", "FR", "goods"),
                ("Nettoyage Clairflot Services", "FR", "services"), ("SCI Les Quais Dorés", "FR", "rent"),
            ],
            expenses=[
                ("Studio rent", "rent", 7200), ("Salaries", "wages", 21000), ("Cleaning service", "services", 1300),
                ("Equipment leasing", "other", 1400), ("Booking and membership app", "software", 380),
                ("Membership campaigns", "marketing", 1500),
            ],
            deals=[
                "Corporate membership Lucenne Logiciels", "Desk yoga workshops Cabinet Morvan", "Hotel guest passes Clairval",
                "Back health programme Clinique du Parc", "Summer outdoor classes", "Student offer Novaterre Tech Campus",
            ],
            tasks=[
                "Monthly equipment safety check", "Publish class schedule for January", "Renew instructor certifications",
                "Follow up cancelled memberships", "Reorder protein shakes and towels",
            ],
            b2c=True,
            quotes=30,
            extra={"walk_in": "Members (direct debit and card)", "walk_in_note": "Membership and class takings"},
        ),
        Case(
            key="education_training",
            company="Akademie Lernwerft GmbH",
            country="DE",
            industry="Education and training",
            summary="Language school and professional training provider with certified funded courses, Mainz.",
            customers=[
                ("Arbeitsförderung Kreis Rebenhang", "DE"), ("Rebhügel Logistik GmbH", "DE"), ("Energiewerke Auenlicht GmbH", "DE"),
                ("Gesundheitszentrum Rebenhang", "DE"), ("Weingut Schäferling KG", "DE"), ("Netzwerk Integration Brückenschlag e.V.", "DE"),
                ("Software Atelier Quellstadt GmbH", "DE"), ("Volkshochschule Rebenhang", "DE"), ("Ana Popescu", "DE"),
                ("Mehmet Yilmaz", "DE"), ("Olena Kovalenko", "DE"),
            ],
            suppliers=[
                ("Linguara Verlagsauslieferung GmbH", "DE", "goods"), ("Trainerpool Lernfeld GmbH", "DE", "services"),
                ("Büropark Hafenkran GmbH", "DE", "rent"), ("Lernwolke Plattform GmbH", "DE", "software"),
            ],
            expenses=[
                ("Classroom rent", "rent", 4600), ("Salaries", "wages", 24000), ("Freelance trainers", "services", 9500),
                ("Learning platform", "software", 600), ("Course marketing", "marketing", 1400),
            ],
            deals=[
                "Funded retraining places 2027", "Business English for Rebhügel Logistik", "Nursing German B2 Gesundheitszentrum",
                "Leadership programme Energiewerke Auenlicht", "Excel seminars Software Atelier", "Integration course cooperation",
            ],
            tasks=[
                "Renew course certification with the state authority", "Plan January intensive courses",
                "Send attendance lists to Arbeitsförderung", "Order course books B1", "Collect trainer invoices for October",
            ],
            quotes=38,
            lines_per_doc=(1, 3),
            extra={
                "rates": {"Language courses": 0, "Vocational courses": 0, "Exams": 0, "Learning materials": 7},
                "input_vat": False,
            },
        ),
    )
}


# Items catalogue per case: (sku, name, uom, category, price, unit cost, goods?, max qty per line).
# Goods are stock-tracked: bought on supplier bills into inventory, cost of sales booked on invoicing.
_I = tuple[str, str, str, str, str, str, bool, int]
ITEMS: dict[str, list[_I]] = {
    "trade_distribution": [
        ("KM-1001", "Stretch film 500 mm x 300 m, pallet of 36 rolls", "pallet", "Packaging", "389.00", "252.96", True, 40),
        ("KM-1002", "Corrugated boxes 400x300x300, bundle of 250", "bundle", "Packaging", "142.50", "92.81", True, 200),
        ("KM-1003", "Packing tape 50 mm brown, carton of 36", "carton", "Packaging", "54.00", "34.32", True, 150),
        ("KM-1004", "Edge protectors 35x35x1200, pack of 100", "pack", "Packaging", "46.00", "28.37", True, 120),
        ("KM-2010", "Nitrile gloves L, carton of 1,000", "carton", "Safety and PPE", "64.90", "42.97", True, 300),
        ("KM-2020", "Safety goggles EN 166, box of 10", "box", "Safety and PPE", "58.00", "36.27", True, 100),
        ("KM-2030", "High-visibility vest EN ISO 20471, pack of 10", "pack", "Safety and PPE", "49.00", "29.76", True, 100),
        ("KM-2050", "Hex bolts M10x40 A2, box of 500", "box", "Fasteners", "48.20", "30.78", True, 250),
        ("KM-2060", "Washers M10 A2, box of 1,000", "box", "Fasteners", "21.40", "13.21", True, 250),
        ("KM-2070", "Wood screws 5x60 Torx, box of 500", "box", "Fasteners", "26.80", "17.11", True, 250),
        ("KM-3100", "Industrial cleaner 25 l canister", "canister", "Cleaning", "79.00", "50.22", True, 120),
        ("KM-3110", "Paper wipes 2-ply, pack of 6 rolls", "pack", "Cleaning", "34.50", "21.48", True, 200),
        ("KM-3200", "Safety labels roll, 1,000 pcs", "roll", "Labels", "36.50", "22.04", True, 200),
        ("KM-3210", "Thermal shipping labels 100x150, roll of 500", "roll", "Labels", "18.90", "11.25", True, 300),
        ("KM-4005", "Pallet jack 2,500 kg", "pcs", "Equipment", "429.00", "295.74", True, 6),
        ("KM-4010", "Hand truck 250 kg, pneumatic tyres", "pcs", "Equipment", "149.00", "96.72", True, 12),
        ("KM-5000", "Freight and handling, flat", "flat", "Services", "95.00", "0.00", False, 1),
    ],
    "professional_services": [
        ("SV-PARTNER", "Partner day rate", "day", "Consulting days", "1850.00", "620.00", False, 10),
        ("SV-SENIOR", "Senior consultant day rate", "day", "Consulting days", "1250.00", "450.00", False, 20),
        ("SV-CONSULT", "Consultant day rate", "day", "Consulting days", "890.00", "330.00", False, 30),
        ("SV-ANALYST", "Analyst day rate", "day", "Consulting days", "650.00", "240.00", False, 30),
        ("SV-WORKSHOP", "Strategy workshop, half day incl. preparation", "session", "Workshops", "3200.00", "1100.00", False, 3),
        ("SV-TRAIN", "Finance training for managers, per participant", "participant", "Workshops", "690.00", "180.00", False, 20),
        ("SV-DD", "Financial due diligence package", "flat", "Fixed-fee projects", "14500.00", "5200.00", False, 1),
        ("SV-BENCH", "Finance function benchmark report", "flat", "Fixed-fee projects", "7800.00", "2600.00", False, 1),
        ("SV-RET", "Monthly advisory retainer", "month", "Retainers", "4500.00", "1500.00", False, 1),
        ("SV-INTERIM", "Interim CFO, per week", "week", "Retainers", "6400.00", "2400.00", False, 4),
        ("SV-EXP", "Travel expenses, flat", "flat", "Expenses", "350.00", "350.00", False, 1),
    ],
    "manufacturing": [
        ("HW-T180", "Oak dining table 180x90", "pcs", "Tables", "1290.00", "470.00", True, 40),
        ("HW-T220", "Oak dining table 220x100, extendable", "pcs", "Tables", "1890.00", "690.00", True, 20),
        ("HW-C01", "Oak dining chair, upholstered", "pcs", "Seating", "245.00", "92.00", True, 200),
        ("HW-C02", "Bar stool, ash", "pcs", "Seating", "185.00", "64.00", True, 120),
        ("HW-S03", "Three-seat sofa frame, ash", "pcs", "Seating", "980.00", "360.00", True, 30),
        ("HW-B140", "Walnut bed frame 140x200", "pcs", "Bedroom", "1590.00", "610.00", True, 60),
        ("HW-N01", "Walnut bedside table", "pcs", "Bedroom", "340.00", "120.00", True, 120),
        ("HW-D120", "Office desk 120x70, oak veneer", "pcs", "Office", "640.00", "230.00", True, 120),
        ("HW-SH4", "Bookshelf 4 shelves, beech", "pcs", "Storage", "385.00", "135.00", True, 80),
        ("HW-SB160", "Sideboard 160 cm, oak", "pcs", "Storage", "1150.00", "420.00", True, 30),
        ("HW-CUST", "Custom joinery, per hour", "hour", "Services", "68.00", "0", False, 120),
        ("HW-DEL", "Delivery and assembly", "flat", "Services", "180.00", "0", False, 1),
    ],
    "retail_ecommerce": [
        ("LF-BOT", "Glass water bottle 750 ml", "pcs", "Drinkware", "24.90", "10.20", True, 60),
        ("LF-MUG", "Stoneware mug, hand-glazed", "pcs", "Drinkware", "21.00", "8.60", True, 60),
        ("LF-CUP", "Reusable coffee cup 350 ml", "pcs", "Drinkware", "16.90", "6.80", True, 60),
        ("LF-WRAP", "Beeswax food wraps, set of 3", "set", "Kitchen", "18.50", "7.40", True, 80),
        ("LF-BRUSH", "Bamboo dish brush set", "set", "Kitchen", "12.90", "4.90", True, 80),
        ("LF-BOARD", "Bamboo cutting board", "pcs", "Kitchen", "29.90", "12.50", True, 40),
        ("LF-JAR", "Storage jar set, 4 pcs", "set", "Storage", "39.90", "17.20", True, 40),
        ("LF-BAG", "Organic cotton produce bags, set of 5", "set", "Storage", "14.90", "5.60", True, 80),
        ("LF-LINEN", "Linen tea towels, set of 2", "set", "Textiles", "26.00", "11.30", True, 40),
        ("LF-APRON", "Linen apron", "pcs", "Textiles", "34.00", "14.80", True, 30),
        ("LF-GIFT", "Gift box zero-waste kitchen", "pcs", "Gift sets", "59.00", "27.00", True, 20),
        ("LF-SHIP", "Shipping", "flat", "Services", "5.90", "0", False, 1),
    ],
    "field_service": [
        ("CP-MAINT-S", "Annual maintenance split AC unit", "unit", "Maintenance", "189.00", "0", False, 40),
        ("CP-MAINT-C", "Annual maintenance central ventilation unit", "unit", "Maintenance", "640.00", "0", False, 10),
        ("CP-CONTRACT", "Service contract, quarterly fee per site", "site", "Maintenance", "780.00", "0", False, 6),
        ("CP-LAB", "Technician labour, per hour", "hour", "Labour", "92.00", "0", False, 80),
        ("CP-CALL", "Emergency call-out fee", "flat", "Labour", "145.00", "0", False, 1),
        ("CP-FILT", "Filter set F7 replacement", "set", "Spare parts", "68.00", "31.00", True, 60),
        ("CP-REFR", "Refrigerant R32 refill, per kg", "kg", "Spare parts", "54.00", "24.00", True, 30),
        ("CP-VALVE", "Expansion valve, universal", "pcs", "Spare parts", "165.00", "82.00", True, 10),
        ("CP-FAN", "Condenser fan motor", "pcs", "Spare parts", "285.00", "148.00", True, 6),
        ("CP-INST", "Installation split AC 3.5 kW incl. unit", "pcs", "Installations", "2490.00", "1290.00", True, 10),
        ("CP-HP", "Air-to-water heat pump 8 kW incl. installation", "pcs", "Installations", "11900.00", "7400.00", True, 2),
    ],
    "logistics": [
        ("BB-FTL-PL-SE", "Full truckload Gdańsk to Stockholm", "trip", "Road freight", "2150.00", "1640.00", False, 10),
        ("BB-FTL-PL-DE", "Full truckload Gdańsk to Hamburg", "trip", "Road freight", "1380.00", "1040.00", False, 12),
        ("BB-FTL-PL-NO", "Full truckload Gdańsk to Oslo", "trip", "Road freight", "2480.00", "1890.00", False, 8),
        ("BB-LTL", "Groupage per pallet place", "pallet", "Road freight", "96.00", "68.00", False, 66),
        ("BB-REEF", "Reefer surcharge per trip", "trip", "Road freight", "340.00", "250.00", False, 6),
        ("BB-FCL20", "Sea freight 20ft container Gdańsk to Gothenburg", "container", "Sea freight", "1650.00", "1210.00", False, 6),
        ("BB-FCL40", "Sea freight 40ft container Gdańsk to Aarhus", "container", "Sea freight", "2350.00", "1760.00", False, 4),
        ("BB-CUST", "Customs clearance per declaration", "declaration", "Customs", "85.00", "20.00", False, 12),
        ("BB-STOR", "Warehouse storage per pallet-week", "pallet-week", "Warehousing", "4.80", "2.10", False, 600),
        ("BB-HAND", "Warehouse handling in/out per pallet", "pallet", "Warehousing", "9.50", "4.00", False, 300),
        ("BB-INS", "Cargo insurance", "flat", "Insurance", "120.00", "70.00", False, 1),
    ],
    "it_agency": [
        ("PF-DISC", "Discovery and UX workshop", "flat", "Strategy and UX", "2400.00", "900.00", False, 1),
        ("PF-UX", "UX research, per day", "day", "Strategy and UX", "720.00", "280.00", False, 10),
        ("PF-DES", "UI design, per day", "day", "Design", "650.00", "250.00", False, 12),
        ("PF-BRAND", "Brand identity package", "flat", "Design", "6500.00", "2400.00", False, 1),
        ("PF-DEV", "Development sprint (2 weeks)", "sprint", "Development", "9800.00", "3900.00", False, 3),
        ("PF-APP", "Mobile app sprint (2 weeks)", "sprint", "Development", "11800.00", "4700.00", False, 2),
        ("PF-QA", "QA and accessibility testing, per day", "day", "Development", "560.00", "220.00", False, 10),
        ("PF-HRS", "Change requests, per hour", "hour", "Development", "95.00", "38.00", False, 60),
        ("PF-SEO", "SEO and content retainer, monthly", "month", "Marketing", "1800.00", "700.00", False, 1),
        ("PF-ADS", "Paid social campaign management", "month", "Marketing", "1450.00", "560.00", False, 1),
        ("PF-HOST", "Managed hosting and support, monthly", "month", "Hosting", "390.00", "120.00", False, 1),
    ],
    "nonprofit": [
        ("GC-WS", "School workshop: climate and nature (half day)", "session", "Education", "320.00", "0", False, 12),
        ("GC-EXC", "Guided nature excursion, per group", "group", "Education", "180.00", "0", False, 15),
        ("GC-TRAIN", "Train-the-trainer seminar, per participant", "participant", "Education", "145.00", "0", False, 30),
        ("GC-COURSE", "Weekend course nature photography, per participant", "participant", "Education", "95.00", "0", False, 20),
        ("GC-EVENT", "Event organisation package", "flat", "Events", "1850.00", "0", False, 1),
        ("GC-STAND", "Exhibition stand at environmental fair", "flat", "Events", "650.00", "0", False, 1),
        ("GC-SPON", "Corporate sponsorship package", "flat", "Partnerships", "2500.00", "0", False, 1),
        ("GC-VOL", "Corporate volunteering day, per group", "group", "Partnerships", "1200.00", "0", False, 2),
        ("GC-MEM", "Institutional membership, annual", "year", "Membership", "480.00", "0", False, 1),
        ("GC-BOOK", "Field guide Urban Wildlife, copy", "copy", "Publications", "14.90", "6.20", True, 200),
        ("GC-SEED", "Wildflower seed kit for schools", "kit", "Publications", "9.50", "3.80", True, 300),
    ],
    "craft_trades": [
        ("HE-MEIST", "Master electrician, per hour", "hour", "Labour", "78.00", "0", False, 40),
        ("HE-GES", "Electrician, per hour", "hour", "Labour", "64.00", "0", False, 120),
        ("HE-AZUB", "Apprentice, per hour", "hour", "Labour", "32.00", "0", False, 60),
        ("HE-ANF", "Call-out and travel, flat", "flat", "Labour", "45.00", "0", False, 1),
        ("HE-DGUV", "Portable appliance test DGUV V3, per device", "device", "Testing", "6.50", "0", False, 400),
        ("HE-ANL", "Periodic installation test, per circuit", "circuit", "Testing", "18.00", "0", False, 60),
        ("HE-NYM", "Installation cable NYM-J 3x1.5, per metre", "m", "Materials", "1.35", "0.62", True, 800),
        ("HE-SCHUKO", "Flush-mounted socket outlet incl. frame", "pcs", "Materials", "14.80", "6.40", True, 80),
        ("HE-LED", "LED panel 62x62, 36 W", "pcs", "Materials", "79.00", "38.00", True, 60),
        ("HE-FI", "Residual current device 40 A 30 mA, 4-pole", "pcs", "Materials", "96.00", "44.00", True, 20),
        ("HE-VERT", "Distribution board, 3 rows, fitted", "pcs", "Materials", "690.00", "340.00", True, 4),
        ("HE-WALLB", "Wallbox 11 kW incl. installation", "pcs", "E-mobility", "1890.00", "980.00", True, 6),
        ("HE-PV", "PV system maintenance visit", "visit", "Maintenance", "240.00", "0", False, 10),
    ],
    "food_production": [
        ("BW-BERG6", "Mountain cheese, 6 months, per kg", "kg", "Hard cheese", "16.90", "6.40", True, 300),
        ("BW-BERG12", "Mountain cheese, 12 months, per kg", "kg", "Hard cheese", "22.50", "8.60", True, 150),
        ("BW-EMM", "Allgäu Emmentaler, per kg", "kg", "Hard cheese", "13.80", "5.20", True, 300),
        ("BW-WEICH", "Soft cheese wheel 200 g", "pcs", "Soft cheese", "4.20", "1.50", True, 400),
        ("BW-BUTT", "Farmhouse butter 250 g", "pcs", "Dairy", "3.10", "1.20", True, 500),
        ("BW-JOG", "Natural yoghurt 500 g", "pcs", "Dairy", "2.40", "0.85", True, 500),
        ("BW-QUARK", "Quark 500 g", "pcs", "Dairy", "2.20", "0.80", True, 400),
        ("BW-GIFT", "Cheese gift box, four varieties", "box", "Gift boxes", "34.00", "12.50", True, 60),
        ("BW-PLAT", "Cheese platter for 20 guests", "platter", "Platters", "145.00", "52.00", True, 6),
        ("BW-TOUR", "Dairy tour and tasting, per group", "group", "Experiences", "180.00", "0", False, 4),
        ("BW-DEL", "Refrigerated delivery, per drop", "drop", "Logistics", "24.00", "0", False, 1),
    ],
    "franchise_multisite": [
        ("BO-ROY", "Franchise royalty, 6 % of monthly net sales", "month", "Franchise fees", "2850.00", "0", False, 1),
        ("BO-MKT", "Brand marketing fund, monthly", "month", "Franchise fees", "690.00", "0", False, 1),
        ("BO-ENTRY", "Initial franchise fee, new location", "flat", "Franchise fees", "24500.00", "0", False, 1),
        ("BO-ESP", "Espresso blend Classico, carton of 6 kg", "carton", "Coffee", "96.00", "48.00", True, 60),
        ("BO-FILT", "Single-origin filter roast, carton of 6 kg", "carton", "Coffee", "118.00", "58.00", True, 30),
        ("BO-DECAF", "Decaf blend, carton of 3 kg", "carton", "Coffee", "54.00", "27.00", True, 20),
        ("BO-CUPS", "Branded paper cups 300 ml, carton of 1,000", "carton", "Supplies", "86.00", "51.00", True, 40),
        ("BO-OAT", "Barista oat drink, case of 12", "case", "Supplies", "26.40", "17.20", True, 60),
        ("BO-TRAIN", "Barista training, per participant", "participant", "Training", "290.00", "0", False, 8),
        ("BO-AUDIT", "Quality and brand audit visit", "visit", "Field support", "380.00", "0", False, 1),
        ("BO-OPEN", "Opening package: store design and launch support", "flat", "Openings", "18500.00", "0", False, 1),
    ],
    "law_firm": [
        ("AP-PART", "Partner, per hour", "hour", "Fee earners", "395.00", "0", False, 40),
        ("AP-SA", "Senior associate, per hour", "hour", "Fee earners", "285.00", "0", False, 60),
        ("AP-ASSOC", "Associate, per hour", "hour", "Fee earners", "210.00", "0", False, 80),
        ("AP-TRAINEE", "Trainee solicitor, per hour", "hour", "Fee earners", "135.00", "0", False, 40),
        ("AP-PARA", "Paralegal, per hour", "hour", "Fee earners", "110.00", "0", False, 40),
        ("AP-SHA", "Shareholder agreement, fixed fee", "flat", "Fixed fees", "4800.00", "0", False, 1),
        ("AP-EMP", "Employment contract review, fixed fee", "flat", "Fixed fees", "950.00", "0", False, 1),
        ("AP-TM", "UK trade mark filing, fixed fee", "flat", "Fixed fees", "1250.00", "0", False, 1),
        ("AP-RET", "Legal retainer, monthly", "month", "Retainers", "2500.00", "0", False, 1),
        ("AP-COUNSEL", "Counsel's fees", "flat", "Counsel", "1800.00", "1800.00", False, 1),
        ("AP-COURT", "Court fee (disbursement)", "flat", "Disbursements", "455.00", "455.00", False, 1),
        ("AP-LR", "Land Registry fee (disbursement)", "flat", "Disbursements", "150.00", "150.00", False, 1),
    ],
    "tax_advisory": [
        ("KP-FIBU", "Monthly bookkeeping", "month", "Bookkeeping", "380.00", "0", False, 1),
        ("KP-LOHN", "Payroll, per employee and month", "employee", "Payroll", "28.00", "0", False, 40),
        ("KP-JA", "Annual financial statements", "flat", "Annual accounts", "3400.00", "0", False, 1),
        ("KP-EUR", "Cash-basis profit statement (EÜR)", "flat", "Annual accounts", "1450.00", "0", False, 1),
        ("KP-UST", "Annual VAT return", "flat", "Tax returns", "480.00", "0", False, 1),
        ("KP-GEW", "Trade tax return", "flat", "Tax returns", "420.00", "0", False, 1),
        ("KP-EST", "Personal income tax return", "flat", "Tax returns", "890.00", "0", False, 1),
        ("KP-BER", "Tax advice, per hour", "hour", "Advisory", "165.00", "0", False, 20),
        ("KP-BP", "Tax audit support, per hour", "hour", "Advisory", "185.00", "0", False, 30),
        ("KP-START", "Start-up package: incorporation and tax registration", "flat", "Advisory", "1900.00", "0", False, 1),
        ("KP-AUSL", "Postage and telecom, flat", "flat", "Expenses", "20.00", "0", False, 1),
    ],
    "creative_studio": [
        ("SN-BRAND", "Brand identity: logo, palette, typography", "flat", "Branding", "8900.00", "0", False, 1),
        ("SN-GUIDE", "Brand guidelines", "flat", "Branding", "3200.00", "0", False, 1),
        ("SN-CAMP", "Campaign concept and key visual", "flat", "Campaigns", "6500.00", "0", False, 1),
        ("SN-SOC", "Social media content package, monthly", "month", "Content", "2400.00", "0", False, 1),
        ("SN-PHOTO", "Product photography, per day", "day", "Photo and video", "1450.00", "0", False, 4),
        ("SN-FILM", "Brand film, 60 seconds", "flat", "Photo and video", "9800.00", "0", False, 1),
        ("SN-DES", "Designer, per hour", "hour", "Design hours", "95.00", "0", False, 60),
        ("SN-AD", "Art director, per hour", "hour", "Design hours", "125.00", "0", False, 30),
        ("SN-PACK", "Packaging design, per product", "product", "Design hours", "1650.00", "0", False, 6),
        ("SN-RIGHTS", "Image usage rights, two years national", "licence", "Usage rights", "1200.00", "0", False, 3),
        ("SN-RET", "Creative retainer, monthly", "month", "Retainers", "4200.00", "0", False, 1),
    ],
    "real_estate": [
        ("KI-SALE", "Sales commission, 3 % of purchase price", "flat", "Brokerage", "10800.00", "0", False, 1),
        ("KI-LET", "Letting commission, two months' rent", "flat", "Brokerage", "1900.00", "0", False, 1),
        ("KI-VAL", "Valuation report, residential", "flat", "Valuations", "890.00", "0", False, 1),
        ("KI-EPC", "Energy certificate arrangement", "flat", "Valuations", "280.00", "0", False, 1),
        ("KI-PM", "Property management fee, per unit and month", "unit", "Property management", "28.00", "0", False, 80),
        ("KI-PMC", "Commercial property management, monthly", "month", "Property management", "950.00", "0", False, 1),
        ("KI-MEET", "Owners' meeting incl. minutes", "meeting", "Property management", "420.00", "0", False, 1),
        ("KI-SC", "Annual service charge statement, per unit", "unit", "Service charges", "45.00", "0", False, 60),
        ("KI-REP", "Repair coordination, per hour", "hour", "Repairs", "68.00", "0", False, 20),
        ("KI-LIST", "Listing package: photos, floor plan, portals", "flat", "Marketing", "650.00", "0", False, 1),
    ],
    "medical_practice": [
        ("ZP-FILL", "Composite filling, multi-surface", "tooth", "Conservative dentistry", "185.00", "0", False, 4),
        ("ZP-ROOT", "Root canal treatment, per canal", "canal", "Conservative dentistry", "240.00", "0", False, 3),
        ("ZP-PZR", "Professional teeth cleaning", "session", "Prophylaxis", "110.00", "0", False, 2),
        ("ZP-PERIO", "Periodontal treatment, per quadrant", "quadrant", "Prophylaxis", "290.00", "0", False, 4),
        ("ZP-CROWN", "Full ceramic crown, dentist's fee", "tooth", "Prosthetics", "620.00", "0", False, 4),
        ("ZP-IMPL", "Single implant incl. surgery", "implant", "Implantology", "1850.00", "0", False, 2),
        ("ZP-ALIGN", "Aligner treatment, phase fee", "phase", "Orthodontics", "1450.00", "0", False, 1),
        ("ZP-LAB", "In-house lab: zirconia crown", "unit", "In-house lab", "390.00", "0", False, 4),
        ("ZP-WHITE", "In-office whitening (cosmetic)", "session", "Aesthetic", "390.00", "0", False, 1),
        ("ZP-REPORT", "Report for private health insurer", "report", "Reports", "120.00", "0", False, 1),
        ("ZP-BRUSH", "Sonic toothbrush", "pcs", "Oral care products", "89.00", "46.00", True, 2),
        ("ZP-INTER", "Interdental brushes, pack of 8", "pack", "Oral care products", "6.90", "2.90", True, 6),
    ],
    "therapy_wellness": [
        ("LH-KG", "Physiotherapy session, 25 min", "session", "Physiotherapy", "38.00", "0", False, 90),
        ("LH-KGG", "Medical training therapy, 60 min", "session", "Physiotherapy", "62.00", "0", False, 30),
        ("LH-MT", "Manual therapy, 30 min", "session", "Manual therapy", "48.00", "0", False, 40),
        ("LH-MLD", "Manual lymph drainage, 45 min", "session", "Lymph drainage", "52.00", "0", False, 25),
        ("LH-OST", "Osteopathic treatment, 50 min", "session", "Osteopathy", "110.00", "0", False, 20),
        ("LH-SER10", "Physiotherapy series of 10, self-pay", "series", "Physiotherapy", "350.00", "0", False, 4),
        ("LH-MASS", "Wellness massage, 60 min", "session", "Wellness", "69.00", "0", False, 25),
        ("LH-STONE", "Hot stone massage, 75 min", "session", "Wellness", "89.00", "0", False, 10),
        ("LH-PILATES", "Pilates course, 8 sessions", "course", "Courses", "129.00", "0", False, 12),
        ("LH-BGM", "Corporate back health workshop", "workshop", "Corporate health", "690.00", "0", False, 2),
        ("LH-TAPE", "Kinesiology tape, roll", "roll", "Products", "9.90", "4.10", True, 20),
        ("LH-ROLL", "Foam roller", "pcs", "Products", "34.90", "15.80", True, 8),
    ],
    "beauty_salon": [
        ("MB-CUT-L", "Ladies' cut and blow-dry", "service", "Hair", "68.00", "0", False, 45),
        ("MB-CUT-M", "Men's cut", "service", "Hair", "38.00", "0", False, 40),
        ("MB-COL", "Full colour incl. cut", "service", "Colour", "129.00", "0", False, 20),
        ("MB-BAL", "Balayage incl. toner and styling", "service", "Colour", "219.00", "0", False, 8),
        ("MB-BRIDE", "Bridal hair and make-up incl. trial", "package", "Bridal", "390.00", "0", False, 3),
        ("MB-FAC", "Facial treatment, 60 min", "service", "Beauty", "89.00", "0", False, 15),
        ("MB-LASH", "Lash lift and tint", "service", "Beauty", "65.00", "0", False, 12),
        ("MB-MANI", "Gel manicure", "service", "Nails", "49.00", "0", False, 30),
        ("MB-SHAMP", "Professional shampoo 250 ml", "pcs", "Retail products", "24.90", "11.20", True, 25),
        ("MB-OIL", "Hair oil 100 ml", "pcs", "Retail products", "32.00", "14.50", True, 12),
        ("MB-CARE", "Skin care set", "set", "Retail products", "59.00", "27.00", True, 6),
    ],
    "restaurant_cafe": [
        ("HL-BRUNCH", "Weekend brunch buffet, per person", "person", "Dine-in food", "29.00", "8.70", True, 180),
        ("HL-FISH", "Fish of the day with potatoes", "portion", "Dine-in food", "22.50", "7.20", True, 220),
        ("HL-BOWL", "Seasonal bowl", "portion", "Dine-in food", "15.90", "4.60", True, 260),
        ("HL-CAKE", "Homemade cake, slice", "slice", "Dine-in food", "4.60", "1.10", True, 500),
        ("HL-CAPP", "Cappuccino", "cup", "Drinks", "3.90", "0.55", True, 900),
        ("HL-WINE", "House wine 0.2 l", "glass", "Drinks", "6.50", "1.60", True, 400),
        ("HL-BEER", "Draught beer 0.4 l", "glass", "Drinks", "4.90", "1.10", True, 500),
        ("HL-SAND", "Sandwich to go", "pcs", "Takeaway", "6.90", "2.10", True, 400),
        ("HL-CAKE-TG", "Cake to go, slice", "slice", "Takeaway", "4.20", "1.10", True, 300),
        ("HL-CATER", "Finger food, per person, delivered", "person", "Catering delivery", "24.00", "8.40", True, 80),
        ("HL-EVENT", "Private event hire, evening", "evening", "Events", "650.00", "0", False, 1),
    ],
    "small_hotel": [
        ("SB-SGL", "Single room, per night", "night", "Accommodation", "89.00", "0", False, 60),
        ("SB-DBL", "Double room, per night", "night", "Accommodation", "139.00", "0", False, 120),
        ("SB-SUITE", "Lake-view suite, per night", "night", "Accommodation", "219.00", "0", False, 20),
        ("SB-BRKF", "Breakfast buffet, per person", "person", "Breakfast", "18.00", "5.20", True, 220),
        ("SB-HB", "Half board supplement, per person", "person", "Dining", "32.00", "10.50", True, 80),
        ("SB-BAR", "Bar and minibar", "flat", "Drinks", "26.00", "7.00", True, 60),
        ("SB-PARK", "Parking, per day", "day", "Extras", "12.00", "0", False, 60),
        ("SB-SPA", "Spa access, per person", "person", "Extras", "15.00", "0", False, 40),
        ("SB-BIKE", "E-bike rental, per day", "day", "Extras", "35.00", "0", False, 20),
        ("SB-DDR", "Day conference package, per person", "person", "Conferences", "59.00", "0", False, 40),
        ("SB-ROOM", "Seminar room, full day", "day", "Conferences", "390.00", "0", False, 2),
    ],
    "fitness_studio": [
        ("EQ-MEM", "Monthly membership, unlimited", "month", "Memberships", "59.00", "0", False, 120),
        ("EQ-YOGA", "Yoga membership, monthly", "month", "Memberships", "49.00", "0", False, 40),
        ("EQ-CORP", "Corporate membership, per employee and month", "employee", "Corporate", "39.00", "0", False, 60),
        ("EQ-10", "10-class pass", "pass", "Class passes", "130.00", "0", False, 15),
        ("EQ-DROP", "Drop-in class", "class", "Class passes", "16.00", "0", False, 60),
        ("EQ-PT", "Personal training, 60 min", "session", "Personal training", "75.00", "0", False, 20),
        ("EQ-PT10", "Personal training, pack of 10", "pack", "Personal training", "690.00", "0", False, 2),
        ("EQ-WORK", "Corporate workshop: back health at the desk", "workshop", "Corporate", "450.00", "0", False, 2),
        ("EQ-SHAKE", "Protein shake", "pcs", "Bar and shop", "4.50", "1.40", True, 150),
        ("EQ-MAT", "Yoga mat", "pcs", "Bar and shop", "39.00", "17.00", True, 10),
        ("EQ-TOWEL", "Towel rental", "pcs", "Bar and shop", "2.00", "0", False, 120),
    ],
    "education_training": [
        ("RB-DE-B1", "German course B1, 8 weeks intensive", "participant", "Language courses", "690.00", "0", False, 12),
        ("RB-DE-B2", "German for professionals B2, evenings", "participant", "Language courses", "540.00", "0", False, 12),
        ("RB-EN-BIZ", "Business English in-company, per lesson", "lesson", "Corporate training", "68.00", "0", False, 40),
        ("RB-EXAM", "Certificate exam B1/B2", "participant", "Exams", "185.00", "0", False, 12),
        ("RB-BOOK", "Course book B1 with workbook", "copy", "Learning materials", "34.90", "22.00", True, 20),
        ("RB-EXCEL", "Excel for controllers, 2-day seminar", "participant", "Vocational courses", "890.00", "0", False, 10),
        ("RB-PM", "Project management basics, 3 days", "participant", "Vocational courses", "1290.00", "0", False, 10),
        ("RB-LEAD", "Leadership training for team leads, in-house day", "day", "Corporate training", "1850.00", "0", False, 3),
        ("RB-FUND", "Funded retraining module, per participant and month", "participant", "Vocational courses", "1150.00", "0", False, 8),
        ("RB-ROOM", "Seminar room hire, per day", "day", "Room hire", "280.00", "0", False, 3),
        ("RB-ELEARN", "E-learning licence, per learner and year", "licence", "Corporate training", "120.00", "0", False, 50),
    ],
}

# Monthly net revenue target, bank loan drawn at the start, fixed net value per sales
# document (0: sized from the revenue target) and weekly web-shop settlement invoices (B2C).
PROFILE: dict[str, dict[str, Any]] = {
    "trade_distribution": {"revenue": 180000, "loan": 120000},
    "professional_services": {"revenue": 95000},
    "manufacturing": {"revenue": 125000, "loan": 150000},
    "retail_ecommerce": {"revenue": 38000, "doc_value": 90, "webshop": True},
    "field_service": {"revenue": 85000},
    "logistics": {"revenue": 128000},
    "it_agency": {"revenue": 92000},
    "nonprofit": {"revenue": 32000},
    "craft_trades": {"revenue": 78000},
    "food_production": {"revenue": 88000, "loan": 90000},
    "franchise_multisite": {"revenue": 95000},
    "law_firm": {"revenue": 140000},
    "tax_advisory": {"revenue": 98000},
    "creative_studio": {"revenue": 72000},
    "real_estate": {"revenue": 68000},
    "medical_practice": {"revenue": 60000, "loan": 80000},
    "therapy_wellness": {"revenue": 44000, "doc_value": 420, "webshop": True},
    "beauty_salon": {"revenue": 34000, "doc_value": 180, "webshop": True},
    "restaurant_cafe": {"revenue": 78000, "doc_value": 900, "webshop": True},
    "small_hotel": {"revenue": 82000, "doc_value": 2600, "webshop": True, "loan": 150000},
    "fitness_studio": {"revenue": 52000, "doc_value": 900, "webshop": True},
    "education_training": {"revenue": 70000},
}
WEBSHOP_CUSTOMER = "Web shop customers (card payments)"
COGS_SOURCE = "business_demo_cogs"
BILL_SOURCE = "business_demo_bill"
BILL_PAY_SOURCE = "business_demo_bill_payment"
LOAN_SOURCE = "business_demo_loan"
DEMO_SOURCES = (MARKER_SOURCE, EXPENSE_SOURCE, COGS_SOURCE, BILL_SOURCE, BILL_PAY_SOURCE, LOAN_SOURCE)
INVOICE_CONVERSION = D("0.68")  # calibrated: issued invoice value per quote vs. the quote target
SUPPLIER_TERMS = 30


_CASE_CURRENCY = {"GB": "GBP", "PL": "PLN"}


def list_cases() -> list[dict[str, Any]]:
    return [
        {"key": c.key, "company": c.company, "country": c.country, "industry": c.industry, "summary": c.summary}
        for c in CASES.values()
    ]


async def installed_cases(session: AsyncSession, tenant_id: str | None = None) -> list[str]:
    """Installed case keys for ``tenant_id`` (``None``: across all tenants)."""
    q = select(GLJournalEntry.source_id).where(GLJournalEntry.source_type == MARKER_SOURCE)
    if tenant_id is not None:
        q = q.where(GLJournalEntry.tenant_id == tenant_id)
    rows = await session.execute(q)
    return sorted({r for (r,) in rows if r})


async def _install_is_stale(session: AsyncSession, case: Case, tenant: str) -> bool:
    from app.modules.banking.models import BankAccount

    if read_business_settings().get("country_code") != case.country:
        return True
    if await _appointments_stale(session, case, tenant):
        return True
    from app.modules.items.models import Item

    if await session.scalar(select(Item.id).where(Item.tenant_id == tenant, Item.sku.like("NW-%")).limit(1)):
        return True
    # Missing bank account or opening balance means an older build seeded it.
    opening = await session.scalar(select(BankAccount.opening_balance_date).where(
        BankAccount.tenant_id == tenant, BankAccount.name == bank_account_name(case.company)))
    if opening is None:
        return True
    # A renamed demo company leaves its old account behind, double-counting the statement lines.
    orphan = await session.scalar(select(BankAccount.id).where(
        BankAccount.tenant_id == tenant, BankAccount.iban == demo_bank_iban(case),
        BankAccount.name != bank_account_name(case.company)))
    return orphan is not None


def _months_back(d: date, n: int) -> date:
    y, m = divmod(d.year * 12 + d.month - 1 - n, 12)
    return date(y, m + 1, 1)


async def _ensure_ledger(
    session: AsyncSession, country: str, start: date, end: date, tenant_id: str
) -> dict[str, str]:
    gl = GLService(session, tenant_id)
    mine = GLAccount.tenant_id == tenant_id
    tpl = await session.scalar(select(GLAccount.template).where(mine, GLAccount.template.is_not(None)).limit(1))
    if tpl is None:
        if await session.scalar(select(GLAccount.id).where(mine).limit(1)) is not None:
            raise BusinessDemoError("A custom chart of accounts is loaded; demo data needs de_skr03 or ifrs_generic")
        tpl = "de_skr03" if country == "DE" else "ifrs_generic"
        await gl.load_template(tpl)
    if tpl not in EXPENSE_ACCOUNTS:
        raise BusinessDemoError(f"Chart template {tpl!r} is not supported by the demo data")
    for year in range(start.year, end.year + 1):
        ys, ye = date(year, 1, 1), date(year, 12, 31)
        overlap = await session.scalar(
            select(GLFiscalYear.id).where(
                GLFiscalYear.tenant_id == tenant_id, GLFiscalYear.start_date <= ye, GLFiscalYear.end_date >= ys)
        )
        if overlap is None:
            await gl.create_fiscal_year(f"FY{year}", ys, ye)
    return EXPENSE_ACCOUNTS[tpl]


async def _ensure_stages(session: AsyncSession) -> dict[str, PipelineStage]:
    stages = {s.code: s for s in (await session.execute(select(PipelineStage))).scalars()}
    for code, name, order, prob, final, won, lost, color in _CRM_STAGES:
        if code not in stages:
            st = PipelineStage(
                code=code, name=name, display_order=order, default_probability_percent=prob,
                is_final=final, is_won=won, is_lost=lost, color=color,
            )
            session.add(st)
            stages[code] = st
    await session.flush()
    return stages


async def _gl_ids(session: AsyncSession, codes: dict[str, str], tenant_id: str) -> dict[str, uuid.UUID]:
    rows = await session.execute(
        select(GLAccount.code, GLAccount.id).where(
            GLAccount.tenant_id == tenant_id, GLAccount.code.in_(set(codes.values()))
        )
    )
    by_code = dict(rows.all())
    missing = [c for c in codes.values() if c not in by_code]
    if missing:
        raise BusinessDemoError(f"GL accounts missing for demo postings: {sorted(set(missing))}")
    return {role: by_code[code] for role, code in codes.items()}


async def _resolve_owner(session: AsyncSession, owner_id: uuid.UUID | None) -> uuid.UUID | None:
    from app.modules.users.models import User

    if owner_id is not None:
        return owner_id
    q = select(User.id).where(User.role == "admin").order_by(User.created_at).limit(1)
    return await session.scalar(q) or await session.scalar(select(User.id).order_by(User.created_at).limit(1))


async def install_business_demo(
    session: AsyncSession,
    case_key: str,
    *,
    owner_id: uuid.UUID | None = None,
    tenant_id: str | None = None,
    today: date | None = None,
) -> dict[str, Any]:
    """Seed one case into the session (caller commits). Re-running is a no-op."""
    case = CASES.get(case_key)
    if case is None:
        raise BusinessDemoError(f"Unknown business demo case {case_key!r}; available: {sorted(CASES)}")
    owner = await _resolve_owner(session, owner_id)
    tenant = tenant_id or DEFAULT_TENANT
    if case_key in await installed_cases(session, tenant):
        if not await _install_is_stale(session, case, tenant):
            return {"case": case_key, "already_installed": True}
        # Seeded by an older build (no bank account, or books in another country's currency): redo it.
        removed = await reset_business_demo(session, case_key, tenant_id=tenant)
        logger.info("Business demo %s was stale, reseeding (removed %s)", case_key, removed)

    today = today or date.today()
    rng = random.Random(zlib.crc32(case_key.encode()))
    settings = read_business_settings()
    if settings.get("country_code") != case.country:
        # The demo company is a real-world entity of its own country: its books run in that currency.
        from app.core.business_settings import write_business_settings
        cur = _CASE_CURRENCY.get(case.country, "EUR")
        write_business_settings({"country_code": case.country, "base_currency": cur})
        settings = {**settings, "country_code": case.country, "base_currency": cur}
    if not str(settings.get("company_name") or "").strip():
        from app.core.business_settings import write_business_settings
        write_business_settings({"company_name": case.company})
    country = settings.get("country_code") or case.country
    currency = str(settings.get("base_currency") or base_currency()).upper()
    vat = default_tax_rate(country)
    start = _months_back(today, 5)
    codes = await _ensure_ledger(session, country, start, today + timedelta(days=60), tenant)
    acc = await _gl_ids(session, codes, tenant)
    gl = GLService(session, tenant)
    sales = SalesService(session, tenant)
    created_by = str(owner) if owner else None

    profile = PROFILE.get(case_key, {})
    items_def = ITEMS[case_key]
    by_sku = {r[0]: r for r in items_def}
    n_items = await _seed_items(session, case, currency, vat, tenant, created_by, codes, country)
    meta = {"source_id": case_key, "created_by": created_by, "post": True, "currency": currency}

    # CRM accounts.
    tag = f"demo:{case_key}"
    customers: list[Account] = []
    for name, cc in case.customers:
        a = Account(name=name, country=cc, industry=None, role="customer", status="active",
                    size_category="sme", tags=[tag], description=f"Customer of {case.company}", owner_user_id=owner)
        session.add(a)
        customers.append(a)
    for name, cc, cat in case.suppliers:
        session.add(Account(name=name, country=cc, role="supplier", status="active", size_category="sme",
                            tags=[tag, cat], description=f"Supplier ({cat}) of {case.company}", owner_user_id=owner))
    webshop = None
    if profile.get("webshop"):
        webshop = Account(name=case.extra.get("walk_in", WEBSHOP_CUSTOMER), country=country, role="customer",
                          status="active", size_category="sme", tags=[tag],
                          description=f"Card and counter settlements of {case.company}",
                          owner_user_id=owner)
        session.add(webshop)
    await session.flush()

    def tax_for(cust_cc: str, category: str) -> Decimal:
        if not (case.b2c or cust_cc == country):
            return D(0)
        return _line_rate(case, category, vat, country)

    def pick_lines(cust_cc: str, target: Decimal, k: int | None = None) -> list[LineData]:
        k = min(k or rng.randint(*case.lines_per_doc), len(items_def))
        disc = D(rng.choice([0, 0, 0, 3, 5])) if not case.b2c else D(0)
        order = rng.sample(items_def, k=len(items_def))
        out, left = [], target
        # Lines capped at their usual maximum pass the rest on; extra items join until the value is reached.
        for n, (sku, name, _uom, cat, price, _cost, _goods, maxq) in enumerate(order):
            if n >= k and left < target * D("0.15"):
                break
            share = left / max(1, k - n) * D(rng.randint(70, 130)) / 100 if n < k else left
            qty = max(1, min(maxq, int(share / D(price) + D("0.5"))))
            brk = _price_break(by_sku[sku])
            unit = brk[1] if brk and qty >= brk[0] else D(price)
            out.append(LineData(name, sku, D(qty), unit, disc, tax_for(cust_cc, cat)))
            left -= qty * unit
        return out

    cogs_month: dict[date, Decimal] = {}

    async def book_cogs(inv, lines: list[LineData], day: date) -> None:
        cost = money(sum((ln.qty * D(by_sku[ln.sku][5]) for ln in lines if by_sku[ln.sku][6]), D(0)))
        if cost <= 0:
            return
        await gl.create_entry(
            entry_date=day, memo=f"Cost of sales {inv.number}", source_type=COGS_SOURCE,
            lines=[LineInput(acc["cogs"], debit=cost, description=f"Cost of goods sold {inv.number}"),
                   LineInput(acc["inventory"], credit=cost, description=f"Stock issue {inv.number}")], **meta)
        m = day.replace(day=1)
        cogs_month[m] = cogs_month.get(m, D(0)) + cost

    counts = {"quotes": 0, "orders": 0, "invoices": 0, "payments": 0}
    span = (today - start).days
    months = D(span) / D("30.4")
    doc_target = D(profile.get("doc_value") or 0) or (
        D(profile.get("revenue", 20000)) * months / (D(case.quotes) * INVOICE_CONVERSION))
    chased = False
    for i in range(case.quotes):
        qd = start + timedelta(days=int(span * i / case.quotes) + rng.randint(0, 4))
        qd = min(qd, today)
        cust_i = rng.randrange(len(customers))
        cust = customers[cust_i]
        cc = case.customers[cust_i][1]
        common = {"customer_id": cust.id, "customer_name": cust.name, "currency": currency}
        lines = pick_lines(cc, doc_target * D(rng.randint(50, 150)) / 100)
        q = await sales.create("quote", lines=lines, doc_date=qd, created_by=created_by,
                               due_date=qd + timedelta(days=30), **common)
        counts["quotes"] += 1
        age = (today - qd).days
        roll = rng.random()
        if age < 7 and roll < 0.5 and i != case.quotes - 2:
            continue  # stays draft
        await sales.set_status(q.id, "sent")
        if (age < 14 and roll < 0.7) or i == case.quotes - 2:
            continue
        if roll < 0.12:
            await sales.set_status(q.id, "rejected")
            continue
        if roll < 0.2:
            if age > 30:
                await sales.set_status(q.id, "expired")
            continue
        if roll < 0.24:
            await sales.set_status(q.id, "cancelled")
            continue
        od = qd + timedelta(days=rng.randint(1, 6))
        if od > today:
            continue
        so = await sales.quote_to_order(q.id, created_by=created_by)
        so.doc_date = od
        counts["orders"] += 1
        if (today - od).days < 4 and rng.random() < 0.5:
            continue  # draft order
        await sales.set_status(so.id, "confirmed")
        ivd = od + timedelta(days=rng.randint(2, 12))
        if ivd > today:
            continue
        inv = await sales.order_to_invoice(so.id, created_by=created_by)
        inv.doc_date = ivd
        inv.due_date = ivd + timedelta(days=case.payment_days)
        counts["invoices"] += 1
        if (today - ivd).days < 2:
            continue  # draft invoice
        await sales.issue_invoice(inv.id, created_by=created_by)
        await book_cogs(inv, lines, ivd)
        p = rng.random()
        overdue = inv.due_date < today
        if overdue and not chased:
            chased = True  # one overdue debtor to chase
            continue
        if p < (0.9 if overdue else 0.45):
            latest = min(today, inv.due_date + timedelta(days=12))
            pay_day = ivd + timedelta(days=rng.randint(1, max(1, (latest - ivd).days)))
            pay_day = min(pay_day, today)
            if rng.random() < 0.12:
                part = money(inv.gross_total * D("0.5"))
                await sales.record_payment(inv.id, amount=part, pay_date=pay_day, reference="Instalment 1",
                                           created_by=created_by)
                counts["payments"] += 1
                continue
            await sales.record_payment(inv.id, amount=inv.gross_total, pay_date=pay_day,
                                       reference=f"Bank transfer {cust.name}"[:100], created_by=created_by)
            counts["payments"] += 1

    # B2C: weekly settlement invoice for web-shop or counter sales, paid out by the card processor.
    if webshop is not None:
        week = D(profile["revenue"]) * 12 / 52
        d = start + timedelta(days=6)
        while d < today:
            lines = pick_lines(country, week * D(rng.randint(85, 115)) / 100, k=len(items_def))
            inv = await sales.create("invoice", lines=lines, doc_date=d, due_date=d + timedelta(days=3),
                                     created_by=created_by, customer_id=webshop.id, customer_name=webshop.name,
                                     currency=currency, notes=f"{case.extra.get('walk_in_note', 'Web shop orders')} week {d:%G-%V}")
            await sales.issue_invoice(inv.id, created_by=created_by)
            await book_cogs(inv, lines, d)
            counts["invoices"] += 1
            if d + timedelta(days=2) <= today:
                await sales.record_payment(inv.id, amount=inv.gross_total, pay_date=d + timedelta(days=2),
                                           reference=f"Card payout week {d:%G-%V}", created_by=created_by)
                counts["payments"] += 1
            d += timedelta(days=7)

    bills = {"bills": 0, "bills_paid": 0}
    reclaim = case.extra.get("input_vat", True)

    async def supplier_bill(vendor: tuple[str, str], day: date, net: Decimal, role: str, label: str) -> None:
        name, vcc = vendor
        net = money(net)
        if net <= 0 or day > today:
            return
        bills["bills"] += 1
        ref = f"{case_key[:3].upper()}-B{bills['bills']:04d}"
        tax = money(net * vat / 100) if vcc == country else D(0)  # foreign suppliers: reverse charge
        lines = [LineInput(acc[role], debit=net if reclaim else net + tax, description=f"{label} {ref}")]
        if tax > 0 and reclaim:
            lines.append(LineInput(acc["input_vat"], debit=tax, description=f"{ref} input VAT"))
        lines.append(LineInput(acc["payables"], credit=net + tax, description=f"{name} {ref}"[:500]))
        await gl.create_entry(entry_date=day, lines=lines, memo=f"Supplier bill {ref} {name}",
                              source_type=BILL_SOURCE, **meta)
        pay = day + timedelta(days=SUPPLIER_TERMS + rng.randint(-4, 6))
        if pay <= today:
            await gl.create_entry(
                entry_date=pay, memo=f"Payment supplier bill {ref} {name}", source_type=BILL_PAY_SOURCE,
                lines=[LineInput(acc["payables"], debit=net + tax, description=f"{name} {ref}"[:500]),
                       LineInput(acc["bank"], credit=net + tax, description=f"Payment {ref}")], **meta)
            bills["bills_paid"] += 1

    # Stock purchases on credit: an opening stock, then each month's issues plus a small buffer.
    goods_vendors = [(n, cc) for n, cc, cat in case.suppliers if cat == "goods"] or [case.suppliers[0][:2]]
    if cogs_month:
        avg = sum(cogs_month.values(), D(0)) / len(cogs_month)
        month = start
        while month <= today:
            need = cogs_month.get(month, D(0)) * D(rng.randint(100, 110)) / 100
            if month == start:
                need += avg * D("1.2")
            for j, vendor in enumerate(goods_vendors):
                share = D(1) / len(goods_vendors)
                day = start if month == start else month + timedelta(days=rng.randint(0, 9))
                await supplier_bill(vendor, day, need * share, "inventory", "Goods purchase")
            month = _months_back(month, -1)

    # Operating costs: external services on supplier bills, the rest paid from the bank.
    service_vendor = next(((n, cc) for n, cc, cat in case.suppliers if cat == "services"), None)
    expenses = 0
    month = start
    while month <= today:
        for label, cat, monthly in case.expenses:
            day = month + timedelta(days=rng.randint(0, 26))
            if day > today:
                continue
            net = money(D(monthly) * D(rng.randint(88, 112)) / 100)
            expenses += 1
            if cat == "services" and service_vendor is not None:
                await supplier_bill(service_vendor, day, net, "services", label)
                continue
            tax = D(0) if cat in NO_VAT_CATEGORIES else money(net * vat / 100)
            lines = [LineInput(acc[cat], debit=net if reclaim else net + tax, description=label)]
            if tax > 0 and reclaim:
                lines.append(LineInput(acc["input_vat"], debit=tax, description=f"{label} input VAT"))
            lines.append(LineInput(acc["bank"], credit=net + tax, description=label))
            await gl.create_entry(entry_date=day, lines=lines, memo=f"{label} {day:%b %Y}",
                                  source_type=EXPENSE_SOURCE, **meta)
        month = _months_back(month, -1)

    # Bank loan: drawn at the start, 48 monthly instalments plus interest.
    loan = D(profile.get("loan", 0))
    if loan > 0:
        await gl.create_entry(
            entry_date=start, memo=f"Bank loan drawdown {case.company}", source_type=LOAN_SOURCE,
            lines=[LineInput(acc["bank"], debit=loan, description="Loan drawdown"),
                   LineInput(acc["loan"], credit=loan, description="Term loan, 48 months")], **meta)
        balance, month = loan, _months_back(start, -1)
        while month + timedelta(days=27) <= today:
            interest, principal = money(balance * D("0.055") / 12), money(loan / 48)
            await gl.create_entry(
                entry_date=month + timedelta(days=27), memo=f"Loan instalment {month:%b %Y}", source_type=LOAN_SOURCE,
                lines=[LineInput(acc["interest"], debit=interest, description="Loan interest"),
                       LineInput(acc["loan"], debit=principal, description="Loan repayment"),
                       LineInput(acc["bank"], credit=interest + principal, description="Loan instalment")], **meta)
            balance -= principal
            month = _months_back(month, -1)

    p2p = await _seed_purchasing(session, case, tenant, currency, vat, country, today, created_by)         if case_key in P2P_CASES else 0

    # Paid-in capital sized so the bank never dips below one month of fixed costs; doubles as
    # the idempotency marker.
    flows = await session.execute(
        select(GLJournalEntry.entry_date, func.sum(GLJournalLine.base_debit - GLJournalLine.base_credit))
        .join(GLJournalEntry, GLJournalEntry.id == GLJournalLine.entry_id)
        .where(GLJournalLine.account_id == acc["bank"], GLJournalEntry.tenant_id == tenant)
        .group_by(GLJournalEntry.entry_date).order_by(GLJournalEntry.entry_date)
    )
    run = low = D(0)
    for _, v in flows:
        run += v or D(0)
        low = min(low, run)
    cushion = D(sum(e[2] for e in case.expenses))
    capital = max(D(25000), ((cushion - low) / 10000).to_integral_value(rounding=ROUND_CEILING) * 10000)
    await gl.create_entry(
        entry_date=start, memo=f"Opening balance {case.company}", source_type=MARKER_SOURCE,
        lines=[LineInput(acc["bank"], debit=capital, description="Opening bank balance"),
               LineInput(acc["equity"], credit=capital, description="Paid-in capital")], **meta)

    await _seed_bank_account(session, case, tenant, currency, codes["bank"], acc["bank"], today)
    deals = await _seed_deals(session, case, customers, currency, today, rng, owner)
    tasks, pos = await _seed_operations(session, case, owner, currency, vat, today, rng)
    bookings = await _seed_appointments(session, case, tenant, today, rng, created_by)
    await session.flush()
    result = {"case": case_key, "company": case.company, "already_installed": False, "currency": currency,
              "customers": len(case.customers), "suppliers": len(case.suppliers), **counts,
              "expenses": expenses, **bills, "items": n_items, "capital": capital, "loan": loan, "deals": deals, "tasks": tasks, "appointments": bookings, "purchase_orders": pos, "p2p_orders": p2p}
    logger.info("Business demo %s installed: %s", case_key, result)
    return result


# Appointments demo: consultations, showroom visits and loading-bay pickups.
APPOINTMENT_DEMO: dict[str, dict[str, Any]] = {
    "trade_distribution": {
        "resources": [
            ("Jonas Vettermann", "staff", "#2563eb"), ("Mara Ellenbogen", "staff", "#059669"),
            ("Showroom Hamburg", "room", "#d97706"),
            ("Loading bay 1", "equipment", "#7c3aed"), ("Loading bay 2", "equipment", "#db2777"),
        ],
        # name, description, minutes, buffer after, price, resource kind, online
        "services": [
            ("Product consultation", "Range, volume prices and delivery terms with your account manager.", 45, 10, 0, "staff", True),
            ("Packaging audit", "On-site review of your packaging spend with a written savings estimate.", 90, 15, 120, "staff", True),
            ("Showroom visit and sample review", "Walk through the range and test samples in our showroom.", 60, 15, 0, "room", True),
            ("Goods pickup, loading bay", "Collect a ready order at the loading bay; please bring the order number.", 30, 10, 0, "equipment", True),
            ("Key account review", "Quarterly review for contract customers.", 60, 0, 0, "staff", False),
        ],
        "clients": [
            ("Katrin Vollmer", "kestner-maschinenbau"), ("Ole Brandhorst", "varnholt-logistik"),
            ("Silke Dornquist", "dornquist-metallwaren"), ("Henrik Zellbrook", "zellbrook-verpackung"),
            ("Femke de Waal", "veldmoor-industrie"), ("Lars Tallvik", "tallvik-produktion"),
            ("Tobias Wendt", "wendt-soehne"), ("Ines Quellhain", "quellhain-lebensmitteltechnik"),
            ("Marek Felsgrat", "felsgrat-werkzeuge"), ("Sonja Ravenholt", "ravenholt-handwerk"),
        ],
    },
}
_APPT_MARKER = "business_demo:"


async def _appointments_stale(session: AsyncSession, case: Case, tenant: str) -> bool:
    if case.key not in APPOINTMENT_DEMO:
        return False
    from app.modules.appointments.models import AppointmentSettings

    row = await session.scalar(select(AppointmentSettings).where(
        AppointmentSettings.tenant_id == tenant, AppointmentSettings.public_title == case.company))
    return row is None or not row.online_enabled


async def _seed_appointments(session, case, tenant, today, rng, created_by) -> int:
    cfg = APPOINTMENT_DEMO.get(case.key)
    if cfg is None:
        return 0
    from app.modules.appointments.service import AppointmentsService

    svc = AppointmentsService(session, tenant)
    await svc.update_settings(public_title=case.company, online_enabled=True, auto_confirm=False,
                              slot_step_min=15, min_notice_hours=2, max_days_ahead=60,
                              reminders_enabled=True, reminder_hours=24)
    for i, (name, kind, color) in enumerate(cfg["resources"]):
        week = [{"weekday": d, "start_min": 480, "end_min": 1020 if d < 4 else 960} for d in range(5)]
        week += [{"weekday": d, "start_min": 720, "end_min": 765, "kind": "break"} for d in range(5)]
        await svc.create_resource(name=name, kind=kind, color=color, sort_order=i, hours=week)
    colors = ("#2563eb", "#059669", "#d97706", "#7c3aed", "#64748b")
    services = []
    for i, (name, desc, minutes, after, price, kind, online) in enumerate(cfg["services"]):
        services.append(await svc.create_service(
            name=name, description=desc, duration_min=minutes, buffer_after_min=after, price=D(price),
            currency="EUR", resource_kind=kind, online=online, color=colors[i % len(colors)]))
    monday = today - timedelta(days=today.weekday())
    now = datetime.combine(today, time(12))
    weights = [4, 1, 2, 3, 1]
    created = 0
    for week in range(2):
        for wd in range(5):
            day = monday + timedelta(days=7 * week + wd)
            for _ in range(rng.choice([2, 3, 4]) if week == 0 else rng.choice([1, 2, 3])):
                service = rng.choices(services, weights=weights)[0]
                free = await svc.availability(service.id, day, 1)
                if not free:
                    continue
                start, rid = free[rng.randrange(len(free))]
                name, org = rng.choice(cfg["clients"])
                email = f"{name.split()[0][0].lower()}.{name.split()[-1].lower()}@{org}.example"
                phone = f"+49 40 5550 {rng.randint(1000, 9999)}"
                roll = rng.random()
                if start < now:
                    final = "completed" if roll < 0.78 else "no_show" if roll < 0.88 else "cancelled"
                else:
                    final = "confirmed" if roll < 0.70 else "requested" if roll < 0.90 else "cancelled"
                online = final == "requested" or rng.random() < 0.35
                rows = await svc.create_booking(
                    service_id=service.id, resource_id=rid, start_at=start, client_name=name, client_email=email,
                    client_phone=phone, source="online" if online else "staff",
                    status="requested" if final == "requested" else "confirmed",
                    consent_at=datetime.now(UTC) if online else None, created_by=_APPT_MARKER + case.key,
                    notes="Booked via the online booking page." if online else "")
                if final not in ("requested", "confirmed"):
                    await svc.set_status(rows[0].id, final)
                created += 1
    return created


def _all_skus(case_key: str) -> list[str]:
    """Current SKUs plus the legacy ``NW-`` prefix, so installs seeded earlier are cleaned up."""
    skus = [r[0] for r in ITEMS[case_key]]
    return skus + [s.replace("KM-", "NW-") for s in skus if s.startswith("KM-")]


async def _reset_appointments(session, case, tenant) -> int:
    cfg = APPOINTMENT_DEMO.get(case.key)
    if cfg is None:
        return 0
    from app.modules.appointments import models as am

    svc_ids = list((await session.execute(select(am.AppointmentService.id).where(
        am.AppointmentService.tenant_id == tenant,
        am.AppointmentService.name.in_([s[0] for s in cfg["services"]])))).scalars())
    res_ids = list((await session.execute(select(am.AppointmentResource.id).where(
        am.AppointmentResource.tenant_id == tenant,
        am.AppointmentResource.name.in_([r[0] for r in cfg["resources"]])))).scalars())
    book_ids = list((await session.execute(select(am.AppointmentBooking.id).where(
        am.AppointmentBooking.tenant_id == tenant,
        or_(am.AppointmentBooking.created_by == _APPT_MARKER + case.key,
            am.AppointmentBooking.service_id.in_(svc_ids), am.AppointmentBooking.resource_id.in_(res_ids))))).scalars())

    async def drop(model, *where) -> int:
        res = await session.execute(delete(model).where(*where).execution_options(synchronize_session=False))
        return res.rowcount or 0

    n = 0
    if book_ids:
        await drop(am.AppointmentReminder, am.AppointmentReminder.booking_id.in_(book_ids))
        n = await drop(am.AppointmentBooking, am.AppointmentBooking.id.in_(book_ids))
    if res_ids:
        await drop(am.AppointmentHours, am.AppointmentHours.resource_id.in_(res_ids))
        await drop(am.AppointmentException, am.AppointmentException.resource_id.in_(res_ids))
        await drop(am.AppointmentResource, am.AppointmentResource.id.in_(res_ids))
    if svc_ids:
        await drop(am.AppointmentService, am.AppointmentService.id.in_(svc_ids))
    await drop(am.AppointmentSettings, am.AppointmentSettings.tenant_id == tenant,
               am.AppointmentSettings.public_title == case.company)
    return n


def _price_break(row: _I) -> tuple[int, Decimal] | None:
    """Volume price for goods: 5 % off from a quarter of the usual maximum line quantity."""
    _sku, _name, _uom, _cat, price, _cost, goods, maxq = row
    if not goods or maxq < 8:
        return None
    return max(2, maxq // 4), money(D(price) * D("0.95"))


def _line_rate(case: Case, category: str, vat: Decimal, country: str) -> Decimal:
    """Per-category VAT: exemptions (0) hold EU-wide, reduced rates only in the case's own country."""
    rate = case.extra.get("rates", {}).get(category)
    if rate is None or (rate and country != case.country):
        return vat
    return D(rate)


def _item_tax_code(case: Case, category: str, vat: Decimal, country: str) -> str:
    rate = _line_rate(case, category, vat, country)
    return "EXEMPT" if rate == 0 and vat > 0 else _tax_code(rate)


def _tax_code(vat: Decimal) -> str:
    txt = format(vat.quantize(D("0.1")), "f")
    return "VAT" + (txt[:-2] if txt.endswith(".0") else txt)


async def _seed_items(session, case, currency, vat, tenant, created_by, codes, country) -> int:
    """Items catalogue, categories and a price list with quantity breaks (skips existing SKUs)."""
    from app.modules.items.models import Item, ItemPriceList, ItemsCategory
    from app.modules.items.service import ItemsService

    svc = ItemsService(session, tenant)
    rows = ITEMS[case.key]
    cats: dict[str, uuid.UUID] = {}
    for name in dict.fromkeys(r[3] for r in rows):
        cid = await session.scalar(
            select(ItemsCategory.id).where(ItemsCategory.tenant_id == tenant, ItemsCategory.name == name))
        cats[name] = cid or (await svc.create_category(name=name, description=f"{case.company} demo")).id
    have = set((await session.execute(
        select(Item.sku).where(Item.tenant_id == tenant, Item.sku.in_([r[0] for r in rows])))).scalars())
    breaks: list[dict[str, Any]] = []
    n = 0
    for row in rows:
        sku, name, uom, cat, price, cost, goods, _maxq = row
        if sku in have:
            continue
        item = await svc.create_item(
            created_by=created_by, sku=sku, name=name, description=f"{name} ({case.company})", uom=uom,
            item_type="goods" if goods else "service", sales_price=D(price), purchase_cost=D(cost),
            currency=currency, tax_code=_item_tax_code(case, cat, vat, country), revenue_account=codes["revenue"],
            expense_account=codes["cogs"] if goods else codes["services"], stock_tracked=goods,
            category_id=cats[cat])
        n += 1
        breaks.append({"item_id": item.id, "min_qty": D(0), "unit_price": D(price)})
        brk = _price_break(row)
        if brk:
            breaks.append({"item_id": item.id, "min_qty": D(brk[0]), "unit_price": brk[1]})
    pl_name = f"{case.company} volume prices"
    exists = await session.scalar(
        select(ItemPriceList.id).where(ItemPriceList.tenant_id == tenant, ItemPriceList.name == pl_name))
    if breaks and exists is None:
        await svc.create_price_list(items=breaks, name=pl_name, currency=currency, priority=10)
    return n


async def _seed_deals(session, case, customers, currency, today, rng, owner) -> int:
    stages = await _ensure_stages(session)
    plan = ["lead", "qualified", "proposal", "negotiation", "proposal", "qualified", "won", "lost"]
    top = D(PROFILE.get(case.key, {}).get("revenue", 20000)) / 2
    n = 0
    for i, title in enumerate(case.deals):
        code = plan[i % len(plan)]
        st = stages[code]
        cust = customers[rng.randrange(len(customers))]
        value = money(top * D(rng.randint(60, 400)) / 100)
        close = today + timedelta(days=rng.randint(10, 120)) if not st.is_final else today - timedelta(days=rng.randint(3, 40))
        prob = st.default_probability_percent
        opp = Opportunity(
            account_id=cust.id, title=title, description=f"{title} for {cust.name}", estimated_value=value,
            currency=currency, expected_close_date=close.isoformat(), probability_percent=prob, stage_id=st.id,
            weighted_value=money(value * prob / 100), source=rng.choice(["inbound", "referral", "outbound", "event"]),
            owner_user_id=owner, status="won" if st.is_won else "lost" if st.is_lost else "open",
            won_at=close.isoformat() if st.is_won else None, lost_at=close.isoformat() if st.is_lost else None,
            notes="", competitor_names=[],
        )
        session.add(opp)
        await session.flush()
        session.add(OpportunityStageHistory(opportunity_id=opp.id, from_stage_id=None, to_stage_id=st.id,
                                            changed_at=today.isoformat(), changed_by=owner))
        n += 1
    return n


async def _seed_operations(session, case, owner, currency, vat, today, rng) -> tuple[int, int]:
    """Tasks and purchase orders hang off an internal operations workspace."""
    if owner is None:
        return 0, 0
    from app.modules.procurement.models import PurchaseOrder, PurchaseOrderItem
    from app.modules.projects.models import Project
    from app.modules.tasks.models import Task

    ws = Project(name=f"{case.company} operations", description=case.summary, currency=currency, locale="en",
                 status="active", owner_id=owner, metadata_={"business_demo": case.key})
    session.add(ws)
    await session.flush()
    statuses = ["open", "in_progress", "open", "completed", "in_progress"]
    for i, title in enumerate(case.tasks):
        session.add(Task(project_id=ws.id, task_type="task", title=title, status=statuses[i % len(statuses)],
                         priority=rng.choice(["normal", "normal", "high", "low"]), responsible_id=str(owner),
                         due_date=(today + timedelta(days=rng.randint(-5, 30))).isoformat(), created_by=str(owner),
                         metadata_={"business_demo": case.key}))
    pos = 0
    buys = [(n, cat) for n, _, cat in case.suppliers if cat in ("goods", "services")]
    for i, (vendor, cat) in enumerate(buys * 2):
        issue = today - timedelta(days=rng.randint(5, 120))
        if cat == "goods":
            stock = [(r[1], max(2, r[7] // 2), D(r[5])) for r in ITEMS[case.key] if r[6]]
            rows = [stock[(i * 2 + k) % len(stock)] for k in range(2)] if stock else []
        else:
            rows = [(label, 1, money(D(monthly) / 4)) for label, c, monthly in case.expenses if c == cat][:2]
        rows = rows or [(vendor, 1, D(1000))]
        sub = sum((money(q * v) for _, q, v in rows), D(0))
        tax = money(sub * vat / 100)
        po = PurchaseOrder(project_id=ws.id, po_number=f"PO-{i + 1:04d}", issue_date=issue.isoformat(),
                           delivery_date=(issue + timedelta(days=rng.randint(3, 21))).isoformat(),
                           currency_code=currency, amount_subtotal=str(sub), tax_amount=str(tax),
                           amount_total=str(sub + tax), status=rng.choice(["completed", "completed", "issued", "approved"]),
                           payment_terms="30 days net", notes=vendor, created_by=owner,
                           metadata_={"business_demo": case.key, "vendor_name": vendor})
        session.add(po)
        await session.flush()
        for j, (label, q, v) in enumerate(rows):
            session.add(PurchaseOrderItem(po_id=po.id, description=label, quantity=str(q), unit_rate=str(money(v)),
                                          amount=str(money(q * v)), sort_order=j))
        pos += 1
    return len(case.tasks), pos


def bank_account_name(company: str) -> str:
    return f"{company} current account"


def demo_bank_iban(case) -> str:
    return f"{case.country}00 0000 0000 {zlib.crc32(case.key.encode()) % 10**8:08d}"


async def _seed_bank_account(session, case, tenant, currency, bank_code, bank_acc_id, today) -> None:
    """Company bank account on the cash GL account with its last 30 ledger movements as statement lines."""
    from app.modules.banking.models import BankAccount, BankTransaction

    name = bank_account_name(case.company)
    if await session.scalar(select(BankAccount.id).where(BankAccount.tenant_id == tenant, BankAccount.name == name)):
        return
    ba = BankAccount(tenant_id=tenant, name=name, iban=demo_bank_iban(case),
                     currency=currency, gl_account_code=bank_code, active=True)
    session.add(ba)
    await session.flush()
    rows = (await session.execute(
        select(GLJournalEntry.id, GLJournalEntry.entry_date, GLJournalEntry.memo,
               GLJournalLine.base_debit - GLJournalLine.base_credit)
        .join(GLJournalEntry, GLJournalEntry.id == GLJournalLine.entry_id)
        .where(GLJournalLine.account_id == bank_acc_id, GLJournalEntry.tenant_id == tenant,
               GLJournalEntry.entry_date <= today)
        .order_by(GLJournalEntry.entry_date.desc()).limit(30))).all()
    # Opening balance = ledger balance before the imported window, so bank balance equals the GL balance.
    gl_total = await session.scalar(
        select(func.coalesce(func.sum(GLJournalLine.base_debit - GLJournalLine.base_credit), 0))
        .join(GLJournalEntry, GLJournalEntry.id == GLJournalLine.entry_id)
        .where(GLJournalLine.account_id == bank_acc_id, GLJournalEntry.tenant_id == tenant,
               GLJournalEntry.entry_date <= today))
    ba.opening_balance = money(D(gl_total or 0) - sum((money(a) for _, _, _, a in rows if a), D(0)))
    ba.opening_balance_date = min((d for _, d, _, a in rows if a), default=today)
    for n, (eid, day, memo, amt) in enumerate(rows):
        if not amt:
            continue
        done = n >= 6  # the six most recent lines wait for matching
        session.add(BankTransaction(
            tenant_id=tenant, account_id=ba.id, booking_date=day, value_date=day, amount=money(amt), currency=currency,
            counterparty_name=(memo or "")[:255], remittance=memo or "", reference=str(eid)[:8],
            dedupe_key=f"demo-{eid}", status="matched" if done else "unmatched",
            matched_amount=abs(money(amt)) if done else D(0)))
    await session.flush()


P2P_CASES = {"trade_distribution", "retail_ecommerce", "manufacturing", "craft_trades", "food_production",
             "restaurant_cafe", "franchise_multisite", "field_service"}


async def _seed_purchasing(session, case, tenant, currency, vat, country, today, created_by) -> int:
    """Purchasing module documents: one open PO, one partially received, one received, billed (price variance) and paid."""
    from app.modules.items.models import Item
    from app.modules.purchasing.service import LineData, PurchasingService

    svc = PurchasingService(session, tenant)
    goods = [(n, cc) for n, cc, cat in case.suppliers if cat == "goods"] or [case.suppliers[0][:2]]
    sup = {a.name: a.id for a in (await session.execute(select(Account).where(Account.role == "supplier"))).scalars()
           if f"demo:{case.key}" in (a.tags or [])}
    rows = [r for r in ITEMS[case.key] if r[6]] or ITEMS[case.key]
    ids = {i.sku: i.id for i in (await session.execute(
        select(Item).where(Item.tenant_id == tenant, Item.sku.in_([r[0] for r in rows])))).scalars()}

    def lines(k: int, vcc: str) -> list[LineData]:
        rate = vat if vcc == country else D(0)
        picked = [rows[(k + j) % len(rows)] for j in range(2)]
        return [LineData(description=r[1], sku=r[0], qty=D(max(4, r[7] // 2)), unit_price=money(D(r[5])),
                         tax_rate=rate, item_id=ids.get(r[0])) for r in dict.fromkeys(picked)]

    async def order(k: int, day: date):
        name, vcc = goods[k % len(goods)]
        po = await svc.create_order(lines=lines(k, vcc), doc_date=day, created_by=created_by, supplier_id=sup.get(name),
                                    supplier_name=name, currency=currency, due_date=day + timedelta(days=14),
                                    notes=f"Replenishment {case.company}")
        await svc.set_order_status(po.id, "confirmed")
        return po

    # Received, billed 2% above PO price (price variance), paid.
    d0 = today - timedelta(days=55)
    po = await order(0, d0)
    await svc.receive(po.id, doc_date=d0 + timedelta(days=5), created_by=created_by)
    bill = await svc.create_bill(
        "bill", doc_date=d0 + timedelta(days=7), created_by=created_by, order_id=po.id, supplier_id=po.supplier_id,
        supplier_name=po.supplier_name, supplier_ref=f"INV-{d0:%y%m}-17", currency=currency,
        lines=[LineData(pl.description, pl.sku, pl.qty, money(pl.unit_price * D("1.02")), pl.tax_rate, pl.item_id, pl.id)
               for pl in po.lines])
    await svc.post_bill(bill.id, created_by=created_by)
    await svc.record_payment(bill.id, amount=bill.gross_total, pay_date=d0 + timedelta(days=30),
                             reference=bill.supplier_ref, created_by=created_by)

    # Partially received: half of the first line delivered.
    d1 = today - timedelta(days=12)
    po = await order(1, d1)
    first = po.lines[0]
    await svc.receive(po.id, {first.id: (first.qty / 2).to_integral_value()}, doc_date=d1 + timedelta(days=4),
                      created_by=created_by)

    # Open: confirmed, nothing delivered yet.
    await order(2, today - timedelta(days=3))

    # Opening stock: every goods item received and paid; the last two sit below their reorder level.
    tracked = [r for r in ITEMS[case.key] if r[6]]
    low = {r[0] for r in tracked[-2:]}
    minimum = {r[0]: max(2, r[7] // 6) for r in tracked}
    for sku, mn in minimum.items():
        await session.execute(update(Item).where(Item.tenant_id == tenant, Item.sku == sku).values(min_stock=D(mn)))
    name, vcc = goods[0]
    rate = vat if vcc == country else D(0)
    d2 = today - timedelta(days=40)
    po = await svc.create_order(
        lines=[LineData(description=r[1], sku=r[0], qty=D(max(1, minimum[r[0]] // 2) if r[0] in low else max(4, r[7] // 2)),
                        unit_price=money(D(r[5])), tax_rate=rate, item_id=ids.get(r[0])) for r in tracked],
        doc_date=d2, created_by=created_by, supplier_id=sup.get(name), supplier_name=name, currency=currency,
        due_date=d2 + timedelta(days=5), notes=f"Opening stock {case.company}")
    await svc.set_order_status(po.id, "confirmed")
    await svc.receive(po.id, doc_date=d2 + timedelta(days=3), created_by=created_by)
    bill = await svc.create_bill(
        "bill", doc_date=d2 + timedelta(days=4), created_by=created_by, order_id=po.id, supplier_id=po.supplier_id,
        supplier_name=po.supplier_name, supplier_ref=f"INV-{d2:%y%m}-OS", currency=currency,
        lines=[LineData(pl.description, pl.sku, pl.qty, pl.unit_price, pl.tax_rate, pl.item_id, pl.id) for pl in po.lines])
    await svc.post_bill(bill.id, created_by=created_by)
    await svc.record_payment(bill.id, amount=bill.gross_total, pay_date=d2 + timedelta(days=30),
                             reference=bill.supplier_ref, created_by=created_by)

    # Monthly supplier bills over six months: older ones paid, one overdue, two falling due this week.
    vendors = [(n, cc) for n, cc, _cat in case.suppliers]
    plan = [(150, True), (120, True), (90, True), (62, True), (38, False), (26, False), (24, False), (9, False)]
    for k, (age, paid) in enumerate(plan):
        vname, vcc = vendors[k % len(vendors)]
        day = today - timedelta(days=age)
        net = money(D(2800 + 650 * ((k * 3) % 5)))
        b = await svc.create_bill(
            "bill", doc_date=day, created_by=created_by, supplier_id=sup.get(vname), supplier_name=vname,
            supplier_ref=f"INV-{day:%y%m}-{k + 1:02d}", currency=currency, due_date=day + timedelta(days=30),
            lines=[LineData(description=f"Goods and services {day:%b %Y}", qty=D(1), unit_price=net,
                            tax_rate=vat if vcc == country else D(0))])
        await svc.post_bill(b.id, created_by=created_by)
        if paid:
            await svc.record_payment(b.id, amount=b.gross_total, pay_date=min(today, day + timedelta(days=28)),
                                     reference=b.supplier_ref, created_by=created_by)
    return 4


async def reset_business_demo(session: AsyncSession, case_key: str, *, tenant_id: str | None = None) -> dict[str, int]:
    """Delete one case's demo rows for ``tenant_id`` (caller commits); found via source markers and tags."""
    from app.modules.items.models import Item, ItemPriceList, ItemsCategory
    from app.modules.procurement.models import PurchaseOrder, PurchaseOrderItem
    from app.modules.projects.models import Project
    from app.modules.sales.models import SalesDocument, SalesLine, SalesPayment
    from app.modules.sales.service import SOURCE_INVOICE, SOURCE_PAYMENT
    from app.modules.tasks.models import Task

    case = CASES.get(case_key)
    if case is None:
        raise BusinessDemoError(f"Unknown business demo case {case_key!r}; available: {sorted(CASES)}")
    tenant = tenant_id or DEFAULT_TENANT
    tag = f"demo:{case_key}"
    out: dict[str, int] = {}

    async def drop(model, *where) -> int:
        res = await session.execute(delete(model).where(*where).execution_options(synchronize_session=False))
        return res.rowcount or 0

    accounts = [a for a in (await session.execute(select(Account))).scalars() if tag in (a.tags or [])]
    acc_ids = [a.id for a in accounts]
    doc_ids = list((await session.execute(select(SalesDocument.id).where(
        SalesDocument.tenant_id == tenant, SalesDocument.customer_id.in_(acc_ids)))).scalars()) if acc_ids else []
    pay_ids = list((await session.execute(
        select(SalesPayment.id).where(SalesPayment.invoice_id.in_(doc_ids)))).scalars()) if doc_ids else []
    sales_refs = [(SOURCE_INVOICE, str(i)) for i in doc_ids] + [(SOURCE_PAYMENT, str(i)) for i in pay_ids]
    entry_ids = list((await session.execute(select(GLJournalEntry.id).where(
        GLJournalEntry.tenant_id == tenant, GLJournalEntry.source_type.in_(DEMO_SOURCES),
        GLJournalEntry.source_id == case_key))).scalars())
    for i in range(0, len(sales_refs), 500):
        chunk = sales_refs[i:i + 500]
        for st in (SOURCE_INVOICE, SOURCE_PAYMENT):
            ids = [sid for t, sid in chunk if t == st]
            if ids:
                entry_ids += list((await session.execute(select(GLJournalEntry.id).where(
                    GLJournalEntry.tenant_id == tenant, GLJournalEntry.source_type == st,
                    GLJournalEntry.source_id.in_(ids)))).scalars())
    if acc_ids:
        from app.modules.purchasing import models as pm
        from app.modules.purchasing import service as ps

        po_ids = list((await session.execute(select(pm.PurchasingOrder.id).where(
            pm.PurchasingOrder.tenant_id == tenant, pm.PurchasingOrder.supplier_id.in_(acc_ids)))).scalars())
        bill_ids = list((await session.execute(select(pm.PurchasingBill.id).where(
            pm.PurchasingBill.tenant_id == tenant, pm.PurchasingBill.supplier_id.in_(acc_ids)))).scalars())
        gr_ids = list((await session.execute(select(pm.PurchasingReceipt.id).where(
            pm.PurchasingReceipt.order_id.in_(po_ids)))).scalars()) if po_ids else []
        bp_ids = list((await session.execute(select(pm.PurchasingPayment.id).where(
            pm.PurchasingPayment.bill_id.in_(bill_ids)))).scalars()) if bill_ids else []
        for st, ids in ((ps.SOURCE_RECEIPT, gr_ids), (ps.SOURCE_BILL, bill_ids), (ps.SOURCE_PAYMENT, bp_ids)):
            if ids:
                entry_ids += list((await session.execute(select(GLJournalEntry.id).where(
                    GLJournalEntry.tenant_id == tenant, GLJournalEntry.source_type == st,
                    GLJournalEntry.source_id.in_([str(i) for i in ids])))).scalars())
        if bill_ids:
            await drop(pm.PurchasingPayment, pm.PurchasingPayment.bill_id.in_(bill_ids))
            await drop(pm.PurchasingBillLine, pm.PurchasingBillLine.bill_id.in_(bill_ids))
            await drop(pm.PurchasingBill, pm.PurchasingBill.id.in_(bill_ids))
        if po_ids:
            if gr_ids:
                await drop(pm.PurchasingReceiptLine, pm.PurchasingReceiptLine.receipt_id.in_(gr_ids))
                await drop(pm.PurchasingReceipt, pm.PurchasingReceipt.id.in_(gr_ids))
            await drop(pm.PurchasingOrderLine, pm.PurchasingOrderLine.order_id.in_(po_ids))
            out["p2p_orders"] = await drop(pm.PurchasingOrder, pm.PurchasingOrder.id.in_(po_ids))
        await drop(pm.PurchasingStock, pm.PurchasingStock.tenant_id == tenant, pm.PurchasingStock.sku.in_(
            _all_skus(case_key)))
    from app.modules.banking.models import BankAccount, BankTransaction

    # Match the IBAN too: it derives from the case key, so it survives renames of the demo company.
    ba_ids = list((await session.execute(select(BankAccount.id).where(
        BankAccount.tenant_id == tenant,
        or_(BankAccount.name == bank_account_name(CASES[case_key].company),
            BankAccount.iban == demo_bank_iban(CASES[case_key]))))).scalars())
    if ba_ids:
        await drop(BankTransaction, BankTransaction.account_id.in_(ba_ids))
        await drop(BankAccount, BankAccount.id.in_(ba_ids))
    if entry_ids:
        await drop(GLJournalLine, GLJournalLine.entry_id.in_(entry_ids))
        out["gl_entries"] = await drop(GLJournalEntry, GLJournalEntry.id.in_(entry_ids))
    if doc_ids:
        await drop(SalesPayment, SalesPayment.invoice_id.in_(doc_ids))
        await drop(SalesLine, SalesLine.document_id.in_(doc_ids))
        await session.execute(update(SalesDocument).where(SalesDocument.id.in_(doc_ids)).values(source_id=None))
        out["sales_documents"] = await drop(SalesDocument, SalesDocument.id.in_(doc_ids))
    if acc_ids:
        opp_ids = list((await session.execute(
            select(Opportunity.id).where(Opportunity.account_id.in_(acc_ids)))).scalars())
        if opp_ids:
            await drop(OpportunityStageHistory, OpportunityStageHistory.opportunity_id.in_(opp_ids))
            out["deals"] = await drop(Opportunity, Opportunity.id.in_(opp_ids))
        out["accounts"] = await drop(Account, Account.id.in_(acc_ids))
    projects = [p.id for p in (await session.execute(
        select(Project).where(Project.name == f"{case.company} operations"))).scalars()
        if (p.metadata_ or {}).get("business_demo") == case_key]
    if projects:
        po_ids = list((await session.execute(
            select(PurchaseOrder.id).where(PurchaseOrder.project_id.in_(projects)))).scalars())
        if po_ids:
            await drop(PurchaseOrderItem, PurchaseOrderItem.po_id.in_(po_ids))
            out["purchase_orders"] = await drop(PurchaseOrder, PurchaseOrder.id.in_(po_ids))
        out["tasks"] = await drop(Task, Task.project_id.in_(projects))
        await drop(Project, Project.id.in_(projects))
    out["appointments"] = await _reset_appointments(session, case, tenant)
    skus = _all_skus(case_key)
    out["price_lists"] = await drop(ItemPriceList, ItemPriceList.tenant_id == tenant,
                                    ItemPriceList.name == f"{case.company} volume prices")
    out["items"] = await drop(Item, Item.tenant_id == tenant, Item.sku.in_(skus))
    cats = {r[3] for r in ITEMS[case_key]}
    used = set((await session.execute(select(ItemsCategory.name).join(Item, Item.category_id == ItemsCategory.id)
                                      .where(ItemsCategory.tenant_id == tenant))).scalars())
    if cats - used:
        await drop(ItemsCategory, ItemsCategory.tenant_id == tenant, ItemsCategory.name.in_(cats - used))
    await session.flush()
    logger.info("Business demo %s reset for tenant %s: %s", case_key, tenant, out)
    return out


async def reinstall_business_demo(
    session: AsyncSession, case_key: str, *, owner_id: uuid.UUID | None = None, tenant_id: str | None = None,
    today: date | None = None,
) -> dict[str, Any]:
    removed = await reset_business_demo(session, case_key, tenant_id=tenant_id)
    result = await install_business_demo(session, case_key, owner_id=owner_id, tenant_id=tenant_id, today=today)
    return {**result, "removed": removed}


def business_preset_key(company_type: str | None = None) -> str | None:
    """The business preset in force: ``company_type`` or the stored industry, if it is a business preset."""
    from app.core.onboarding_presets import BUSINESS_PRESET_KEYS

    key = company_type or read_business_settings().get("industry") or ""
    return key if key in BUSINESS_PRESET_KEYS else None


async def seed_business_demo_for_preset(preset: str, owner_id: uuid.UUID | None = None) -> dict[str, Any] | None:
    """Install the case for ``preset`` in its own session; never raises (startup / onboarding hook)."""
    if preset not in CASES:
        return None
    from app.database import async_session_factory

    try:
        async with async_session_factory() as session:
            result = await install_business_demo(session, preset, owner_id=owner_id)
            await session.commit()
            return result
    except Exception:
        logger.warning("Business demo seed for %s skipped (non-fatal)", preset, exc_info=True)
        return None
