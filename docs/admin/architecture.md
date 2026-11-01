# Architecture

A short map for administrators and developers. For the full developer guide, read [DEVELOPING.md](https://github.com/datadrivenconstruction/OpenBusinessERP/blob/main/DEVELOPING.md) in the repository.

## Parts

```text
Browser (React single-page app)
        |  HTTP, JSON
        v
FastAPI application (Python 3.12+)
   core: login, settings, module loader, audit
   modules: sales, purchasing, inventory, gl, banking, receivables, crm, ...
        |  SQLAlchemy 2 (async), Alembic
        v
PostgreSQL (embedded, or your own server)
```

- **Backend**: FastAPI, SQLAlchemy 2 (async), Pydantic 2. Code is in `backend/app`.
- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, TanStack Query, Zustand, i18next. Code is in `frontend/src`. The production build is served by the backend.
- **Database**: PostgreSQL. Without `DATABASE_URL`, the program starts an embedded PostgreSQL in the data directory.
- **Files**: uploaded files go to local disk under the data directory, or to an S3-compatible store when `S3_*` settings are set.

## Modules

Each business area is a Python package under `backend/app/modules/<name>/`. A module has a `manifest.py` (name, version, dependencies), and usually `models.py`, `schemas.py`, `service.py`, `router.py` and `permissions.py`. The module loader finds the manifests, orders them by dependency and registers their models, routes and permissions. Routes are mounted at `/api/v1/<module>/`.

The small-business workflow uses these modules:

| Module | Purpose |
|---|---|
| `sales` | Quotes, orders, invoices, credit notes, PDF, send |
| `recurring` | Recurring invoice templates and runs |
| `purchasing` | Purchase orders, receipts, bills, payments |
| `inventory` | Warehouses, movements, stocktakes, valuation |
| `gl` | Chart of accounts, journal, periods, reports, DATEV and SAF-T export, FX revaluation |
| `banking` | Accounts, statement import, matching |
| `receivables` | Aging, dunning |
| `fx` | Rates and rate sets |
| `crm`, `contacts`, `items` | Pipeline, customers and suppliers, products |
| `data_import` | CSV and XLSX import |
| `einvoice` | CII and UBL XML |
| `backup` | Per-user export and restore |

The repository contains many more modules, mainly for construction projects. They are switched on or off through the module system and are not needed for the small-business workflow.

## Posting

Business documents post to the general ledger through `GLService`. Each posting is a balanced journal entry in the base currency. A closed period refuses postings. Corrections are reversals. The audit log records changes at the ORM level.

## Settings

Three kinds of settings exist:

- Environment variables or `.env` (database, secrets, mail transport, storage).
- Rows in the database (accounts, tax tables, levels).
- JSON files in the data directory (`mail_settings.json`, `document_design.json`, `gl_export_settings.json`, business settings).

Back up all three. See [Backup and restore](../manual/backup.md).

## Configuration reference

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection, `postgresql+asyncpg://...`. Unset means embedded. |
| `JWT_SECRET` | Random string of 32 characters or more. Required in production. |
| `SEED_DEMO` | `true` loads the demo company and demo sign-in. Set `false` in production. |
| `OE_DATA_DIR` | Data directory. |
| `EMAIL_BACKEND`, `SMTP_*` | Outgoing mail. |
| `S3_*` | Optional S3-compatible file storage. |

The annotated list is in `backend/.env.example`.
