# Backup and restore

!!! warning "Read this first"
    The program has a backup function in the web interface. It is **not** a full company backup. It exports one user's own records as a ZIP of JSON files. Your invoices, ledger and bank data may not be fully in it. For your books, make a database backup as described below.

## What to back up

A complete backup has two parts:

1. **The database.** It holds contacts, documents, the ledger, settings in the database and everything else.
2. **The data directory.** It holds uploaded files, the logo, and the settings files `mail_settings.json`, `document_design.json` and `gl_export_settings.json`. Mail passwords are stored encrypted there. The signing secret for logins may be stored there too, if you did not set `JWT_SECRET` yourself.

Back up both, at the same time.

## Docker Compose install

The quickstart stack names the database `openestimate`, the user `oe`, and keeps data in the volumes `pg_data` (database) and `app_data` (data directory, mounted at `/data`).

Database dump:

```bash
docker compose exec -T postgres pg_dump -U oe -Fc openestimate > backup-$(date +%F).dump
```

Data directory (run from the project folder; adjust the volume name, which Compose prefixes with the project name, see `docker volume ls`):

```bash
docker run --rm -v <project>_app_data:/data -v "$PWD":/out alpine \
  tar czf /out/app-data-$(date +%F).tar.gz -C /data .
```

Keep copies on another machine or in another place. A backup on the same disk does not survive a dead disk.

### Restore

On a new, empty stack:

```bash
docker compose up -d postgres
docker compose exec -T postgres pg_restore -U oe -d openestimate --clean --if-exists < backup-2026-11-01.dump
```

Then unpack the data directory archive into the `app_data` volume, and start the app with `docker compose up -d`. Use the same `JWT_SECRET` as before.

Test a restore on a spare machine before you need it. A backup you never restored is a guess.

## pip and source installs

The embedded database lives in the data directory, in the folder `pgdata`. The default data directory is `.openestimate` in your home directory, or the folder in `OE_DATA_DIR`.

Stop the program, then copy the whole data directory. Copying the database folder while the program runs gives a broken copy. The copy is only valid when the program and its database are stopped.

Restore by putting the folder back while the program is stopped.

The desktop app also runs an embedded database. This manual does not state where the desktop app keeps its data folder, because the desktop guide does not say. Check where it is on your machine before you rely on a copy.

## Your own PostgreSQL server

If `DATABASE_URL` points to your server, use your normal PostgreSQL backup tools (`pg_dump`, or the backup service of your host) plus a copy of the data directory.

## The backup function in the web interface

**Settings > Backup and restore.** Only an Admin can use it.

- **Export** downloads a ZIP named `openbusinesserp_backup_<timestamp>.zip`. It contains a `manifest.json` (version, time, record counts per module, SHA-256 checksum) and one JSON file per module. You can include attached files.
- **Restore** uploads such a ZIP. File size limit 500 MB.
    - **Merge** (default) adds records whose id does not exist yet. It deletes nothing.
    - **Replace** is allowed only into an account that has no data yet. Otherwise it is refused.
- Restore runs in one transaction. If it fails, nothing is changed.
- The export belongs to the user who made it. On restore, the records are assigned to the user who restores them. User accounts and passwords are not part of the restore.

Use it to move one user's records between machines. Do not use it as your only backup.

## Is the backup still running?

A backup job that stops does not raise an error. The repository includes `scripts/check_backup_freshness.py`. It complains when the newest dump is too old, too small or missing. See the [backup monitoring note](https://github.com/datadrivenconstruction/OpenBusinessERP/blob/main/docs/backup-monitoring.md).

## A simple routine

- Every night: database dump and data directory archive, copied off the machine.
- Every month: restore the latest copy on another machine and open an invoice.
- After each upgrade: take a dump first. See [Upgrading](upgrading.md).
