# Privacy and Data Flows

This page describes what the OpenBusinessERP **software** does with data. It is
not a privacy policy for your organisation: when you self-host, you are the
controller of the data you put into it and you are responsible for your own
privacy notices, legal basis and data-protection obligations. For an instance
operated by DataDrivenConstruction, see also
[docs/legal/PRIVACY.md](docs/legal/PRIVACY.md).

## No telemetry

OpenBusinessERP contains no analytics, usage tracking, crash reporting or
"phone home" telemetry. There is no Sentry, PostHog, Google Analytics or similar
SDK in the backend or the frontend. Your business data stays in your database
and file storage.

## Outbound connections

The server only connects to external services in these cases:

| Feature | Destination | When |
|---|---|---|
| Update check | `pypi.org`, `api.github.com` | When the "update available" widget asks the backend; sends no user data, only fetches the latest release number. |
| Optional downloads | `api.github.com`, GitHub release assets | Only when an administrator installs an optional component (for example a converter or vector database). |
| Weather card | `open-meteo.com` | Only when a record with a location opens the weather card; sends coordinates only. |
| Exchange rates | `www.ecb.europa.eu` (ECB reference rates), `api.worldbank.org` (PPP factors) | When an administrator presses refresh or opens the FX status, and daily only if the daily import is switched on (Settings, or `OE_FX_DAILY_IMPORT=1`). Sends no user data. |
| Maps (browser) | `tiles.openfreemap.org`, `tile.openstreetmap.org` | When a page with a map is shown. The user's browser fetches tiles directly, so these providers see its IP address and the map area viewed. Attribution © OpenStreetMap contributors (ODbL) is shown on every map. |
| Tutorial videos (browser) | `www.youtube-nocookie.com` | Only after the user presses play on the Videos page. |
| Optional datasets and models | `huggingface.co`, `dl.fbaipublicfiles.com`, `pkg.datadrivenconstruction.io` | Only when an administrator downloads a catalogue, embedding model, dictionary or converter. |
| AI features | The provider you configure (OpenAI, Anthropic, Google, Mistral, Groq, DeepSeek, a local model, ...) | **Only after an administrator enters an API key.** The text, documents or records you send to an AI action are transmitted to that provider and processed under its terms. Without a key, nothing is sent. |
| E-mail, banking, e-invoicing networks, other connectors | The service you configure | Only when you set up and use the connector. |

Air-gapped installs work: every outbound call is optional and fails silently.

## Response headers

`backend/app/middleware/fingerprint.py` adds origin headers to API responses
(`X-Powered-By`, `X-DDC-Origin`, `X-DDC-Author`, `X-DDC-License`) that name the
software and its licence. They contain no user, tenant or machine data. In
development only, it also adds a random per-process build hash (regenerated at
every start) and a `Server-Timing` marker; both are switched off when
`APP_ENV=production`.

## Data subject requests and retention

The software stores the personal data you enter (contacts, employees, users,
documents) and an audit log of changes. To answer access or erasure requests
(GDPR Art. 15/17) an administrator can export records (CSV/Excel and API) and
delete or anonymise them; check that backups and the audit log follow your own
retention rules, since audit entries are kept until you purge them.

## Browser storage

The frontend stores your session token and UI preferences (language, theme,
dismissed notices) in the browser's local storage. No third-party cookies are
set.

## Demo data

The demo companies, people, addresses, IBANs and tax numbers created by the demo
seed are fictional. Any resemblance to real organisations or persons is
coincidental.

## Questions

info@datadrivenconstruction.io
