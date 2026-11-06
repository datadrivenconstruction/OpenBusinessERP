# DDC-CWICR-OE: DataDrivenConstruction · OpenBusinessERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Chart-of-accounts templates: (code, name, type, parent_code, is_postable)."""

from __future__ import annotations

from decimal import Decimal

A, L, E, I, X = "asset", "liability", "equity", "income", "expense"

IFRS_GENERIC: list[tuple[str, str, str, str | None, bool]] = [
    ("1", "Assets", A, None, False),
    ("10", "Non-current assets", A, "1", False),
    ("1000", "Property, plant and equipment", A, "10", True),
    ("1010", "Accumulated depreciation - PP&E", A, "10", True),
    ("1100", "Intangible assets", A, "10", True),
    ("1110", "Accumulated amortisation - intangibles", A, "10", True),
    ("1200", "Right-of-use assets", A, "10", True),
    ("11", "Current assets", A, "1", False),
    ("1300", "Inventories", A, "11", True),
    ("1350", "Accrued income", A, "11", True),
    ("1400", "Trade receivables", A, "11", True),
    ("1450", "Input VAT receivable", A, "11", True),
    ("1500", "Other receivables", A, "11", True),
    ("1600", "Prepayments", A, "11", True),
    ("1700", "Cash on hand", A, "11", True),
    ("1710", "Bank accounts", A, "11", True),
    ("2", "Liabilities", L, None, False),
    ("2000", "Long-term borrowings", L, "2", True),
    ("2050", "Lease liabilities", L, "2", True),
    ("2100", "Provisions", L, "2", True),
    ("2200", "Trade payables", L, "2", True),
    ("2250", "Customer advances / deferred revenue", L, "2", True),
    ("2300", "Output VAT payable", L, "2", True),
    ("2350", "Income tax payable", L, "2", True),
    ("2400", "Payroll liabilities", L, "2", True),
    ("2500", "Accrued expenses", L, "2", True),
    ("2550", "Goods received not invoiced", L, "2", True),
    ("2600", "Short-term borrowings", L, "2", True),
    ("3", "Equity", E, None, False),
    ("3000", "Share capital", E, "3", True),
    ("3100", "Share premium / capital reserve", E, "3", True),
    ("3200", "Retained earnings", E, "3", True),
    ("3300", "Other comprehensive income reserve", E, "3", True),
    ("4", "Income", I, None, False),
    ("4000", "Sales revenue", I, "4", True),
    ("4100", "Other operating income", I, "4", True),
    ("4200", "Finance income", I, "4", True),
    ("4300", "FX gains", I, "4", True),
    ("5", "Expenses", X, None, False),
    ("5000", "Cost of goods sold", X, "5", True),
    ("5050", "Freight and shipping", X, "5", True),
    ("5100", "Purchased services", X, "5", True),
    ("5200", "Wages and salaries", X, "5", True),
    ("5300", "Depreciation and amortisation", X, "5", True),
    ("5400", "Rent and occupancy", X, "5", True),
    ("5450", "Utilities", X, "5", True),
    ("5500", "Other operating expenses", X, "5", True),
    ("5510", "Marketing and advertising", X, "5", True),
    ("5520", "Software and IT", X, "5", True),
    ("5530", "Bank charges", X, "5", True),
    ("5600", "Finance costs", X, "5", True),
    ("5700", "FX losses", X, "5", True),
    ("5800", "Income tax expense", X, "5", True),
]

