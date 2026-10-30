"""Data import service: upload -> map -> validate (dry run) -> commit (one transaction) -> undo."""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.contacts.models import Contact
from app.modules.data_import import parsing
from app.modules.data_import.models import ImportJob, ImportPreset, ImportRecord
from app.modules.data_import.targets import BUILTIN_PRESETS, TARGETS, RowResult, fields_of, synonyms_of
from app.modules.gl.models import GLAccount, GLJournalEntry
from app.modules.gl.service import GLError, GLService, LineInput
from app.modules.items.models import ITEM_TYPES, Item
from app.modules.items.service import ItemsError, ItemsService
from app.modules.sales.models import SalesDocument

ZERO = Decimal(0)
CENT = Decimal("0.01")
SOURCE = "data_import"
NS = "data_import"  # custom_properties bucket on contacts
PARTY_TYPE = {"customers": "customer", "suppliers": "supplier"}
ITEM_TYPE_WORDS = {
    "service": ("service", "services", "dienstleistung", "leistung", "prestation", "услуга", "работа"),
    "consumable": ("consumable", "verbrauchsmaterial", "consommable", "расходник", "расходный материал"),
    "goods": ("goods", "product", "produkt", "ware", "artikel", "article", "товар", "storable", "stock"),
}


class ImportError_(Exception):
    pass


class ImportNotFound(ImportError_):
    pass


class ImportInvalid(ImportError_):
    pass


def _purchasing():
    try:
        from app.modules.purchasing.models import PurchasingBill

        return PurchasingBill
    except ImportError:  # module not installed
        return None


def targets_available() -> list[str]:
    return [t for t in TARGETS if t != "open_bills" or _purchasing() is not None]


def _num(c: Contact) -> str:
    return str(((c.custom_properties or {}).get(NS) or {}).get("number") or "")


