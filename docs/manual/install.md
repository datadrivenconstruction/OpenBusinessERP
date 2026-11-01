# Install

There are three ways to run OpenBusinessERP. Pick one.

| Way | Good for | Status |
|---|---|---|
| Docker Compose | A small server or an always-on office machine | Available now |
| Desktop app | One person on one computer | Installers are attached to GitHub releases. No tagged release exists yet. |
| pip | People who already use Python | Coming with the first release. The package is not on PyPI yet. |

## Docker Compose

You need Docker with Compose v2, Git and `make`.

```bash
git clone https://github.com/datadrivenconstruction/OpenBusinessERP.git
cd OpenBusinessERP
echo "POSTGRES_PASSWORD=$(openssl rand -base64 24)" >  .env
echo "JWT_SECRET=$(openssl rand -hex 32)"           >> .env
make quickstart
```

The first start builds the image and creates the database. Then open <http://localhost:8080>.

The two secrets in `.env` matter:

- `POSTGRES_PASSWORD` is the password of the database.
- `JWT_SECRET` signs login tokens. Keep it private and do not change it later, or everyone is logged out.

The stack uses two Docker volumes: `pg_data` (the database) and `app_data` (uploaded files and settings). Your data lives there, not in the container. See [Backup and restore](backup.md).

### Before you put it on the internet

- Set `SEED_DEMO=false`. With `true`, the program loads a demo company and shows one-click demo logins on the sign-in page.
- Put a reverse proxy with HTTPS in front of port 8080.
- Use `docker-compose.prod.yml` in the repository as the production template.

### Without building

If the local build fails, or you do not want to build, use the published image:

```bash
make quickstart-image
```

## Desktop app

Download the installer from the [releases page](https://github.com/datadrivenconstruction/OpenBusinessERP/releases): `.exe` for Windows, `.dmg` for Apple Silicon Macs, `.deb` or `.AppImage` for Linux.

The first start takes about a minute while the local database is set up. You need no Python, Docker or terminal.

!!! warning "Unsigned installers"
    The Windows installer is not code signed yet, and the macOS app is not notarized. Windows and macOS may warn you. The [desktop install guide](https://github.com/datadrivenconstruction/OpenBusinessERP/blob/main/docs/desktop/INSTALL.md) explains each warning.

## pip (coming with the first release)

The package is not on PyPI yet. After the first release, this will work:

```bash
pip install --upgrade openbusinesserp
openbusinesserp
```

It starts an embedded PostgreSQL database and opens <http://localhost:8080>. You need Python 3.12 or newer.

Until then, install from the source tree:

```bash
git clone https://github.com/datadrivenconstruction/OpenBusinessERP.git
cd OpenBusinessERP
pip install -e "./backend[server]"
openbusinesserp serve --embedded-pg --port 8080
```

This runs the API. The web interface needs a built frontend. Without it, use Docker Compose or the desktop app.

## Check the installation

```bash
openbusinesserp doctor
```

The command prints OK, WARN or ERROR for each check.

## Where the data is

With the pip or source install, the program keeps its data (embedded database, settings, uploads) in your home directory under `.openestimate`. Set `OE_DATA_DIR` to use another folder. With Docker, the data is in the two volumes above.

## First sign-in

On a fresh install without demo data, register an account on the sign-in page. The first account becomes the administrator. Later accounts get a normal role until an administrator changes it. See [Roles and audit log](roles-audit.md).

Next: [Set up and send your first invoice](first-invoice.md).
