<h1 align="center">OpenBusinessERP</h1>

<p align="center">Self-hosted, open-source ERP for businesses in any country: quotes, invoices, stock, purchasing, bank reconciliation and double-entry bookkeeping, in 44 languages.</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg" alt="License: AGPL-3.0"></a>
  <a href="https://github.com/datadrivenconstruction/OpenBusinessERP/tags"><img src="https://img.shields.io/github/v/tag/datadrivenconstruction/OpenBusinessERP?label=version" alt="Latest version"></a>
  <a href="https://github.com/datadrivenconstruction/OpenBusinessERP/actions/workflows/ci.yml"><img src="https://github.com/datadrivenconstruction/OpenBusinessERP/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI"></a>
  <a href="https://github.com/datadrivenconstruction/OpenBusinessERP/releases"><img src="https://img.shields.io/github/downloads/datadrivenconstruction/OpenBusinessERP/total?label=downloads&color=brightgreen" alt="Downloads"></a>
  <a href="https://github.com/datadrivenconstruction/OpenBusinessERP/stargazers"><img src="https://img.shields.io/github/stars/datadrivenconstruction/OpenBusinessERP?style=flat&logo=github&color=f5b301" alt="GitHub stars"></a>
</p>

<p align="center">
  <a href="https://openbusinesserp.com">Website</a> ·
  <a href="https://demo.openbusinesserp.com/">Live demo</a> ·
  <a href="https://datadrivenconstruction.github.io/OpenBusinessERP/">Documentation</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#limits">Limits</a> ·
  <a href="ROADMAP.md">Roadmap</a>
</p>

<p align="center">
  <img src="docs/images/hero.png" alt="OpenBusinessERP dashboard with cash, receivables, payables and revenue of the demo company" width="100%">
</p>

<h3 align="center">Download the desktop app</h3>

<p align="center">Embedded database included. No Docker, no server.</p>

<p align="center">
  <a href="https://github.com/datadrivenconstruction/OpenBusinessERP/releases/latest"><img src="https://img.shields.io/badge/Windows-.exe-0078D6?style=for-the-badge&logo=windows11&logoColor=white" alt="Download for Windows" height="40"></a>&nbsp;
  <a href="https://github.com/datadrivenconstruction/OpenBusinessERP/releases/latest"><img src="https://img.shields.io/badge/macOS-Apple%20Silicon%20.dmg-111111?style=for-the-badge&logo=apple&logoColor=white" alt="Download for macOS (Apple Silicon)" height="40"></a>&nbsp;
  <a href="https://github.com/datadrivenconstruction/OpenBusinessERP/releases/latest"><img src="https://img.shields.io/badge/Linux-.deb%20·%20.rpm%20·%20.AppImage-FCC624?style=for-the-badge&logo=linux&logoColor=black" alt="Download for Linux" height="40"></a>
</p>

<p align="center"><sub>The installers are not code-signed yet, so Windows and macOS warn on first launch. Every release ships <code>SHA256SUMS</code> with a Sigstore signature. Server install: <a href="#quick-start">Quick start</a>.</sub></p>

<table align="center"><tr><td align="center">

### ⭐ A star means a lot to us

OpenBusinessERP is free and built by a small team at DataDrivenConstruction.<br>
Stars are how other companies find out that an open-source project is alive and worth trying.<br>
**If the project is useful to you, please star it. It takes one click and helps us more than anything else.**

**How:** sign in to GitHub → scroll to the top of this page → click **☆ Star** in the top right.

<a href="https://github.com/datadrivenconstruction/OpenBusinessERP/stargazers"><img src="https://img.shields.io/github/stars/datadrivenconstruction/OpenBusinessERP?style=for-the-badge&logo=github&label=Star%20OpenBusinessERP&color=f5b301" alt="Star OpenBusinessERP on GitHub" height="36"></a>

</td></tr></table>


The interface is available in 44 languages, four of them written right to left (Arabic, Persian, Urdu, Hebrew). Each document is rendered in the customer's language and currency, whatever language the user works in.

## A month in the software

The demo company is a wholesale trader. A typical month:

1. A customer asks for a price. You write a **quote** and send it as PDF from your own mail server.
2. The customer accepts. The quote becomes an **order**, then a **delivery** that takes the goods out of stock.
3. The delivery becomes an **invoice** in the customer's language and currency, with a payment QR code where one is in use (SEPA GiroCode, Swiss QR-bill). A customer who needs an e-invoice gets EN 16931 XML (UBL or CII), Peppol BIS Billing 3.0, XRechnung or a ZUGFeRD / Factur-X PDF. Posting the invoice writes the journal entry, split by tax rate.
4. Stock runs low. A **purchase order** goes to the supplier; the goods receipt and the supplier's **bill** are matched against it.
5. You import the bank statement (camt.053, MT940 or CSV). **Bank reconciliation** proposes the open invoice or bill behind each line; you confirm.
6. A customer has not paid. The dunning run proposes a **reminder** level and sends it by e-mail.
7. At month end you check the tax report, close the period and give your accountant a **SAF-T 2.0** file or a **DATEV** batch.

