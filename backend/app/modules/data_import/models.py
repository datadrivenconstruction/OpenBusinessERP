"""Data import ORM models.

Tables:
    oe_data_import_job     - one upload: parsed rows, mapping, status, result counts.
    oe_data_import_record  - a row written by a job (entity + id + created/updated) for undo.
    oe_data_import_preset  - a saved column mapping per target.
"""

from __future__ import annotations

import uuid

from sqlalchemy import JSON, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import GUID, Base


class ImportJob(Base):
    __tablename__ = "oe_data_import_job"

    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    target: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    filename: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="uploaded", index=True)
    encoding: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    delimiter: Mapped[str] = mapped_column(String(4), nullable=False, default="")
    headers: Mapped[list] = mapped_column(JSON, nullable=False, default=list)  # type: ignore[assignment]
    rows: Mapped[list] = mapped_column(JSON, nullable=False, default=list)  # type: ignore[assignment]
    mapping: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)  # type: ignore[assignment]
    options: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)  # type: ignore[assignment]
    summary: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)  # type: ignore[assignment]
    row_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_by: Mapped[str | None] = mapped_column(String(64), nullable=True)


class ImportRecord(Base):
    __tablename__ = "oe_data_import_record"

    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    job_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("oe_data_import_job.id", ondelete="CASCADE"), nullable=False, index=True
    )
    entity: Mapped[str] = mapped_column(String(32), nullable=False)
    record_id: Mapped[uuid.UUID] = mapped_column(GUID(), nullable=False)
    action: Mapped[str] = mapped_column(String(16), nullable=False, default="created")
    row_no: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class ImportPreset(Base):
    __tablename__ = "oe_data_import_preset"

    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    target: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    mapping: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)  # type: ignore[assignment]