class DataImportService:
    def __init__(self, session: AsyncSession, tenant_id: str) -> None:
        self.session = session
        self.tenant_id = tenant_id

    # ── Jobs ──────────────────────────────────────────────────────────────
    async def create_job(self, target: str, filename: str, raw: bytes, created_by: str | None = None) -> ImportJob:
        if target not in targets_available():
            raise ImportInvalid(f"Unknown import target {target}")
        try:
            table = parsing.parse_file(filename, raw)
        except Exception as exc:  # malformed workbook / binary garbage
            raise ImportInvalid(f"Could not read the file: {exc}") from exc
        if not table.headers:
            raise ImportInvalid("The file has no header row")
        scored = self.suggest_mapping_scored(target, table.headers)
        job = ImportJob(
            tenant_id=self.tenant_id,
            target=target,
            filename=filename[:255],
            status="uploaded",
            encoding=table.encoding,
            delimiter=table.delimiter,
            headers=table.headers,
            rows=table.rows,
            mapping={h: f for h, (f, _c) in scored.items()},
            options={},
            summary={
                "warnings": table.warnings,
                "header_row": table.header_row,
                "confidence": {h: c for h, (_f, c) in scored.items()},
            },
            row_count=len(table.rows),
            created_by=created_by,
        )
        self.session.add(job)
        await self.session.flush()
        return job

    @staticmethod
    def suggest_mapping(target: str, headers: list[str]) -> dict[str, str]:
        return {h: f for h, (f, _c) in DataImportService.suggest_mapping_scored(target, headers).items()}

    @staticmethod
    def suggest_mapping_scored(target: str, headers: list[str]) -> dict[str, tuple[str, float]]:
        syn = synonyms_of(target)
        for preset in BUILTIN_PRESETS.get(target, {}).values():
            for header, f in preset.items():
                syn.setdefault(f, []).append(header)
        return parsing.auto_map_scored(headers, syn)

    async def get_job(self, job_id: uuid.UUID) -> ImportJob:
        job = await self.session.get(ImportJob, job_id)
        if job is None or job.tenant_id != self.tenant_id:
            raise ImportNotFound("Import not found")
        return job

    async def list_jobs(self, limit: int = 50) -> list[ImportJob]:
        q = (
            select(ImportJob)
            .where(ImportJob.tenant_id == self.tenant_id)
            .order_by(ImportJob.created_at.desc())
            .limit(limit)
        )
        return list((await self.session.execute(q)).scalars())

    # ── Presets ───────────────────────────────────────────────────────────
    async def list_presets(self, target: str) -> list[dict[str, Any]]:
        out = [
            {"id": None, "name": n, "mapping": m, "builtin": True} for n, m in BUILTIN_PRESETS.get(target, {}).items()
        ]
        q = select(ImportPreset).where(ImportPreset.tenant_id == self.tenant_id, ImportPreset.target == target)
        for p in (await self.session.execute(q.order_by(ImportPreset.name))).scalars():
            out.append({"id": str(p.id), "name": p.name, "mapping": p.mapping, "builtin": False})
        return out

    async def save_preset(self, target: str, name: str, mapping: dict[str, str]) -> ImportPreset:
        self._check_mapping(target, mapping)
        q = select(ImportPreset).where(
            ImportPreset.tenant_id == self.tenant_id, ImportPreset.target == target, ImportPreset.name == name
        )
        p = (await self.session.execute(q)).scalar_one_or_none()
        if p is None:
            p = ImportPreset(tenant_id=self.tenant_id, target=target, name=name, mapping=mapping)
            self.session.add(p)
        else:
            p.mapping = mapping
        await self.session.flush()
        return p

    async def delete_preset(self, preset_id: uuid.UUID) -> None:
        p = await self.session.get(ImportPreset, preset_id)
        if p is None or p.tenant_id != self.tenant_id:
            raise ImportNotFound("Preset not found")
        await self.session.delete(p)
        await self.session.flush()

    # ── Validation ────────────────────────────────────────────────────────
    @staticmethod
    def _check_mapping(target: str, mapping: dict[str, str]) -> None:
        keys = {f.key for f in fields_of(target)}
        bad = [v for v in mapping.values() if v and v not in keys]
        if bad:
            raise ImportInvalid(f"Unknown target field(s): {', '.join(bad)}")

    def _convert(self, job: ImportJob, mapping: dict[str, str]) -> list[RowResult]:
        specs = {f.key: f for f in fields_of(job.target)}
        idx = {h: i for i, h in enumerate(job.headers)}
        cols = [(idx[h], f) for h, f in mapping.items() if f and h in idx]
        mapped = {f for _i, f in cols}
        out: list[RowResult] = []
        for n, row in enumerate(job.rows, start=job_header_offset(job)):
            rr = RowResult(row_no=n, values={})
            for i, f in cols:
                raw = (row[i] if i < len(row) else "").strip()
                if not raw:
                    continue
                spec = specs[f]
                try:
                    rr.values[f] = _coerce(spec.kind, raw)
                except ValueError:
                    rr.errors.append(f"{spec.label}: invalid {_KIND_LABEL[spec.kind]} '{raw}'")
            for spec in specs.values():
                if spec.required and spec.key not in rr.values and not any(spec.label in e for e in rr.errors):
                    rr.errors.append(f"{spec.label}: required" + ("" if spec.key in mapped else " (column not mapped)"))
            out.append(rr)
        return out

    async def validate(self, job_id: uuid.UUID, mapping: dict[str, str], options: dict | None = None) -> dict[str, Any]:
        job = await self.get_job(job_id)
        self._check_mapping(job.target, mapping)
        job.mapping, job.options = mapping, options or {}
        rows = self._convert(job, mapping)
        plan_errors = await getattr(self, f"_plan_{job.target}")(rows, job.options)
        summary = _summary(rows, plan_errors)
        job.summary = {**(job.summary or {}), **summary}
        if job.status in ("uploaded", "validated"):
            job.status = "validated"
        await self.session.flush()
        return {
            "summary": job.summary,
            "errors": _errors(rows) + [{"row": 0, "message": m} for m in plan_errors],
            "rows": [{"row": r.row_no, "action": r.action} for r in rows[: parsing.PREVIEW_ROWS]],
        }

    # Each planner sets row.action (create/update/skip/error) and returns file-level errors.
    async def _contacts_index(self) -> list[Contact]:
        q = select(Contact).where(Contact.tenant_id == self.tenant_id)
        return list((await self.session.execute(q)).scalars())

    async def _plan_party(self, rows: list[RowResult], ctype: str, options: dict | None = None) -> list[str]:
        skip_existing = (options or {}).get("existing") == "skip"
        existing = await self._contacts_index()
        by: dict[str, Contact] = {}
        for c in existing:
            if _num(c):
                by[f"n:{_num(c)}"] = c
            if c.primary_email:
                by.setdefault(f"e:{c.primary_email.lower()}", c)
            if c.vat_number:
                by.setdefault(f"v:{parsing.normalize_vat(c.vat_number)}", c)
        seen: set[str] = set()
        for r in rows:
            if r.errors:
                r.action = "error"
                continue
            keys = _party_keys(r.values)
            if keys & seen:
                r.action = "skip"
                r.errors.append("Duplicate of an earlier row in this file")
                continue
            seen |= keys
            hit = next((by[k] for k in keys if k in by), None)
            r.values["_match"] = hit
            r.values["_type"] = ctype
            r.action = ("skip" if skip_existing else "update") if hit else "create"
        return []

    async def _plan_customers(self, rows: list[RowResult], o: dict) -> list[str]:
        return await self._plan_party(rows, "customer", o)

    async def _plan_suppliers(self, rows: list[RowResult], o: dict) -> list[str]:
        return await self._plan_party(rows, "supplier", o)

    async def _plan_items(self, rows: list[RowResult], o: dict) -> list[str]:
        q = select(Item.sku, Item.id).where(Item.tenant_id == self.tenant_id)
        skus = {s: i for s, i in (await self.session.execute(q)).all()}
        seen: set[str] = set()
        for r in rows:
            v = r.values
            if "item_type" in v:
                t = _item_type(v["item_type"])
                if t is None:
                    r.errors.append(f"Type: use one of {', '.join(ITEM_TYPES)}")
                else:
                    v["item_type"] = t
            if r.errors:
                r.action = "error"
                continue
            if v["sku"] in seen:
                r.action = "skip"
                r.errors.append("Duplicate SKU in this file")
                continue
            seen.add(v["sku"])
            r.values["_match"] = skus.get(v["sku"])
            if v["sku"] in skus:
                r.action = "skip" if o.get("existing") == "skip" else "update"
            else:
                r.action = "create"
        return []

    async def _plan_opening_balances(self, rows: list[RowResult], options: dict) -> list[str]:
        q = select(GLAccount).where(GLAccount.tenant_id == self.tenant_id)
        accounts = {a.code: a for a in (await self.session.execute(q)).scalars()}
        debit = credit = ZERO
        first: dict[str, RowResult] = {}
        for r in rows:
            v = r.values
            amt = v.get("debit", ZERO) - v.get("credit", ZERO) if ("debit" in v or "credit" in v) else v.get("balance")
            if amt is None and not r.errors:
                r.errors.append("Debit/Credit or Balance: required")
            code = str(v.get("account_code", "")).strip()
            acc = accounts.get(code)
            if code and acc is None:
                r.errors.append(f"Account {code} does not exist in the chart of accounts")
            elif acc is not None and not acc.is_postable:
                r.errors.append(f"Account {code} is a header account and cannot be posted")
            if r.errors:
                r.action = "error"
                continue
            amt = amt.quantize(CENT)
            if amt == 0:
                r.action = "skip"
                continue
            debit += max(amt, ZERO)
            credit += max(-amt, ZERO)
            if code in first:  # same account twice -> merged into one line
                first[code].values["_amount"] += amt
                r.action = "skip"
                continue
            v["_amount"], v["_account_id"] = amt, acc.id  # type: ignore[union-attr]
            first[code] = r
            r.action = "create"
        errs: list[str] = []
        if debit != credit:
            errs.append(
                f"Opening balances are not balanced: debit {debit} vs credit {credit} (difference {debit - credit})"
            )
        if not first:
            errs.append("No non-zero balances found")
        prev = await self.session.scalar(
            select(GLJournalEntry.id).where(
                GLJournalEntry.tenant_id == self.tenant_id,
                GLJournalEntry.source_type == f"{SOURCE}:opening",
                GLJournalEntry.reversed_by_id.is_(None),
                GLJournalEntry.status == "posted",
            )
        )
        if prev is not None:
            errs.append("Opening balances were already imported; undo that import first")
        try:
            _opening_date(options)
        except ValueError:
            errs.append("Opening date is invalid")
        return errs

    async def _plan_docs(self, rows: list[RowResult], model: Any, kind: str, ctype: str) -> list[str]:
        q = select(model.number).where(model.tenant_id == self.tenant_id, model.kind == kind)
        existing = set((await self.session.execute(q)).scalars())
        contacts = await self._contacts_index()
        by_num = {_num(c): c for c in contacts if _num(c)}
        by_name = {(c.company_name or "").strip().lower(): c for c in contacts if c.company_name}
        seen: set[str] = set()
        for r in rows:
            v = r.values
            if r.errors:
                r.action = "error"
                continue
            v["number"] = str(v["number"])[:32]
            tax = v.get("tax_total", ZERO)
            v.setdefault("net_total", v["gross_total"] - tax)
            v["tax_total"] = tax
            paid = v.get("amount_paid", ZERO)
            if v["gross_total"] <= 0:
                r.errors.append("Gross amount must be positive")
            elif paid > v["gross_total"]:
                r.errors.append("Amount paid exceeds gross amount")
            if r.errors:
                r.action = "error"
                continue
            if v["number"] in existing or v["number"] in seen:
                r.action = "skip"
                continue
            seen.add(v["number"])
            if paid >= v["gross_total"]:
                r.action = "skip"  # fully paid: not an open item
                continue
            hit = by_num.get(str(v.get("party_number", ""))) or by_name.get(str(v["party_name"]).strip().lower())
            v["_party"] = hit.id if hit else None
            r.action = "create"
        return []

    async def _plan_open_invoices(self, rows: list[RowResult], _o: dict) -> list[str]:
        return await self._plan_docs(rows, SalesDocument, "invoice", "customer")

    async def _plan_open_bills(self, rows: list[RowResult], _o: dict) -> list[str]:
        model = _purchasing()
        if model is None:
            return ["Purchasing module is not installed"]
        return await self._plan_docs(rows, model, "bill", "supplier")

    # ── Commit ────────────────────────────────────────────────────────────
    async def commit(
        self, job_id: uuid.UUID, mapping: dict[str, str], options: dict | None = None, created_by: str | None = None
    ) -> dict[str, Any]:
        job = await self.get_job(job_id)
        if job.status in ("committed", "undone"):
            raise ImportInvalid(f"This import is already {job.status}")
        options = options or {}
        self._check_mapping(job.target, mapping)
        job.mapping, job.options = mapping, options
        rows = self._convert(job, mapping)
        file_errors = await getattr(self, f"_plan_{job.target}")(rows, options)
        if file_errors:
            raise ImportInvalid("; ".join(file_errors))
        bad = [r for r in rows if r.action == "error"]
        if bad and (job.target == "opening_balances" or not options.get("skip_invalid")):
            raise ImportInvalid(f"{len(bad)} row(s) have errors; fix them or choose to skip invalid rows")
        records: list[ImportRecord] = []
        try:
            async with self.session.begin_nested():
                writer = getattr(self, f"_write_{job.target}")
                await writer(job, rows, options, created_by, records)
                for rec in records:
                    self.session.add(rec)
                await self.session.flush()
        except (ItemsError, GLError, ImportInvalid) as exc:
            raise ImportInvalid(f"Import rolled back: {exc}") from exc
        summary = _summary(rows, [])
        job.summary = {**(job.summary or {}), **summary}
        job.status = "committed"
        await self.session.flush()
        return {"summary": job.summary, "job_id": str(job.id)}

    def _rec(self, job: ImportJob, entity: str, rid: uuid.UUID, action: str, row: int) -> ImportRecord:
        return ImportRecord(
            tenant_id=self.tenant_id, job_id=job.id, entity=entity, record_id=rid, action=action, row_no=row
        )

    async def _write_party(self, job, rows, _o, by, records) -> None:
        for r in rows:
            if r.action not in ("create", "update"):
                continue
            v = r.values
            c: Contact | None = v.get("_match")
            if c is None:
                c = Contact(
                    tenant_id=self.tenant_id,
                    created_by=by,
                    contact_type=v["_type"],
                    module_tags=[],
                    custom_properties={},
                    metadata_={},
                )
                self.session.add(c)
            c.company_name = v["name"]
            for src, dst in (
                ("email", "primary_email"),
                ("phone", "primary_phone"),
                ("website", "website"),
                ("currency_code", "currency_code"),
                ("notes", "notes"),
            ):
                if src in v:
                    setattr(c, dst, str(v[src]))
            if "vat_number" in v:
                c.vat_number = parsing.normalize_vat(v["vat_number"])
            if "country_code" in v:
                c.country_code = str(v["country_code"]).upper()[:2]
            if "payment_terms_days" in v:
                c.payment_terms_days = str(v["payment_terms_days"])
            addr = {k: v[k] for k in ("street", "postal_code", "city") if k in v}
            if addr:
                c.address = {**(c.address or {}), **addr}
            if "customer_number" in v:
                c.custom_properties = {**(c.custom_properties or {}), NS: {"number": str(v["customer_number"])}}
            await self.session.flush()
            records.append(self._rec(job, "contact", c.id, "created" if r.action == "create" else "updated", r.row_no))

    _write_customers = _write_party
    _write_suppliers = _write_party

    async def _write_items(self, job, rows, _o, by, records) -> None:
        svc = ItemsService(self.session, self.tenant_id)
        allowed = {
            "sku",
            "name",
            "description",
            "item_type",
            "uom",
            "sales_price",
            "purchase_cost",
            "currency",
            "tax_code",
            "barcode",
        }
        for r in rows:
            if r.action not in ("create", "update"):
                continue
            data = {k: v for k, v in r.values.items() if k in allowed}
            if "currency" in data:
                data["currency"] = str(data["currency"]).upper()[:3]
            if r.action == "create":
                item = await svc.create_item(created_by=by, **data)
                records.append(self._rec(job, "item", item.id, "created", r.row_no))
            else:
                item = await svc.update_item(r.values["_match"], **data)
                records.append(self._rec(job, "item", item.id, "updated", r.row_no))

    async def _write_opening_balances(self, job, rows, options, by, records) -> None:
        lines = [
            LineInput(
                r.values["_account_id"],
                debit=max(r.values["_amount"], ZERO),
                credit=max(-r.values["_amount"], ZERO),
                description="Opening balance",
            )
            for r in rows
            if r.action == "create"
        ]
        entry = await GLService(self.session, self.tenant_id).create_entry(
            entry_date=_opening_date(options),
            lines=lines,
            memo=f"Opening balances (import {job.filename})",
            source_type=f"{SOURCE}:opening",
            source_id=str(job.id),
            created_by=by,
            post=True,
        )
        records.append(self._rec(job, "gl_entry", entry.id, "created", 0))

    async def _write_docs(self, job, rows, by, records, model, kind: str, entity: str) -> None:
        for r in rows:
            if r.action != "create":
                continue
            v = r.values
            paid = v.get("amount_paid", ZERO)
            doc = model(
                tenant_id=self.tenant_id,
                kind=kind,
                number=v["number"],
                status=("partially_paid" if paid > 0 else ("issued" if kind == "invoice" else "posted")),
                currency=str(v.get("currency") or "EUR").upper()[:3],
                fx_rate=Decimal(1),
                doc_date=v["doc_date"],
                due_date=v.get("due_date"),
                net_total=v["net_total"],
                tax_total=v["tax_total"],
                gross_total=v["gross_total"],
                amount_paid=paid,
                notes="Opening balance (imported)",
                created_by=by,
            )
            if kind == "invoice":
                doc.customer_id, doc.customer_name = v["_party"], str(v["party_name"])[:255]
            else:
                doc.supplier_id, doc.supplier_name = v["_party"], str(v["party_name"])[:255]
            doc.lines, doc.payments = [], []
            self.session.add(doc)
            await self.session.flush()
            records.append(self._rec(job, entity, doc.id, "created", r.row_no))

    async def _write_open_invoices(self, job, rows, _o, by, records) -> None:
        await self._write_docs(job, rows, by, records, SalesDocument, "invoice", "sales_invoice")

    async def _write_open_bills(self, job, rows, _o, by, records) -> None:
        await self._write_docs(job, rows, by, records, _purchasing(), "bill", "purchase_bill")

    # ── Undo ──────────────────────────────────────────────────────────────
    async def undo(self, job_id: uuid.UUID, created_by: str | None = None) -> dict[str, int]:
        job = await self.get_job(job_id)
        if job.status != "committed":
            raise ImportInvalid("Only a committed import can be undone")
        q = select(ImportRecord).where(ImportRecord.job_id == job.id, ImportRecord.tenant_id == self.tenant_id)
        recs = list((await self.session.execute(q)).scalars())
        models = {"contact": Contact, "item": Item, "sales_invoice": SalesDocument, "purchase_bill": _purchasing()}
        removed = kept = 0
        async with self.session.begin_nested():
            for rec in recs:
                if rec.action != "created":
                    kept += 1
                    continue
                if rec.entity == "gl_entry":
                    await GLService(self.session, self.tenant_id).reverse_entry(
                        rec.record_id, memo="Undo opening balance import", created_by=created_by
                    )
                    removed += 1
                    continue
                model = models.get(rec.entity)
                obj = await self.session.get(model, rec.record_id) if model is not None else None
                if obj is not None and obj.tenant_id == self.tenant_id:
                    await self.session.delete(obj)
                    removed += 1
            await self.session.flush()
        job.status = "undone"
        job.summary = {**(job.summary or {}), "undone_removed": removed, "undone_kept_updates": kept}
        await self.session.flush()
        return {"removed": removed, "kept_updates": kept}