<p align="center">
  <img src="docs/images/sales-flow.gif" alt="A quote becomes an order, then an invoice that is issued, posted and paid" width="960">
</p>

## Features

**Sales**
- Quotes, orders, deliveries, invoices and credit notes in one document chain; nothing is typed twice.
- Recurring invoices (weekly to yearly) that are generated, posted and e-mailed on schedule, with MRR and ARR.
- Payment links on invoices through Stripe or Mollie; the provider fee is booked when the webhook reports it.
- Documents in the customer's language, independent of the user's interface language.

**Customers and appointments**
- CRM pipeline from lead to won deal; a won deal becomes a quote.
- Calendar for services, staff and rooms, with a public booking page you can embed on your website.

**Stock and purchasing**
- Product and service catalogue with prices, margins, tax rates and minimum stock.
- Stock per warehouse in a movement ledger, stocktakes, moving-average valuation.
- Purchase order, goods receipt and supplier bill matched step by step; supplier price catalogues.

**Bank and receivables**
- Statement import in camt.053, camt.054, MT940 and CSV; matching rules for recurring lines.
- Aging buckets and dunning runs with per-customer exclusions.

**Accounting**
- Double-entry general ledger: journal, trial balance, balance sheet, profit and loss with prior-period comparison, VAT report.
- Posted entries cannot be edited, only reversed. Closed periods accept no postings. Entry numbers are gap-free per fiscal year. Every business-module write is recorded in an audit log with a before/after summary.
- 79 currencies with their own decimal places, ECB reference rates, and realised exchange differences posted.

**Getting data in and out**
- Import wizard for customers, suppliers, products, opening balances and open items from CSV or XLSX, with dry run and undo.
- REST API under `/api/v1/` with an OpenAPI schema; every screen uses the same API.
- Optional AI chat over your own data, using your own API key. Everything else works without it.

## Countries and standards

| Topic | What the code does |
|---|---|
| Languages | 44 interface languages, including four right-to-left scripts. Quotes, invoices and reminders are rendered in the customer's language. |
| Currencies | 79 currencies with 0 to 3 decimal places; ECB reference rates; exchange differences are posted when an invoice is paid. |
| Tax rates | Rate presets for 44 countries, editable in the setup. Sales and purchase tax post per rate. On the national charts, 0 % lines are routed to reverse-charge, intra-EU, small-business or exempt revenue accounts. |
| Charts of accounts | A generic IFRS-style chart, plus national templates: SKR03 and SKR04 (Germany), EKR (Austria) and KMU (Switzerland). Pick one in the business setup. |
| E-invoicing | EN 16931 in CII and UBL, Peppol BIS Billing 3.0, XRechnung 3.0 and ZUGFeRD 2.1 / Factur-X hybrid PDF. Invoices are checked against the EN 16931 business rules before export. |
| Accountant export | SAF-T 2.0 XML. For Germany, a DATEV EXTF batch with all 125 columns and a debtor/creditor master data file. |
| Payment slips | SEPA GiroCode (EPC QR) on EUR invoices; Swiss QR-bill (SIX guidelines v2.3) for businesses in Switzerland and Liechtenstein. |
| Bank statements | camt.053, camt.054, MT940 and CSV, with matching rules for recurring lines. |
| Bookkeeping rules | Posted entries are immutable and corrected by reversal; closed periods are locked; numbering is gap-free; changes are audit-logged. Audit rules such as the German GoBD ask for these properties; this is not a certification (see below). |

## Quick start

You need Docker with Compose v2, Git and `make`.

```bash
git clone https://github.com/datadrivenconstruction/OpenBusinessERP.git
cd OpenBusinessERP
echo "POSTGRES_PASSWORD=$(openssl rand -base64 24)" >  .env
echo "JWT_SECRET=$(openssl rand -hex 32)"           >> .env
make quickstart
```

Open <http://localhost:8080>. The first start builds the image, creates the database and loads the demo company; the sign-in page offers one-click demo accounts. If you do not want to build locally, `make quickstart-image` uses the published image.

Before the server is reachable from the internet: set `SEED_DEMO=false`, put a reverse proxy with HTTPS in front of port 8080, and start from `docker-compose.prod.yml`. Details, the desktop app and backups are in the [install guide](docs/manual/install.md).