DE_SKR03: list[tuple[str, str, str, str | None, bool]] = [
    # Anlagevermögen
    ("0027", "EDV-Software", A, None, True),
    ("0200", "Technische Anlagen und Maschinen", A, None, True),
    ("0320", "Pkw", A, None, True),
    ("0350", "Lkw", A, None, True),
    ("0410", "Geschäftsausstattung", A, None, True),
    ("0420", "Büroeinrichtung", A, None, True),
    ("0480", "Geringwertige Wirtschaftsgüter", A, None, True),
    ("0980", "Aktive Rechnungsabgrenzung", A, None, True),
    # Umlaufvermögen
    ("1000", "Kasse", A, None, True),
    ("1200", "Bank", A, None, True),
    ("1360", "Geldtransit", A, None, True),
    ("1400", "Forderungen aus Lieferungen und Leistungen", A, None, True),
    ("1500", "Sonstige Vermögensgegenstände", A, None, True),
    ("1570", "Abziehbare Vorsteuer", A, None, True),
    ("1571", "Abziehbare Vorsteuer 7 %", A, None, True),
    ("1576", "Abziehbare Vorsteuer 19 %", A, None, True),
    ("1577", "Vorsteuer nach § 13b UStG 19 %", A, None, True),
    ("1588", "Bezahlte Einfuhrumsatzsteuer", A, None, True),
    ("1590", "Durchlaufende Posten", A, None, True),
    ("3980", "Bestand Waren", A, None, True),
    ("7000", "Unfertige Erzeugnisse und Leistungen (Bestand)", A, None, True),
    # Eigenkapital
    ("0800", "Gezeichnetes Kapital", E, None, True),
    ("0840", "Kapitalrücklage", E, None, True),
    ("0860", "Gewinnvortrag vor Verwendung", E, None, True),
    ("0868", "Verlustvortrag vor Verwendung", E, None, True),
    ("1800", "Privatentnahmen allgemein", E, None, True),
    ("1890", "Privateinlagen", E, None, True),
    # Verbindlichkeiten / Rückstellungen
    ("0630", "Verbindlichkeiten gegenüber Kreditinstituten", L, None, True),
    ("0950", "Steuerrückstellungen", L, None, True),
    ("0970", "Sonstige Rückstellungen", L, None, True),
    ("0990", "Passive Rechnungsabgrenzung", L, None, True),
    ("1600", "Verbindlichkeiten aus Lieferungen und Leistungen", L, None, True),
    ("1700", "Sonstige Verbindlichkeiten", L, None, True),
    ("1710", "Erhaltene Anzahlungen", L, None, True),
    ("1720", "Wareneingang ohne Rechnung", L, None, True),
    ("1740", "Verbindlichkeiten aus Lohn und Gehalt", L, None, True),
    ("1741", "Verbindlichkeiten aus Lohn- und Kirchensteuer", L, None, True),
    ("1742", "Verbindlichkeiten im Rahmen der sozialen Sicherheit", L, None, True),
    ("1770", "Umsatzsteuer", L, None, True),
    ("1771", "Umsatzsteuer 7 %", L, None, True),
    ("1776", "Umsatzsteuer 19 %", L, None, True),
    ("1787", "Umsatzsteuer nach § 13b UStG 19 %", L, None, True),
    ("1780", "Umsatzsteuer-Vorauszahlungen", L, None, True),
    ("1790", "Umsatzsteuer Vorjahr", L, None, True),
    # Erlöse / Erträge
    ("8100", "Steuerfreie Umsätze § 4 Nr. 8 ff. UStG", I, None, True),
    ("8125", "Steuerfreie innergemeinschaftliche Lieferungen", I, None, True),
    ("8195", "Erlöse als Kleinunternehmer i.S.d. § 19 Abs. 1 UStG", I, None, True),
    ("8200", "Erlöse", I, None, True),
    ("8300", "Erlöse 7 % USt", I, None, True),
    ("8400", "Erlöse 19 % USt", I, None, True),
    ("8337", "Erlöse aus Leistungen nach § 13b UStG", I, None, True),
    ("8736", "Gewährte Skonti 19 % USt", I, None, True),
    ("8800", "Erlöse aus Anlagenverkäufen", I, None, True),
    ("8960", "Bestandsveränderungen unfertige Erzeugnisse", I, None, True),
    ("2650", "Sonstige Zinsen und ähnliche Erträge", I, None, True),
    ("2700", "Sonstige Erträge", I, None, True),
    ("2660", "Erträge aus Kursdifferenzen", I, None, True),
    # Aufwand
    ("2100", "Zinsen und ähnliche Aufwendungen", X, None, True),
    ("2150", "Aufwendungen aus Kursdifferenzen", X, None, True),
    ("2200", "Körperschaftsteuer", X, None, True),
    ("3100", "Fremdleistungen", X, None, True),
    ("3300", "Wareneingang 7 % Vorsteuer", X, None, True),
    ("3400", "Wareneingang 19 % Vorsteuer", X, None, True),
    ("3736", "Erhaltene Skonti 19 % Vorsteuer", X, None, True),
    ("4100", "Löhne und Gehälter", X, None, True),
    ("4110", "Löhne", X, None, True),
    ("4120", "Gehälter", X, None, True),
    ("4130", "Gesetzliche soziale Aufwendungen", X, None, True),
    ("4210", "Miete", X, None, True),
    ("4240", "Gas, Strom, Wasser", X, None, True),
    ("4320", "Gewerbesteuer", X, None, True),
    ("4360", "Versicherungen", X, None, True),
    ("4380", "Beiträge", X, None, True),
    ("4530", "Laufende Kfz-Betriebskosten", X, None, True),
    ("4600", "Werbekosten", X, None, True),
    ("4650", "Bewirtungskosten", X, None, True),
    ("4660", "Reisekosten Arbeitnehmer", X, None, True),
    ("4800", "Reparaturen und Instandhaltung", X, None, True),
    ("4806", "Wartungskosten für Hard- und Software", X, None, True),
    ("4822", "Abschreibungen auf immaterielle Vermögensgegenstände", X, None, True),
    ("4830", "Abschreibungen auf Sachanlagen", X, None, True),
    ("4855", "Sofortabschreibung GWG", X, None, True),
    ("4900", "Sonstige betriebliche Aufwendungen", X, None, True),
    ("4910", "Porto", X, None, True),
    ("4920", "Telefon", X, None, True),
    ("4930", "Bürobedarf", X, None, True),
    ("4950", "Rechts- und Beratungskosten", X, None, True),
    ("4955", "Buchführungskosten", X, None, True),
    ("4970", "Nebenkosten des Geldverkehrs", X, None, True),
    ("4985", "Werkzeuge und Kleingeräte", X, None, True),
]

