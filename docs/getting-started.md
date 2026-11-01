# Getting Started

Three ways to run OpenBusinessERP. Pick whichever fits your setup.

## Path A: Desktop App (easiest)

Download the installer for your platform:

- **[https://github.com/datadrivenconstruction/OpenBusinessERP/releases/latest](https://github.com/datadrivenconstruction/OpenBusinessERP/releases/latest)**
- Or grab from the [latest GitHub release](https://github.com/datadrivenconstruction/OpenBusinessERP/releases/latest): Windows `.exe`, macOS `.dmg` (Apple Silicon), Linux `.deb` / `.AppImage`

Run the installer, launch the app. First launch takes about one minute to set up the local database. No Python, no Docker, no terminal required.

On Windows the installer is not code signed yet. If Windows warns about an unknown publisher or Smart App Control blocks the app, see [Windows blocks the app](desktop/WINDOWS_BLOCKED.md).

## Path B: pip install

Requires **Python 3.12+**.

```bash
pip install --upgrade openbusinesserp
openbusinesserp
```

The package ships the FastAPI backend and a pre-built React frontend in a single wheel. On first run it sets up an embedded PostgreSQL instance, loads demo data, and opens your browser at [localhost:8080](http://localhost:8080).

**Demo login:** `demo@openbusinesserp.com` / `DemoPass1234!`

> **Running on a VPS or remote server?** The default binds to localhost only.
> To make the app reachable over the network, start it with:
>
> ```bash
> openbusinesserp serve --host 0.0.0.0
> ```
>
> For a production setup with systemd, see [INSTALL_LINUX.md](INSTALL_LINUX.md).

## Path C: Docker

One container, with PostgreSQL bundled inside and all data on a named volume:

```bash
docker run -p 8080:8080 -v obe-data:/data ghcr.io/datadrivenconstruction/openbusinesserp:latest
```

The image is multi-arch (amd64, arm64) and runs as a non-root user. Set
`DATABASE_URL=postgresql+asyncpg://user:pass@host:5432/db` to use your own
PostgreSQL instead, and `JWT_SECRET` to manage the signing key yourself (otherwise
one is generated on the volume). `:edge` tracks `main`; `:X.Y.Z` pins a release.

For a separate PostgreSQL container, download both Compose files and start the stack:

```bash
curl -fsSL https://raw.githubusercontent.com/datadrivenconstruction/OpenBusinessERP/main/docker-compose.quickstart.yml       -o docker-compose.yml
curl -fsSL https://raw.githubusercontent.com/datadrivenconstruction/OpenBusinessERP/main/docker-compose.quickstart.image.yml -o docker-compose.override.yml
echo "POSTGRES_PASSWORD=$(openssl rand -base64 24)" >  .env
echo "JWT_SECRET=$(openssl rand -hex 32)"           >> .env
docker compose pull app
docker compose up -d
```

The app runs at [localhost:8080](http://localhost:8080).

**Demo login:** `demo@openbusinesserp.com` / `DemoPass1234!`

## Prerequisites

| Path | Requirement |
|------|-------------|
| Desktop | None |
| pip | Python 3.12+ |
| Docker | Docker with Compose v2 |
| Source development | Python 3.12+, Node.js 22+, PostgreSQL 16+ |

## What's Next

- Explore the demo project that ships with every fresh install.
- Import your own customers, products and opening balances (Excel, CSV) with the data import wizard.

## Removing the demo projects

The demo projects are yours to delete. Delete them one by one from the project list, or remove them all at once under Settings, Danger Zone, Remove sample data. A demo you removed stays removed: restarts and upgrades do not bring it back, and installing it again from the demo catalog is the one way to get it back.

Earlier versions could write demo records into your own projects on restart, such as a daily diary, bid packages, quality plans or a team roster. To find and remove them, an administrator opens Settings, Danger Zone, Find leftover demo records, looks through the list grouped by project and module, and confirms Remove. On a server, `openbusinesserp demo-cleanup` prints the same list without changing anything, and `openbusinesserp demo-cleanup --apply` removes it. Only records that carry the demo seed's mark or match exactly what the seed writes are listed, and a demo record somebody has worked on since is kept and shown with the reason.

For building from source, running tests, or contributing, see [DEVELOPING.md](../DEVELOPING.md).
