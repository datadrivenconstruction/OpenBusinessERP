# Contributing to OpenBusinessERP

Thank you for your interest. OpenBusinessERP is an open-source ERP for small and
mid-sized businesses: invoicing, accounting, CRM, inventory, procurement, HR,
appointments and more, with country packs for tax and e-invoicing. Pull requests,
bug reports, translations and country-specific knowledge are all welcome.

## How contributions work

1. **Open an issue first** for anything larger than a small fix, so we can agree on
   the approach before you invest time. Small fixes and translations can go straight
   to a pull request.
2. **Fork, branch, and open a pull request** against `main`. Keep each PR to one
   change, with tests where behaviour changes.
3. **Sign the CLA** (once). See [Contributor License Agreement](#contributor-license-agreement)
   below.
4. A maintainer reviews the PR. CI must be green before merge.

Contributions that do not involve code are just as valuable: a precise specification
of tax, invoicing or reporting rules for your country (naming the law or standard), a
reproduction of a bug, or a review of a translation. If you can describe the correct
behaviour precisely, that is a contribution, and we credit it in
[CONTRIBUTORS.md](CONTRIBUTORS.md).

[DEVELOPING.md](DEVELOPING.md) is the guide to working on the codebase itself,
including how to brief an AI coding assistant on it.

## Quick Start

```bash
# 1. Clone
git clone https://github.com/datadrivenconstruction/OpenBusinessERP.git
cd OpenBusinessERP

# 2. Start dev environment
docker compose up -d   # PostgreSQL + Redis

# 3. Backend
cd backend
pip install -e ".[dev]"
uvicorn app.main:create_app --factory --reload --port 8000

# 4. Frontend (new terminal)
cd frontend
npm install
npm run dev
```

## Code Style

### Python (Backend)
- Formatter: `ruff format` (line-length=120, set in `backend/pyproject.toml`)
- Linter: `ruff check`
- Type hints required for all public functions
- Docstrings: Google style

### TypeScript (Frontend)
- No automatic formatter. Match the style of the file you are editing.
- Linter: ESLint with `@typescript-eslint/recommended`
- Strict mode enabled

### Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add GAEB X86 export support
fix: correct unit rate calculation for assemblies
refactor: extract validation engine into separate module
docs: update API reference for invoice endpoints
test: add integration tests for cost database import
chore: update dependencies
```

## Before you call a change finished

This applies to work on your own fork as much as to work by the core team, because these
are the checks that catch the mistakes this codebase actually makes. Nothing here needs
our infrastructure; run them where you are.

- [ ] `ruff format --check` then `ruff check`, from inside `backend/`, which is where the
      configuration lives. Run from the repository root instead and ruff finds no config
      and silently applies a different line length.
- [ ] `pytest`, from inside `backend/`
- [ ] `npm run lint`, from inside `frontend/`
- [ ] `npm run build`, from inside `frontend/`. This is the frontend gate, not
      `npm run typecheck`. The first is `tsc -b` followed by a bundle, the second stops
      at `tsc --noEmit`, and the two disagree often enough that reading a green
      `--noEmit` as a green build has broken `main` more than once.
- [ ] `python scripts/check_repo_hygiene.py` and the other `scripts/check_*.py` guards
      for whatever you touched. They are named for what they check.
- [ ] Every user-facing string goes through a translation key, and the key is added to
      every locale file rather than to `en.ts` alone. A key that exists only in English
      falls back silently in all the others, on screen, with every gate green.
- [ ] Conventional commit message, and no secrets or credentials anywhere in the diff.

A remote run that went green somewhere else is not evidence about the tree in front of
you. The check you run before you push is the one that counts.

## Module Development

Each module lives in `backend/app/modules/` as a directory carrying a `manifest.py`.
There were 193 such directories at the last count, which you can recount with
`ls backend/app/modules/*/manifest.py | wc -l`.

Only `manifest.py` and `__init__.py` are required. Everything else is convention, and
the loader picks up each file if it is there and stays quiet if it is not. Write them in
this order, because each layer depends on the one above it:

```
modules/my_module/
├── manifest.py      # Required. Metadata, version, dependencies, category
├── __init__.py      # Required. Package marker, and on_startup() if you need one
├── models.py        # SQLAlchemy models
├── schemas.py       # Pydantic request and response schemas
├── repository.py    # Data access, no business logic
├── service.py       # Business logic, event publishing
├── router.py        # FastAPI routes, mounted at /api/v1/my-module/
├── permissions.py   # Permission definitions
├── events.py        # Subscriptions to other modules' events
└── validators.py    # Validation rules this module contributes
```

How common each one is across those 193 modules, so you can see what a normal module
actually carries: `router.py` 192, `service.py` 175, `schemas.py` 175,
`permissions.py` 153, `models.py` 152, `repository.py` 114, `events.py` 58,
`validators.py` 44. To recount one, run

```bash
for d in backend/app/modules/*/; do
  [ -f "$d/manifest.py" ] && [ -f "$d/service.py" ] && echo "$d"
done | wc -l
```

The `manifest.py` test in there is what makes the count mean "modules". Two packages
live under the same directory without being modules, `measurement` and
`price_breakdown`, so a plain glob counts files rather than modules. It agrees with
the recipe above for `service.py` today only because neither helper carries one.

A module with no persistence of its own has no `models.py` or `repository.py`, and that
is normal rather than incomplete.

`hooks.py` and `pipeline_nodes.py` are also loaded if present, for filter and action
hooks and for contributing node types to the pipeline builder. Neither is in common use:
no module currently ships a `hooks.py`, and one ships a `pipeline_nodes.py`. Reach for
them only when you know you need them.

Two things that are **not** part of a module directory, despite what you might expect:

- **Tests** live in `backend/tests/`, not inside the module. That is where pytest looks:
  `backend/pyproject.toml` sets `testpaths = ["tests"]`. Eight module directories do
  carry a `tests/` folder of their own, and the tests in them are real, but a default
  `pytest` run does not collect them. Put yours under `backend/tests/` so they run.
- **Migrations** live in `backend/alembic/versions/`. The scaffold generates a template
  revision in the module for you to move there once you have set its `down_revision`.

See existing modules (`crm`, `finance`, `contacts`) for reference implementations, and
[the module development quickstart](docs/module-development/quickstart.md) for the
file-by-file walkthrough.

## Reporting Issues

- Use [GitHub Issues](https://github.com/datadrivenconstruction/OpenBusinessERP/issues)
- Include: version, steps to reproduce, expected vs actual behavior
- For security issues, see [SECURITY.md](SECURITY.md)

## Contributor License Agreement

Before we can merge your first pull request you need to accept the
[Contributor License Agreement](CLA.md). Companies contributing through their
employees also sign Part B of the same document.

**Why.** OpenBusinessERP is offered under AGPL-3.0-or-later and, for organisations
that cannot meet the AGPL's terms, under a commercial licence. The CLA lets the
maintainer offer both. You keep the copyright in your work, and the CLA commits
that every release containing your contribution stays available under an open-source
licence as well.

**How to sign.** When you open a pull request, the CLA Assistant bot posts a comment.
Read [CLA.md](CLA.md) and reply on the pull request with:

    I have read the CLA Document and I hereby sign the CLA

The bot records your signature in `signatures/cla.json` on the `cla-signatures`
branch. You sign once, and later pull requests pass automatically. Post `recheck` if
the status does not update.

**No DCO.** We do not use the Developer Certificate of Origin, so `Signed-off-by`
lines are not required (they are harmless if your tooling adds them).

## Licensing

OpenBusinessERP is licensed under the GNU Affero General Public License v3.0 or later
(see [LICENSE](LICENSE)); a commercial licence is available from
info@datadrivenconstruction.io. Do not include code you cannot license under the CLA,
and name any third-party material, with its licence, in your PR description.

## Questions?

- Open a [Discussion](https://github.com/datadrivenconstruction/OpenBusinessERP/discussions)
- Join our community chat (coming soon)

Thank you for helping make business software open and accessible!