DE_SKR04: list[tuple[str, str, str, str | None, bool]] = [
    # Anlagevermögen
    ("0135", "EDV-Software", A, None, True),
    ("0400", "Technische Anlagen und Maschinen", A, None, True),
    ("0520", "Pkw", A, None, True),
    ("0540", "Lkw", A, None, True),
    ("0650", "Büroeinrichtung", A, None, True),
    ("0670", "Geringwertige Wirtschaftsgüter", A, None, True),
    ("0690", "Sonstige Betriebs- und Geschäftsausstattung", A, None, True),
    # Umlaufvermögen
    ("1080", "Unfertige Leistungen (Bestand)", A, None, True),
    ("1140", "Bestand Waren", A, None, True),
    ("1200", "Forderungen aus Lieferungen und Leistungen", A, None, True),
    ("1300", "Sonstige Vermögensgegenstände", A, None, True),
    ("1370", "Durchlaufende Posten", A, None, True),
    ("1400", "Abziehbare Vorsteuer", A, None, True),
    ("1401", "Abziehbare Vorsteuer 7 %", A, None, True),
    ("1406", "Abziehbare Vorsteuer 19 %", A, None, True),
    ("1407", "Vorsteuer nach § 13b UStG 19 %", A, None, True),
    ("1433", "Bezahlte Einfuhrumsatzsteuer", A, None, True),
    ("1460", "Geldtransit", A, None, True),
    ("1600", "Kasse", A, None, True),
    ("1800", "Bank", A, None, True),
    ("1900", "Aktive Rechnungsabgrenzung", A, None, True),
    # Eigenkapital
    ("2100", "Privatentnahmen allgemein", E, None, True),
    ("2180", "Privateinlagen", E, None, True),
    ("2900", "Gezeichnetes Kapital", E, None, True),
    ("2920", "Kapitalrücklage", E, None, True),
    ("2970", "Gewinnvortrag vor Verwendung", E, None, True),
    ("2978", "Verlustvortrag vor Verwendung", E, None, True),
    # Verbindlichkeiten / Rückstellungen
    ("3040", "Steuerrückstellungen", L, None, True),
    ("3070", "Sonstige Rückstellungen", L, None, True),
    ("3150", "Verbindlichkeiten gegenüber Kreditinstituten", L, None, True),
    ("3250", "Erhaltene Anzahlungen", L, None, True),
    ("3300", "Verbindlichkeiten aus Lieferungen und Leistungen", L, None, True),
    ("3500", "Sonstige Verbindlichkeiten", L, None, True),
    ("3720", "Verbindlichkeiten aus Lohn und Gehalt", L, None, True),
    ("3730", "Verbindlichkeiten aus Lohn- und Kirchensteuer", L, None, True),
    ("3740", "Verbindlichkeiten im Rahmen der sozialen Sicherheit", L, None, True),
    ("3800", "Umsatzsteuer", L, None, True),
    ("3801", "Umsatzsteuer 7 %", L, None, True),
    ("3806", "Umsatzsteuer 19 %", L, None, True),
    ("3820", "Umsatzsteuer-Vorauszahlungen", L, None, True),
    ("3837", "Umsatzsteuer nach § 13b UStG 19 %", L, None, True),
    ("3840", "Umsatzsteuer Vorjahr", L, None, True),
    ("3900", "Passive Rechnungsabgrenzung", L, None, True),
    # Erlöse / Erträge
    ("4100", "Steuerfreie Umsätze § 4 Nr. 8 ff. UStG", I, None, True),
    ("4125", "Steuerfreie innergemeinschaftliche Lieferungen", I, None, True),
    ("4185", "Erlöse als Kleinunternehmer i.S.d. § 19 Abs. 1 UStG", I, None, True),
    ("4200", "Erlöse", I, None, True),
    ("4300", "Erlöse 7 % USt", I, None, True),
    ("4337", "Erlöse aus Leistungen nach § 13b UStG", I, None, True),
    ("4400", "Erlöse 19 % USt", I, None, True),
    ("4736", "Gewährte Skonti 19 % USt", I, None, True),
    ("4830", "Sonstige betriebliche Erträge", I, None, True),
    ("4840", "Erträge aus Kursdifferenzen", I, None, True),
    ("7100", "Sonstige Zinsen und ähnliche Erträge", I, None, True),
    # Aufwand
    ("5300", "Wareneingang 7 % Vorsteuer", X, None, True),
    ("5400", "Wareneingang 19 % Vorsteuer", X, None, True),
    ("5736", "Erhaltene Skonti 19 % Vorsteuer", X, None, True),
    ("5900", "Fremdleistungen", X, None, True),
    ("6000", "Löhne und Gehälter", X, None, True),
    ("6010", "Löhne", X, None, True),
    ("6020", "Gehälter", X, None, True),
    ("6110", "Gesetzliche soziale Aufwendungen", X, None, True),
    ("6200", "Abschreibungen auf immaterielle Vermögensgegenstände", X, None, True),
    ("6220", "Abschreibungen auf Sachanlagen", X, None, True),
    ("6260", "Sofortabschreibung GWG", X, None, True),
    ("6300", "Sonstige betriebliche Aufwendungen", X, None, True),
    ("6310", "Miete", X, None, True),
    ("6325", "Gas, Strom, Wasser", X, None, True),
    ("6400", "Versicherungen", X, None, True),
    ("6420", "Beiträge", X, None, True),
    ("6495", "Wartungskosten für Hard- und Software", X, None, True),
    ("6530", "Laufende Kfz-Betriebskosten", X, None, True),
    ("6600", "Werbekosten", X, None, True),
    ("6640", "Bewirtungskosten", X, None, True),
    ("6650", "Reisekosten Arbeitnehmer", X, None, True),
    ("6800", "Porto", X, None, True),
    ("6805", "Telefon", X, None, True),
    ("6815", "Bürobedarf", X, None, True),
    ("6825", "Rechts- und Beratungskosten", X, None, True),
    ("6830", "Buchführungskosten", X, None, True),
    ("6845", "Werkzeuge und Kleingeräte", X, None, True),
    ("6855", "Nebenkosten des Geldverkehrs", X, None, True),
    ("6880", "Aufwendungen aus Kursdifferenzen", X, None, True),
    ("7300", "Zinsen und ähnliche Aufwendungen", X, None, True),
    ("7600", "Körperschaftsteuer", X, None, True),
    ("7610", "Gewerbesteuer", X, None, True),
]