For development (Python 3.12+, Node.js 22+):

```bash
pip install -e "./backend[server]"
# terminal 1: API with an embedded PostgreSQL
cd backend
openbusinesserp serve --embedded-pg --port 8000
# terminal 2: UI with hot reload on http://localhost:5173
cd frontend && npm install && npm run dev
```

See [DEVELOPING.md](DEVELOPING.md) and the [module development quickstart](docs/module-development/quickstart.md).

## Limits

Read these before you rely on the software for your books.

- **Nothing is certified.** No tax authority, e-invoicing network or software vendor has certified any part of it; the DATEV files are not certified by DATEV. The e-invoices are checked against EN 16931 rules, which confirms structure, not acceptance by a receiver or authority. Compliance with national bookkeeping rules (for example GoBD in Germany) also depends on your own procedures, retention and operation.
- **Depth differs by country.** National charts of accounts, payment slips and the DATEV export exist for Germany, Austria and Switzerland. Elsewhere you work with the generic chart, the tax presets and EN 16931 / Peppol; check your local invoice and filing rules with your accountant.
- **Test the accountant export** (SAF-T or DATEV) with your accountant before the first real import. Columns without a data source stay empty. The full list is in [DATEV and SAF-T export](docs/manual/accountant-export.md).
- **ZUGFeRD PDFs are not strict PDF/A-3b.** The embedded XML is complete; a receiver that demands PDF/A-3b needs a post-processing step.
- **No payroll, no tax filing.** There is no payroll, no electronic submission of tax returns and no year-end financial statement workflow. Your accountant files.
- **Installers are not code-signed.** Desktop installers for Windows, macOS and Linux are on the [releases page](https://github.com/datadrivenconstruction/OpenBusinessERP/releases/latest); Windows and macOS warn on first launch. The PyPI package is not published.
- **Bank connection is file-based.** Statements are imported as files; there is no live bank connection (PSD2, EBICS, FinTS or similar).

## Architecture

FastAPI, SQLAlchemy 2 (async), Pydantic 2 and Alembic on PostgreSQL; a React 18 + TypeScript single-page app built with Vite and served by the backend. Each business area is a module under `backend/app/modules/<name>/` with a `manifest.py`; the loader resolves dependencies and registers models, routes and event hooks, and modules can be switched off per installation. Without `DATABASE_URL`, an embedded PostgreSQL is started in the data directory. Configuration is read from environment variables; [`backend/.env.example`](backend/.env.example) lists them all.

The interface is translated into 44 languages from 45 locale bundles, including right-to-left scripts.

## Contributing

The easiest way to help is a ⭐ on GitHub: it is how other companies discover the project.

Bug reports, translations and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first; contributors sign the [CLA](CLA.md) once, through a bot comment on the first pull request. For anything larger than a bug fix, open a [discussion](https://github.com/datadrivenconstruction/OpenBusinessERP/discussions) about the approach before you start. Report security issues privately as described in [SECURITY.md](SECURITY.md).

## License

OpenBusinessERP is licensed under the [GNU Affero General Public License v3.0](LICENSE). You can use, modify and self-host it freely. If you offer a modified version to users over a network, you must make its source code available to them under the same license. A commercial license is available on request. See also [NOTICE](NOTICE), [TRADEMARK.md](TRADEMARK.md) and [PRIVACY.md](PRIVACY.md).

## Disclaimer

OpenBusinessERP is provided **"AS IS", without warranty of any kind**, express or implied, and without liability for damages, to the extent permitted by law (see sections 15 and 16 of the [AGPL-3.0](LICENSE)).

- **Not professional advice.** Nothing in the software or its documentation is tax, legal or accounting advice. Consult a qualified adviser for your situation.
- **You verify the rules.** Tax rates, VAT logic, e-invoice formats, statutory reports and retention rules are shipped as a starting point and change over time. You are responsible for checking them against current law and the official specifications before relying on them, and for any filing or invoice you issue.
- **Schema-validated is not certified.** Where the software validates documents against a published schema, that confirms the structure only. No part of OpenBusinessERP is certified by a tax authority or standards body unless explicitly stated.
- **Fictional demo data.** All demo companies, people, addresses, bank details and tax numbers are invented. Any resemblance to real organisations or persons is coincidental.

<p align="center"><sub>Made by <a href="https://datadrivenconstruction.io">Data Driven Construction</a>.</sub></p>

---

<p align="center"><b>Found OpenBusinessERP useful?</b> <a href="https://github.com/datadrivenconstruction/OpenBusinessERP">⭐ Star it on GitHub</a> so more companies can find it. Thank you!</p>
