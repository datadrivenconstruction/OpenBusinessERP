"""Import targets: field definitions, multi-language header synonyms and built-in mapping presets.

Presets are our own generic column conventions for files people export from other tools.
Product names are used only to describe the source; trademarks belong to their owners and
there is no affiliation.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class FieldSpec:
    key: str
    label: str
    kind: str = "str"  # str | email | vat | decimal | date | int | bool
    required: bool = False
    synonyms: tuple[str, ...] = ()
    example: str = ""


_NAME = (
    "name",
    "company",
    "company name",
    "firma",
    "firmenname",
    "unternehmen",
    "organisation",
    "organization",
    "display name",
    "kunde",
    "lieferant",
    "raison sociale",
    "société",
    "nom",
    "наименование",
    "название",
    "компания",
    "организация",
    "контрагент",
    "kontakt",
    "contact name",
)
_NUMBER = (
    "customer number",
    "customer no",
    "customer id",
    "kundennummer",
    "kunden-nr",
    "kundennr",
    "kd-nr",
    "debitor",
    "debitorennummer",
    "numéro client",
    "code client",
    "номер клиента",
    "код клиента",
    "reference",
    "internal reference",
    "ref",
    "nummer",
    "number",
    "id",
)
_SUP_NUMBER = (
    "supplier number",
    "supplier no",
    "vendor number",
    "vendor id",
    "lieferantennummer",
    "lieferanten-nr",
    "kreditor",
    "kreditorennummer",
    "numéro fournisseur",
    "code fournisseur",
    "номер поставщика",
    "код поставщика",
    "reference",
    "ref",
    "nummer",
    "number",
    "id",
)
_PARTY = (
    FieldSpec("name", "Name", required=True, synonyms=_NAME, example="Muster GmbH"),
    FieldSpec(
        "email",
        "E-mail",
        "email",
        synonyms=(
            "email",
            "e-mail",
            "mail",
            "e-mail-adresse",
            "email address",
            "courriel",
            "adresse e-mail",
            "почта",
            "эл почта",
            "электронная почта",
        ),
        example="info@muster.de",
    ),
    FieldSpec(
        "vat_number",
        "VAT ID",
        "vat",
        synonyms=(
            "vat",
            "vat id",
            "vat number",
            "tax id",
            "ust-idnr",
            "ust-id",
            "ustidnr",
            "umsatzsteuer-id",
            "umsatzsteuer-identifikationsnummer",
            "steuernummer",
            "numéro de tva",
            "n° tva",
            "tva intracommunautaire",
            "инн",
            "налоговый номер",
            "ндс номер",
        ),
        example="DE123456789",
    ),
    FieldSpec(
        "phone",
        "Phone",
        synonyms=("phone", "telephone", "tel", "telefon", "telefonnummer", "mobile", "handy", "téléphone", "телефон"),
        example="+49 30 123456",
    ),
    FieldSpec("website", "Website", synonyms=("website", "web", "url", "homepage", "internet", "site web", "сайт")),
    FieldSpec(
        "street",
        "Street",
        synonyms=(
            "street",
            "address",
            "address line 1",
            "straße",
            "strasse",
            "anschrift",
            "adresse",
            "rue",
            "улица",
            "адрес",
        ),
    ),
    FieldSpec(
        "postal_code",
        "Postal code",
        synonyms=("zip", "postal code", "postcode", "plz", "postleitzahl", "code postal", "индекс", "почтовый индекс"),
    ),
    FieldSpec("city", "City", synonyms=("city", "town", "ort", "stadt", "ville", "город")),
    FieldSpec(
        "country_code",
        "Country (ISO-2)",
        synonyms=("country", "country code", "land", "länderkennzeichen", "pays", "страна"),
        example="DE",
    ),
    FieldSpec(
        "payment_terms_days",
        "Payment terms (days)",
        "int",
        synonyms=("payment terms", "zahlungsziel", "zahlungsbedingungen", "délai de paiement", "срок оплаты"),
    ),
    FieldSpec("currency_code", "Currency", synonyms=("currency", "währung", "devise", "валюта"), example="EUR"),
    FieldSpec(
        "notes",
        "Notes",
        synonyms=("notes", "note", "comment", "bemerkung", "notiz", "commentaire", "примечание", "комментарий"),
    ),
)

_DOC = (
    FieldSpec(
        "doc_date",
        "Document date",
        "date",
        True,
        (
            "date",
            "invoice date",
            "bill date",
            "rechnungsdatum",
            "belegdatum",
            "datum",
            "date de facture",
            "дата",
            "дата счета",
        ),
        "31.12.2025",
    ),
    FieldSpec(
        "due_date",
        "Due date",
        "date",
        synonyms=(
            "due date",
            "due",
            "fällig",
            "fälligkeit",
            "fälligkeitsdatum",
            "fällig am",
            "échéance",
            "date d'échéance",
            "срок оплаты",
            "дата оплаты",
        ),
        example="31.01.2026",
    ),
    FieldSpec(
        "net_total",
        "Net amount",
        "decimal",
        synonyms=("net", "net amount", "netto", "nettobetrag", "montant ht", "ht", "сумма без ндс"),
        example="1.000,00",
    ),
    FieldSpec(
        "tax_total",
        "Tax amount",
        "decimal",
        synonyms=("tax", "vat amount", "mwst", "ust", "steuer", "umsatzsteuer", "tva", "ндс"),
        example="190,00",
    ),
    FieldSpec(
        "gross_total",
        "Gross amount",
        "decimal",
        True,
        (
            "gross",
            "total",
            "amount",
            "brutto",
            "bruttobetrag",
            "betrag",
            "gesamtbetrag",
            "montant ttc",
            "ttc",
            "total ttc",
            "сумма",
            "итого",
        ),
        "1.190,00",
    ),
    FieldSpec(
        "amount_paid",
        "Amount paid",
        "decimal",
        synonyms=("paid", "amount paid", "bezahlt", "gezahlt", "payé", "montant payé", "оплачено"),
        example="0",
    ),
    FieldSpec("currency", "Currency", synonyms=("currency", "währung", "devise", "валюта"), example="EUR"),
)

TARGETS: dict[str, dict] = {
    "customers": {
        "label": "Customers",
        "fields": (FieldSpec("customer_number", "Customer number", synonyms=_NUMBER, example="10001"), *_PARTY),
    },
    "suppliers": {
        "label": "Suppliers",
        "fields": (FieldSpec("customer_number", "Supplier number", synonyms=_SUP_NUMBER, example="70001"), *_PARTY),
    },
    "items": {
        "label": "Products & services",
        "fields": (
            FieldSpec(
                "sku",
                "SKU",
                required=True,
                synonyms=(
                    "sku",
                    "item number",
                    "item no",
                    "article number",
                    "artikelnummer",
                    "artikel-nr",
                    "art-nr",
                    "produktnummer",
                    "internal reference",
                    "référence",
                    "code article",
                    "артикул",
                    "код товара",
                ),
                example="ART-001",
            ),
            FieldSpec(
                "name",
                "Name",
                required=True,
                synonyms=(
                    "name",
                    "item name",
                    "product",
                    "product name",
                    "bezeichnung",
                    "artikelbezeichnung",
                    "artikelname",
                    "produkt",
                    "désignation",
                    "libellé",
                    "наименование",
                    "название",
                    "товар",
                ),
                example="Schraube M8",
            ),
            FieldSpec("description", "Description", synonyms=("description", "beschreibung", "langtext", "описание")),
            FieldSpec(
                "item_type",
                "Type (goods/service/consumable)",
                synonyms=("type", "item type", "product type", "art", "typ", "тип"),
                example="goods",
            ),
            FieldSpec(
                "uom",
                "Unit",
                synonyms=("unit", "uom", "unit of measure", "einheit", "mengeneinheit", "unité", "ед изм", "единица"),
                example="pcs",
            ),
            FieldSpec(
                "sales_price",
                "Sales price",
                "decimal",
                synonyms=(
                    "price",
                    "sales price",
                    "sale price",
                    "unit price",
                    "verkaufspreis",
                    "vk",
                    "vk-preis",
                    "preis",
                    "einzelpreis",
                    "prix de vente",
                    "prix",
                    "цена",
                    "цена продажи",
                ),
                example="12,50",
            ),
            FieldSpec(
                "purchase_cost",
                "Purchase cost",
                "decimal",
                synonyms=(
                    "cost",
                    "purchase price",
                    "purchase cost",
                    "einkaufspreis",
                    "ek",
                    "ek-preis",
                    "prix d'achat",
                    "coût",
                    "закупочная цена",
                    "себестоимость",
                ),
                example="7,80",
            ),
            FieldSpec("currency", "Currency", synonyms=("currency", "währung", "devise", "валюта"), example="EUR"),
            FieldSpec(
                "tax_code",
                "Tax code",
                synonyms=("tax code", "tax", "steuerschlüssel", "steuersatz", "mwst-satz", "code tva", "ставка ндс"),
            ),
            FieldSpec(
                "barcode", "Barcode / EAN", synonyms=("barcode", "ean", "gtin", "ean-code", "code-barres", "штрихкод")
            ),
        ),
    },
    "opening_balances": {
        "label": "Opening balances",
        "fields": (
            FieldSpec(
                "account_code",
                "Account code",
                required=True,
                synonyms=(
                    "account",
                    "account code",
                    "account number",
                    "konto",
                    "kontonummer",
                    "sachkonto",
                    "compte",
                    "numéro de compte",
                    "счет",
                    "номер счета",
                ),
                example="1200",
            ),
            FieldSpec(
                "account_name",
                "Account name",
                synonyms=("account name", "kontobezeichnung", "bezeichnung", "libellé du compte", "наименование счета"),
            ),
            FieldSpec(
                "debit",
                "Debit",
                "decimal",
                synonyms=("debit", "soll", "debit balance", "saldo soll", "débit", "дебет"),
                example="10.000,00",
            ),
            FieldSpec(
                "credit",
                "Credit",
                "decimal",
                synonyms=("credit", "haben", "credit balance", "saldo haben", "crédit", "кредит"),
                example="0",
            ),
            FieldSpec(
                "balance",
                "Balance (+debit / -credit)",
                "decimal",
                synonyms=("balance", "saldo", "solde", "сальдо", "остаток"),
            ),
        ),
    },
    "open_invoices": {
        "label": "Open customer invoices",
        "fields": (
            FieldSpec(
                "number",
                "Invoice number",
                required=True,
                synonyms=(
                    "invoice number",
                    "invoice no",
                    "number",
                    "rechnungsnummer",
                    "rechnungs-nr",
                    "re-nr",
                    "belegnummer",
                    "numéro de facture",
                    "номер счета",
                    "номер",
                ),
                example="RE-2025-0101",
            ),
            FieldSpec(
                "party_name",
                "Customer name",
                required=True,
                synonyms=(
                    "customer",
                    "customer name",
                    "kunde",
                    "kundenname",
                    "firma",
                    "client",
                    "nom du client",
                    "клиент",
                    "покупатель",
                ),
                example="Muster GmbH",
            ),
            FieldSpec(
                "party_number",
                "Customer number",
                synonyms=("customer number", "kundennummer", "kunden-nr", "numéro client", "номер клиента"),
            ),
            *_DOC,
        ),
    },
    "open_bills": {
        "label": "Open supplier bills",
        "fields": (
            FieldSpec(
                "number",
                "Bill number",
                required=True,
                synonyms=(
                    "bill number",
                    "invoice number",
                    "number",
                    "rechnungsnummer",
                    "belegnummer",
                    "numéro de facture",
                    "номер счета",
                    "номер",
                ),
                example="ER-2025-0042",
            ),
            FieldSpec(
                "party_name",
                "Supplier name",
                required=True,
                synonyms=("supplier", "vendor", "supplier name", "lieferant", "kreditor", "fournisseur", "поставщик"),
                example="Lieferant AG",
            ),
            FieldSpec(
                "party_number",
                "Supplier number",
                synonyms=(
                    "supplier number",
                    "lieferantennummer",
                    "kreditorennummer",
                    "numéro fournisseur",
                    "номер поставщика",
                ),
            ),
            *_DOC,
        ),
    },
}

# Built-in presets: our own generic column conventions for typical exports (header label -> field).
BUILTIN_PRESETS: dict[str, dict[str, dict[str, str]]] = {
    "customers": {
        "Generic CSV": {},
        "Common ERP export (CSV)": {
            "Display Name": "name",
            "Email": "email",
            "Tax ID": "vat_number",
            "Phone": "phone",
            "Street": "street",
            "ZIP": "postal_code",
            "City": "city",
            "Country": "country_code",
            "Reference": "customer_number",
        },
        "lexoffice export": {
            "Kundennummer": "customer_number",
            "Firmenname": "name",
            "E-Mail": "email",
            "Umsatzsteuer-ID": "vat_number",
            "Telefon": "phone",
            "Straße": "street",
            "PLZ": "postal_code",
            "Ort": "city",
            "Land": "country_code",
        },
        "sevDesk export": {
            "Kunden-Nr.": "customer_number",
            "Organisation": "name",
            "E-Mail": "email",
            "USt-IdNr.": "vat_number",
            "Telefon": "phone",
            "Straße": "street",
            "PLZ": "postal_code",
            "Ort": "city",
            "Land": "country_code",
        },
    },
    "suppliers": {
        "Generic CSV": {},
        "Common ERP export (CSV)": {
            "Display Name": "name",
            "Email": "email",
            "Tax ID": "vat_number",
            "Phone": "phone",
            "Reference": "customer_number",
        },
        "lexoffice export": {
            "Lieferantennummer": "customer_number",
            "Firmenname": "name",
            "E-Mail": "email",
            "Umsatzsteuer-ID": "vat_number",
        },
        "sevDesk export": {
            "Lieferanten-Nr.": "customer_number",
            "Organisation": "name",
            "E-Mail": "email",
            "USt-IdNr.": "vat_number",
        },
    },
    "items": {
        "Generic CSV": {},
        "Common ERP export (CSV)": {
            "Internal Reference": "sku",
            "Name": "name",
            "Sales Price": "sales_price",
            "Cost": "purchase_cost",
            "Barcode": "barcode",
        },
        "lexoffice export": {
            "Artikelnummer": "sku",
            "Bezeichnung": "name",
            "Netto-Verkaufspreis": "sales_price",
            "Einheit": "uom",
        },
        "sevDesk export": {
            "Artikel-Nr.": "sku",
            "Name": "name",
            "Verkaufspreis": "sales_price",
            "Einkaufspreis": "purchase_cost",
            "Einheit": "uom",
        },
    },
    "opening_balances": {"Generic CSV": {}},
    "open_invoices": {"Generic CSV": {}},
    "open_bills": {"Generic CSV": {}},
}


def fields_of(target: str) -> tuple[FieldSpec, ...]:
    return TARGETS[target]["fields"]


def synonyms_of(target: str) -> dict[str, list[str]]:
    return {f.key: [f.label, *f.synonyms] for f in fields_of(target)}


def template_csv(target: str) -> str:
    fs = fields_of(target)
    head = ";".join(f.label for f in fs)
    row = ";".join(f.example for f in fs)
    return f"{head}\r\n{row}\r\n"


@dataclass
class RowResult:
    row_no: int
    values: dict
    errors: list[str] = field(default_factory=list)
    action: str = ""