AT_EKR: list[tuple[str, str, str, str | None, bool]] = [
    # Klasse 0 Anlagevermögen
    ("0400", "Maschinen und maschinelle Anlagen", A, None, True),
    ("0600", "Betriebs- und Geschäftsausstattung", A, None, True),
    ("0630", "PKW", A, None, True),
    ("0640", "LKW", A, None, True),
    # Klasse 1 Vorräte
    ("1600", "Handelswarenvorrat", A, None, True),
    # Klasse 2 Sonstiges Umlaufvermögen
    ("2000", "Lieferforderungen", A, None, True),
    ("2300", "Sonstige Forderungen", A, None, True),
    ("2500", "Vorsteuer", A, None, True),
    ("2700", "Kassa", A, None, True),
    ("2800", "Bank", A, None, True),
    # Klasse 3 Verbindlichkeiten
    ("3100", "Verbindlichkeiten gegenüber Kreditinstituten", L, None, True),
    ("3300", "Lieferverbindlichkeiten", L, None, True),
    ("3500", "Umsatzsteuer", L, None, True),
    ("3700", "Sonstige Verbindlichkeiten", L, None, True),
    # Klasse 4 Betriebliche Erträge
    ("4000", "Umsatzerlöse", I, None, True),
    ("4800", "Übrige betriebliche Erträge", I, None, True),
    # Klasse 5 Material- und Warenaufwand
    ("5000", "Wareneinsatz", X, None, True),
    # Klasse 6 Personalaufwand
    ("6000", "Löhne", X, None, True),
    ("6200", "Gehälter", X, None, True),
    # Klasse 7 Abschreibungen und sonstige betriebliche Aufwendungen
    ("7000", "Abschreibungen auf Sachanlagen", X, None, True),
    ("7400", "Miet- und Pachtaufwand", X, None, True),
    ("7600", "Büromaterial und Verwaltungsaufwand", X, None, True),
    ("7650", "Werbeaufwand", X, None, True),
    ("7700", "Versicherungen", X, None, True),
    ("7790", "Spesen des Geldverkehrs", X, None, True),
    ("7800", "Übrige betriebliche Aufwendungen", X, None, True),
    # Klasse 8 Finanzergebnis
    ("8300", "Zinsen und ähnliche Aufwendungen", X, None, True),
    # Klasse 9 Eigenkapital
    ("9000", "Kapital", E, None, True),
]

