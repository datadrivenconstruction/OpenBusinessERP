# Contributing

Bug reports, translations, documentation and code are welcome. The rules are in [CONTRIBUTING.md](https://github.com/datadrivenconstruction/OpenBusinessERP/blob/main/CONTRIBUTING.md). This page is the short version.

## Ways to help without code

- Report a bug with steps to reproduce.
- Describe a tax, invoicing or reporting rule of your country, and name the law or standard.
- Check a translation in your language.
- Fix a mistake in this manual. Every page has an edit link.

Look for issues labelled [good first issue](https://github.com/datadrivenconstruction/OpenBusinessERP/labels/good%20first%20issue) and [help wanted](https://github.com/datadrivenconstruction/OpenBusinessERP/labels/help%20wanted).

## Workflow

1. For anything larger than a small fix, open an issue first and agree on the approach.
2. Fork the repository and create a branch.
3. Make one change per pull request. Add or update tests when behaviour changes.
4. Open the pull request against `main`.
5. Sign the contributor license agreement once. A bot comments on your first pull request.
6. CI must be green before a maintainer merges.

## Run it locally

```bash
git clone https://github.com/datadrivenconstruction/OpenBusinessERP.git
cd OpenBusinessERP
pip install -e "./backend[server,dev]"
cd frontend && npm install && cd ..

# terminal 1
cd backend && openbusinesserp serve --embedded-pg --port 8000
# terminal 2
cd frontend && npm run dev
```

Open <http://localhost:5173>. You need Python 3.12 or newer and Node.js 22 or newer.

## Run the checks

Run the smallest check that proves your change. Examples:

```bash
cd backend && pytest -q -x tests/<path>/<file>.py
cd frontend && npx vitest run <file>
```

`make test` runs everything. The repository also has scripts in `scripts/` that guard translations, migrations and file hygiene. Read [DEVELOPING.md](https://github.com/datadrivenconstruction/OpenBusinessERP/blob/main/DEVELOPING.md) for the list.

## Translations

The interface texts are in `frontend/src/app/locales/`, one file per language. A new key must exist in every language file. Placeholders such as `{{count}}` must be kept exactly. Do not translate placeholder names.

## Build this manual

```bash
pip install mkdocs-material
mkdocs serve
```

The pages are Markdown files in `docs/manual/` and `docs/admin/`. The navigation is in `mkdocs.yml`. Build with `mkdocs build --strict`. The build fails on broken links. Screenshots live in `docs/images/` and are also used by the README, so do not rename them.

## License

The project is under the AGPL-3.0. Contributions are accepted under the terms of the contributor license agreement.