# ── helpers ───────────────────────────────────────────────────────────────
_KIND_LABEL = {
    "str": "text",
    "email": "e-mail address",
    "vat": "VAT ID",
    "decimal": "number",
    "date": "date",
    "int": "whole number",
    "bool": "yes/no",
}


def job_header_offset(job: ImportJob) -> int:
    return int((job.summary or {}).get("header_row", 0)) + 2  # 1-based file row of the first data row


def _coerce(kind: str, raw: str) -> Any:
    if kind == "decimal":
        return parsing.parse_decimal(raw)
    if kind == "date":
        return parsing.parse_date(raw)
    if kind == "int":
        d = parsing.parse_decimal(raw)
        if d != d.to_integral_value():
            raise ValueError(raw)
        return int(d)
    if kind == "email":
        if not parsing.EMAIL_RE.match(raw):
            raise ValueError(raw)
        return raw.lower()
    if kind == "vat":
        if not parsing.is_valid_vat(raw):
            raise ValueError(raw)
        return parsing.normalize_vat(raw)
    return raw


def _item_type(value: str) -> str | None:
    s = str(value).strip().lower()
    for t, words in ITEM_TYPE_WORDS.items():
        if s in words:
            return t
    return None


def _party_keys(v: dict) -> set[str]:
    keys = set()
    if v.get("customer_number"):
        keys.add(f"n:{v['customer_number']}")
    if v.get("email"):
        keys.add(f"e:{v['email'].lower()}")
    if v.get("vat_number"):
        keys.add(f"v:{v['vat_number']}")
    return keys


def _opening_date(options: dict) -> date:
    raw = options.get("opening_date")
    return parsing.parse_date(str(raw)) if raw else date(date.today().year, 1, 1)


def _summary(rows: list[RowResult], file_errors: list[str]) -> dict[str, Any]:
    counts = {"create": 0, "update": 0, "skip": 0, "error": 0}
    for r in rows:
        counts[r.action or "error"] = counts.get(r.action or "error", 0) + 1
    return {**counts, "total": len(rows), "file_errors": file_errors, "ok": not file_errors and not counts["error"]}


def _errors(rows: list[RowResult]) -> list[dict[str, Any]]:
    return [{"row": r.row_no, "message": e} for r in rows for e in r.errors]
