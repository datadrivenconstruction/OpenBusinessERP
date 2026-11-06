# API

Everything the web interface does goes through a REST API under `/api/v1/`. You can use it for integrations, scripts and reports.

## Interactive reference

The running program serves the OpenAPI schema and interactive pages:

| Page | Path |
|---|---|
| Swagger UI | `/api/docs` |
| ReDoc | `/api/redoc` |
| OpenAPI JSON | `/api/openapi.json` |

Example: <http://localhost:8080/api/docs> on a default install. These pages are off in production mode. To read the reference of a production setup, run a development copy of the same version.

The schema is the complete, current list of endpoints. This page does not repeat it.

## Authentication

Log in to get a token pair:

```bash
curl -s -X POST http://localhost:8080/api/v1/users/auth/login/ \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com", "password": "..."}'
```

Send the access token on later requests:

```bash
curl -s http://localhost:8080/api/v1/sales/invoices/ \
  -H "Authorization: Bearer <access_token>"
```

For scripts, create an API key at `POST /api/v1/users/me/api-keys/` while logged in. The key is shown once. Send it as `X-API-Key: <key>` on endpoints that accept key authentication.

Permissions apply to the API in the same way as to the screens. See [Roles and audit log](../manual/roles-audit.md).

## URL pattern

The first path segment is the module name:

| Area | Base path |
|---|---|
| Sales documents | `/api/v1/sales/{quotes,orders,invoices,credit-notes}/` |
| Recurring invoices | `/api/v1/recurring/` |
| Purchasing | `/api/v1/purchasing/{orders,bills,receipts}/` |
| Inventory | `/api/v1/inventory/` |
| Ledger | `/api/v1/gl/` |
| Banking | `/api/v1/banking/` |
| Dunning | `/api/v1/receivables/` |
| Exchange rates | `/api/v1/fx/` |

Check exact paths in `/api/docs`. Collection paths end with a slash.

## Useful facts

- Every response has an `X-API-Version` header and an `X-Request-ID` header. Quote the request id in a bug report.
- Money values are decimals sent as strings or numbers with exact scale. Do not do float arithmetic on them.
- Document actions are separate endpoints, for example `POST /api/v1/sales/orders/{id}/convert-to-invoice/` and `POST /api/v1/sales/invoices/{id}/issue/`.
- Export files: `GET /api/v1/gl/export/{datev|datev-contacts|saft}/?date_from=...&date_to=...`.

## Typed clients

Generate a typed client from the schema with any OpenAPI generator. The frontend does it this way with `openapi-typescript`.

More detail is in [docs/api/README.md](https://github.com/datadrivenconstruction/OpenBusinessERP/blob/main/docs/api/README.md) in the repository.
