"""Print and email sales documents; every send is an explicit user action and is logged."""

from __future__ import annotations

import html
import re
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.business_settings import read_business_settings
from app.core.company_profile import read_company_profile
from app.core.demo_accounts import is_demo_account, is_non_mailbox_login
from app.core.email.base import EmailAttachment, EmailMessage
from app.core.email.service import EmailService
from app.core.mail_settings import mail_status
from app.modules.sales.documents.checks import check_invoice
from app.modules.sales.documents.i18n import fmt_date, fmt_money, lang, t
from app.modules.sales.documents.pdf import render_document
from app.modules.sales.models import SalesDocument, SalesSendLog

_EMAIL = re.compile(r"^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$")


class SendRefusedError(ValueError):
    pass


def company_data() -> dict[str, Any]:
    """Business settings, with letterhead name/address/logo falling back to the company profile."""
    data = read_business_settings()
    profile = read_company_profile()
    if not data.get("company_name"):
        data["company_name"] = profile.get("legal_name", "")
    if not data.get("address"):
        data["address"] = profile.get("address", "")
    if not data.get("logo_data_url"):
        data["logo_data_url"] = profile.get("document_logo_data_url", "")
    for key in ("email", "phone", "website"):
        if not data.get(key):
            data[key] = profile.get(key, "")
    return data


def filename(doc: SalesDocument) -> str:
    return f"{doc.kind}-{re.sub(r'[^A-Za-z0-9._-]', '_', doc.number)}.pdf"


async def _source_number(session: AsyncSession, doc: SalesDocument) -> str | None:
    if doc.kind != "credit_note" or not doc.source_id:
        return None
    src = await session.get(SalesDocument, doc.source_id)
    return src.number if src is not None and src.tenant_id == doc.tenant_id else None


async def render_pdf(session: AsyncSession, doc: SalesDocument, company: dict[str, Any] | None = None) -> bytes:
    return render_document(doc, company or company_data(), source_number=await _source_number(session, doc))


def placeholders(doc: SalesDocument, company: dict[str, Any]) -> dict[str, str]:
    lg = lang(doc.language)
    values = {
        "customer_name": doc.customer_name,
        "document_title": t(lg, doc.kind),
        "document_number": doc.number,
        "document_date": fmt_date(doc.doc_date, lg),
        "due_date": fmt_date(doc.due_date, lg),
        "total": fmt_money(doc.gross_total, doc.currency, lg),
        "balance_due": fmt_money(doc.balance_due, doc.currency, lg),
        "company_name": company.get("company_name", ""),
    }
    # Short aliases accepted in user-written templates.
    values.update(number=values["document_number"], customer=values["customer_name"], company=values["company_name"])
    return values


def fill(template: str, values: dict[str, str]) -> str:
    """Substitute ``{name}`` placeholders; unknown names stay as written."""
    return re.sub(r"\{([a-z_]+)\}", lambda m: values.get(m.group(1), m.group(0)), template)


def email_draft(doc: SalesDocument, company: dict[str, Any]) -> dict[str, Any]:
    lg = lang(doc.language)
    texts = (company.get("document_texts") or {}).get(doc.kind, {})
    values = placeholders(doc, company)
    return {
        "to": doc.customer_email,
        "cc": [],
        "subject": fill(texts.get("email_subject") or t(lg, "email_subject"), values),
        "body": fill(texts.get("email_body") or t(lg, "email_body"), values),
        "filename": filename(doc),
        "issues": check_invoice(doc, company),
        "mail_configured": mail_status()["configured"],
    }


def mark_sent(doc: SalesDocument, to: str) -> None:
    """Record a successful delivery; a draft quote moves to ``sent``."""
    doc.sent_at = datetime.now(UTC)
    doc.sent_to = to[:255]
    if doc.kind == "quote" and doc.status == "draft":
        doc.status = "sent"


def html_paragraphs(text: str) -> str:
    return "<p>" + html.escape(text).replace("\n\n", "</p><p>").replace("\n", "<br/>") + "</p>"


def _validate(addresses: list[str]) -> list[str]:
    clean = []
    for raw in addresses:
        addr = (raw or "").strip()
        if not _EMAIL.match(addr):
            raise SendRefusedError(f"Not a valid e-mail address: {addr!r}")
        if is_demo_account(addr) or is_non_mailbox_login(addr):
            raise SendRefusedError(f"{addr} is a demo login, not a mailbox; sending is blocked")
        clean.append(addr)
    return clean


async def send_document(
    session: AsyncSession,
    doc: SalesDocument,
    *,
    to: str,
    cc: list[str],
    subject: str,
    body: str,
    sent_by: str | None,
    email: EmailService,
) -> SalesSendLog:
    """Send the PDF to ``to`` (and each ``cc``) and record the outcome. Only called from a user request."""
    recipients = _validate([to, *cc])
    company = company_data()
    pdf = await render_pdf(session, doc, company)
    values = placeholders(doc, company)
    subject = fill(subject, values)
    html_body = html_paragraphs(fill(body, values))
    attachment = EmailAttachment(filename=filename(doc), content=pdf)
    result = await email.send(
        EmailMessage(
            to=recipients[0],
            cc=recipients[1:],
            subject=subject,
            html_body=html_body,
            reply_to=company.get("email") or None,
            tags=["sales_document", doc.kind],
            attachments=[attachment],
        )
    )
    failures = [] if result.ok else [result.reason]
    if result.ok:
        mark_sent(doc, recipients[0])
    log = SalesSendLog(
        id=uuid.uuid4(),
        tenant_id=doc.tenant_id,
        document_id=doc.id,
        sent_by=sent_by,
        sent_at=datetime.now(UTC),
        to_addr=recipients[0],
        cc=recipients[1:],
        subject=subject[:255],
        status="failed" if failures else "sent",
        detail="; ".join(failures)[:255],
        backend=email.backend_name,
    )
    session.add(log)
    await session.flush()
    return log


async def send_history(session: AsyncSession, doc: SalesDocument) -> list[SalesSendLog]:
    rows = await session.execute(
        select(SalesSendLog)
        .where(SalesSendLog.tenant_id == doc.tenant_id, SalesSendLog.document_id == doc.id)
        .order_by(SalesSendLog.sent_at.desc())
    )
    return list(rows.scalars())