CH_KMU: list[tuple[str, str, str, str | None, bool]] = [
    # 1 Aktiven
    ("1000", "Kasse", A, None, True),
    ("1020", "Bank", A, None, True),
    ("1100", "Forderungen aus Lieferungen und Leistungen (Debitoren)", A, None, True),
    ("1170", "Vorsteuer MWST Material, Waren, Dienstleistungen, Energie", A, None, True),
    ("1171", "Vorsteuer MWST Investitionen, übriger Betriebsaufwand", A, None, True),
    ("1200", "Handelswaren", A, None, True),
    ("1300", "Aktive Rechnungsabgrenzungen", A, None, True),
    ("1500", "Maschinen und Apparate", A, None, True),
    ("1510", "Mobiliar und Einrichtungen", A, None, True),
    ("1530", "Fahrzeuge", A, None, True),
    # 2 Passiven
    ("2000", "Verbindlichkeiten aus Lieferungen und Leistungen (Kreditoren)", L, None, True),
    ("2100", "Bankverbindlichkeiten", L, None, True),
    ("2200", "Geschuldete MWST (Umsatzsteuer)", L, None, True),
    ("2210", "Sonstige kurzfristige Verbindlichkeiten", L, None, True),
    ("2300", "Passive Rechnungsabgrenzungen", L, None, True),
    ("2800", "Aktien-, Stamm- oder Gesellschaftskapital", E, None, True),
    ("2970", "Gewinnvortrag oder Verlustvortrag", E, None, True),
    # 3 Betrieblicher Ertrag
    ("3200", "Handelserlöse", I, None, True),
    ("3400", "Dienstleistungserlöse", I, None, True),
    # 4 Aufwand für Material, Handelswaren, Dienstleistungen
    ("4200", "Handelswarenaufwand", X, None, True),
    ("4400", "Aufwand für bezogene Dienstleistungen", X, None, True),
    # 5 Personalaufwand
    ("5000", "Lohnaufwand", X, None, True),
    ("5700", "Sozialversicherungsaufwand", X, None, True),
    # 6 Übriger betrieblicher Aufwand, Abschreibungen, Finanzergebnis
    ("6000", "Raumaufwand", X, None, True),
    ("6300", "Sachversicherungen, Abgaben, Gebühren", X, None, True),
    ("6500", "Verwaltungsaufwand", X, None, True),
    ("6600", "Werbeaufwand", X, None, True),
    ("6700", "Sonstiger betrieblicher Aufwand", X, None, True),
    ("6800", "Abschreibungen", X, None, True),
    ("6900", "Finanzaufwand", X, None, True),
    ("6940", "Bankspesen", X, None, True),
    ("6950", "Finanzertrag", I, None, True),
]

