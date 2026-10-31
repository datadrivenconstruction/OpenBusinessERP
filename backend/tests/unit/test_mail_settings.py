"""Mail settings from the business settings hub: encrypted password, env override, SMTP transport."""

from __future__ import annotations

import json
import smtplib

import pytest

from app.config import get_settings
from app.core import mail_settings as ms
from app.core.email.base import EmailAttachment, EmailMessage
from app.core.email.smtp import SmtpEmailBackend


class FakeSMTP:
    instances: list[FakeSMTP] = []

    def __init__(self, host, port, timeout=None):
        self.host, self.port, self.calls, self.sent = host, port, [], []
        FakeSMTP.instances.append(self)

    def ehlo(self):
        self.calls.append("ehlo")

    def starttls(self):
        self.calls.append("starttls")

    def login(self, user, password):
        self.calls.append(("login", user, password))

    def sendmail(self, from_addr, to, body):
        self.sent.append((from_addr, to, body))

    def quit(self):
        self.calls.append("quit")


@pytest.fixture
def fake_smtp(monkeypatch):
    FakeSMTP.instances = []
    monkeypatch.setattr(smtplib, "SMTP", FakeSMTP)
    monkeypatch.setattr(smtplib, "SMTP_SSL", type("FakeSSL", (FakeSMTP,), {}))
    return FakeSMTP


@pytest.fixture
def no_env_smtp(monkeypatch):
    monkeypatch.setattr(ms, "env_override", lambda settings=None: False)


def test_password_encrypted_at_rest_and_never_returned(tmp_path, no_env_smtp):
    view = ms.write_mail_settings(
        {"host": "smtp.example.com", "port": 587, "username": "bot", "password": "s3cret", "from_address": "a@b.de"},
        tmp_path,
    )
    assert "password" not in view and view["password_set"] and view["configured"] and view["source"] == "settings"
    stored = json.loads((tmp_path / ms.MAIL_SETTINGS_FILENAME).read_text())
    assert stored["password"] != "s3cret" and stored["password"].startswith("gAAAAA")
    assert ms.stored_smtp_settings(tmp_path).smtp_password == "s3cret"
    ms.write_mail_settings({"from_name": "Muster"}, tmp_path)  # password None keeps it
    assert ms.stored_smtp_settings(tmp_path).smtp_password == "s3cret"
    assert not ms.write_mail_settings({"password": ""}, tmp_path)["password_set"]


def test_invalid_values_fall_back(tmp_path, no_env_smtp):
    view = ms.write_mail_settings({"host": "bad host!", "port": 0, "security": "x", "reply_to": "nope"}, tmp_path)
    assert view["host"] == "" and view["port"] == 587 and view["security"] == "starttls" and view["reply_to"] == ""
    assert not view["configured"]


def test_env_override_wins(tmp_path, monkeypatch):
    ms.write_mail_settings({"host": "smtp.example.com"}, tmp_path)
    monkeypatch.setattr(ms, "env_override", lambda settings=None: True)
    assert ms.mail_status(tmp_path)["source"] == "env"


@pytest.mark.asyncio
async def test_send_via_stored_settings_starttls(tmp_path, no_env_smtp, fake_smtp):
    ms.write_mail_settings(
        {
            "host": "smtp.example.com",
            "username": "bot",
            "password": "pw",
            "from_name": "Muster GmbH",
            "from_address": "billing@muster.de",
            "reply_to": "office@muster.de",
        },
        tmp_path,
    )
    svc = ms.mail_service(tmp_path)
    result = await svc.send(
        EmailMessage(
            to="buyer@example.com",
            cc=["acc@example.com"],
            subject="Rechnung",
            html_body="<p>Hallo</p>",
            attachments=[EmailAttachment("inv.pdf", b"%PDF-1.4")],
        )
    )
    assert result.ok, result.reason
    conn = fake_smtp.instances[0]
    assert conn.host == "smtp.example.com" and "starttls" in conn.calls and ("login", "bot", "pw") in conn.calls
    from_addr, rcpts, body = conn.sent[0]
    assert from_addr == "billing@muster.de" and rcpts == ["buyer@example.com", "acc@example.com"]
    assert "From: Muster GmbH <billing@muster.de>" in body and "Reply-To: office@muster.de" in body
    assert "Cc: acc@example.com" in body and 'filename="inv.pdf"' in body


@pytest.mark.asyncio
async def test_implicit_tls_on_465(fake_smtp):
    settings = get_settings().model_copy(
        update={"smtp_host": "smtp.example.com", "smtp_port": 465, "smtp_ssl": True, "smtp_tls": False}
    )
    result = await SmtpEmailBackend(settings).send(EmailMessage(to="x@example.com", subject="s", html_body="b"))
    assert result.ok
    conn = fake_smtp.instances[0]
    assert type(conn).__name__ == "FakeSSL" and "starttls" not in conn.calls
