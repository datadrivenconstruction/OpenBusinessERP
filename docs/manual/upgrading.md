# Upgrading

## Before every upgrade

1. Take a database dump and a copy of the data directory. See [Backup and restore](backup.md).
2. Read the [changelog](https://github.com/datadrivenconstruction/OpenBusinessERP/blob/main/CHANGELOG.md) for the versions in between.
3. Choose a quiet time. Users are interrupted while the app restarts.

On start, the app brings the database schema up to date by itself. You do not run migrations by hand. This is why the dump in step 1 matters: there is no automatic way back to the old schema.

## Docker Compose, built from source

```bash
cd OpenBusinessERP
git pull
make quickstart
```

## Docker Compose, published image

```bash
docker compose pull app
docker compose up -d
```

Pin a version with the image tag (`:X.Y.Z`) if you do not want to follow the latest build. The tag `:edge` follows the main branch and may change daily. Do not use it for your books.

## pip install

Stop the program first. On Windows the running database files are locked, and replacing them in a running install can leave a broken mix of old and new files.

```bash
openbusinesserp upgrade
```

The command upgrades the package in the same Python environment that runs the program. Use `--version X.Y.Z` to pin a version. If it finds a running database in the data directory, it stops and tells you.

The package is not on PyPI yet. This works from the first release on.

## Desktop app

Download the new installer from the [releases page](https://github.com/datadrivenconstruction/OpenBusinessERP/releases) and run it over the existing installation. Your data stays where it is. The desktop build cannot upgrade itself with pip.

## After the upgrade

- Open the app and sign in.
- Open an invoice and the bank screen to check that data is there.
- Run `openbusinesserp doctor` on pip installs.
- If something is wrong, restore the dump you took, install the old version and report the problem.