# Sales accounts by VAT rate: rate -> (revenue, output VAT). Other rates post to the 'revenue'/'vat' roles.
SALES_RATE_ACCOUNTS: dict[str, dict[Decimal, tuple[str, str]]] = {
    "de_skr03": {Decimal(19): ("8400", "1776"), Decimal(7): ("8300", "1771")},
    "de_skr04": {Decimal(19): ("4400", "3806"), Decimal(7): ("4300", "3801")},
}
# Purchase accounts by VAT rate: rate -> (expense, input VAT); expense applies to bills without a goods receipt.
PURCHASE_RATE_ACCOUNTS: dict[str, dict[Decimal, tuple[str, str]]] = {
    "de_skr03": {Decimal(19): ("3400", "1576"), Decimal(7): ("3300", "1571")},
    "de_skr04": {Decimal(19): ("5400", "1406"), Decimal(7): ("5300", "1401")},
}
# 0 % revenue by the invoice's tax treatment (see zero_rate_kind).
ZERO_RATE_REVENUE: dict[str, dict[str, str]] = {
    "de_skr03": {"reverse_charge": "8337", "intra_eu": "8125", "small_business": "8195", "exempt": "8100"},
    "de_skr04": {"reverse_charge": "4337", "intra_eu": "4125", "small_business": "4185", "exempt": "4100"},
}

_REVERSE = ("reverse charge", "13b", "steuerschuldnerschaft", "autoliquidation", "inversione contabile",
            "inversión del sujeto pasivo", "verlegd", "odwrotne obciążenie")  # fmt: skip
_SMALL_BUSINESS = ("19 ustg", "19 abs. 1 ustg", "kleinunternehmer")
_INTRA_EU = ("innergemeinschaftlich", "intra-community", "intra-eu", "intracommunautaire",
             "intracomunitari", "4 nr. 1 b", "4 nr. 1b", "art. 138")  # fmt: skip


def zero_rate_kind(tax_note: str) -> str:
    """Classify a 0 % invoice from its tax note: reverse_charge, intra_eu, small_business or exempt."""
    note = " ".join((tax_note or "").lower().replace("§", " ").split())
    if any(k in note for k in _REVERSE):
        return "reverse_charge"
    if any(k in note for k in _INTRA_EU):
        return "intra_eu"
    if any(k in note for k in _SMALL_BUSINESS):
        return "small_business"
    return "exempt"


TEMPLATES: dict[str, list[tuple[str, str, str, str | None, bool]]] = {
    "ifrs_generic": IFRS_GENERIC,
    "de_skr03": DE_SKR03,
    "de_skr04": DE_SKR04,
    "at_ekr": AT_EKR,
    "ch_kmu": CH_KMU,
}
