# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Open Infrastructure Map shows the world's infrastructure (power, telecoms, water, oil and gas) from OpenStreetMap: a TypeScript/MapLibre frontend, a Python/Starlette backend, a Tegola tile server, a PostGIS database and an Imposm importer. **This is a fork** that runs everything locally, and offline from an exported database, for a chosen region.

**Where things are written down (keep each current, nothing repeated between them):**
- `docs/FORK_ARCHITECTURE.md`: how the fork's code is organised, folder rules, every script, module and SQL file, recipes for adding things. Read it before changing the structure.
- `docs/FORK_CHANGES.md`: every upstream file the fork changes, and how ("Fork structure", "Merging from upstream"): keep it exact.
- `docs/HISTORY.md`: what changed, when and why (dated notes, newest at the end of their section); older one-off sections in `docs/HISTORY-ARCHIVE.md` (not added to).
- `docs/SPECIFICATIONS.md`: every requirement the owner asked for, with its status: add each new request when it's made, update it when done. Plans for bigger features: `docs/plans/` (finished ones in `archive/`).
- `docs/LOCAL_DEVELOPMENT.md`: the user's guide.
- `docs/STYLE.md`: how the application looks (panels, buttons, the map's roads, railways, trams, highlights, labels). Every new panel, control or map layer follows it; a change of look updates it first.

**Keep fork code out of upstream files.** Upstream won't take the fork's changes, so merges must stay easy:
- frontend features: a module in `web/src/fork/modules/`, added to `MODULES` in `fork/index.ts`; upstream files only call its hooks and import only `fork/index.ts`, `types.ts`, `config.ts`; modules never import each other (shared pieces: `fork/ui/`, `fork/services/`, `fork/core/`; checked by `fork/structure.test.ts`);
- backend routes: `web-backend/src/fork/`; SQL: `schema/fork/`; tile layers: `tegola/layers.fork.yml`; Compose: `docker-compose.override.yml`; English strings: `web/src/fork/locales/en.json`;
- a file's types in `X.types.ts`, its constants in `X.constants.ts`, beside it;
- an upstream file changes only with a one-line hook, listed in `docs/FORK_CHANGES.md`.

## Clean code rules (fork code)

These apply to the fork's own files. Upstream's files stay as close to upstream as possible: never split, rename or restructure them; turn an edit into a hook where you can (merges stay easy).

- **Delete what's unused, in the same change:** dead files, functions, options, strings (`locales/en.json`), icons and CSS. When a new way replaces an old one, remove the old one everywhere (no two ways to do one thing, no compatibility layer rebuilding the old shape for old code, no message kept for a removed option: it's simply unknown). One-time upgrade code goes once the data is upgraded; the numbered `userdata` migrations are the exception (never edited, never removed).
- **One copy of everything that must stay in step:** shared helpers in `fork/core/` (frontend), `scripts/lib/` / `offline_maps/` (scripts), never copied. A value more than one language needs (ports, zooms, paths, versions, source names) is defined once, or a test checks the copies agree (`scripts/tests/test_one_source.py`). Code that only looks alike is a different matter: see "Code is written for a human reader" (extract on the third copy).
- **Named values:** no magic numbers, paths or URLs buried in code: a named constant (`X.constants.ts`, a module constant, `lib/common.sh`) or a setting.
- **One job per file:** split a file or class that does several (as a guide, past ~400 lines), with tests first. Names say what the thing is now.
- **Folders as `docs/FORK_ARCHITECTURE.md` says** (`fork/structure.test.ts` checks part of it).
- **One look, `docs/STYLE.md`:** panels and buttons from the shared pieces (`makePanel`, My layers' look), the colour tokens of `index.css`, titles a person would say (raw data only with debug on); map layers in the light and bold looks of `modules/roads`.
- **One way for each recurring thing:** clickable areas and lines (`core/map-style.ts`), downloads (`download`/`safely`, `netsafe.py`), Docker calls (`lib/docker.sh`, `offline_maps/docker.py`), panels (`makePanel`), errors.
- **No debris:** no commented-out code, stale TODOs, debugging `console.log`/`print`, or comments describing behaviour that has changed.
- **Strict:** no `any` or `@ts-ignore` in fork TypeScript; Python typed; everything CI runs passes (`.github/workflows/fork-tests.yml`: eslint, prettier, tsc on `src/fork`, ruff, mypy, shellcheck, the three test suites).
- **Errors handled, not swallowed:** catch only what you expect, and say in a comment what happens then; scripts start with `set -euo pipefail`; exit 75/76 for network stops (`lib/net.sh`).
- **No secrets or junk in git:** never commit `.env` files, `*.bak`, keys or build output; add files by explicit path. Leftovers on disk (old downloads, Docker images, caches) are reported, never deleted without asking.
- **Tests:** next to new code (see Commands); remove redundant ones; keep the suites fast.
- **Docs current:** they describe what is, not what was (history goes in `docs/HISTORY.md`); no section repeated in two files.
- **Clean-ups in this order:** tests, then deletions, then merging duplicates, then structure (splits, renames, folders), docs last.

## Reuse before writing

Before writing an algorithm or a feature that's a known problem (contour lines,
clustering, line smoothing, label placement, tile serving, retries, file locks,
parsing a format...), look up how open source projects do it, and reuse rather than
invent:

1. **A package or plugin that does it**, maintained and fitting our stack: use it
   (add it as a dependency, named in the docs); a small wrapper is fine.
2. **None fits**: find how larger projects do it (MapLibre, Planetiler, GDAL, QGIS,
   OpenTopoMap, Protomaps, OpenStreetMap's tools...) and follow their method and
   parameters, saying in a comment where it comes from (project, file or doc).
3. **Only then** write our own, and say in the plan or the commit why nothing could
   be reused.

Write down what was looked at (the plan, or `docs/HISTORY.md`), so the next person
doesn't search again. Parts written before this rule: `docs/plans/reuse-review.md`.

## Code is written for a human reader

The reader is one person maintaining this project, reading a file cold, months later, without you there to explain it. Optimise for that person, not for brevity or cleverness.

- **Name the ideas.** If a block of code does one thing a person would describe in a phrase ("find the tiles that are missing"), make it a function or a named variable with that phrase as its name. Don't leave concepts implicit in inline expressions.
- **Top-level functions read like a summary.** A main function should be a short list of named steps. Details live one level down.
- **One level of thinking per function.** Don't mix the "what" (download the region) with the "how" (retry loops, byte offsets) in the same body.
- **Limits.** Functions over ~40 lines, nesting deeper than 3 levels, or more than 4 parameters need a reason, or get split.
- **No dense expressions.** No nested ternaries, no chained comprehensions, no multi-step one-liners. Use intermediate variables with meaningful names.
- **Use the project's vocabulary.** Reuse the words already in the code and UI (region, imagery, source, zoom). Don't introduce a second word for the same thing.
- **Comments say why, not what.** Explain the reason, the constraint or the surprise. If a comment explains what the code does, rename or extract until it isn't needed.
- **No speculative abstraction.** No base classes, options or generic helpers for cases that don't exist yet. Two concrete copies beat one premature abstraction; extract on the third.
- **Boring over clever.** Prefer the obvious approach even when it is a few lines longer.

Before finishing any change, reread the diff as that reader and ask: could they say what each function does from its name and first five lines? If not, fix it before reporting done.

**Fix readability as you go.** Code you come across while working that breaks these rules may be rewritten without asking, as long as the project behaves exactly the same (the tests pass unchanged). At the end of the task, list those changes briefly (file and what was made clearer). Anything that would change behaviour, or a bigger clean-up, is reported instead (below).

**Report what should be cleaned.** While working on a feature, note anything you see that breaks these rules or should be refactored (in the code you touch or nearby) but isn't part of the request and isn't a readability fix that changes nothing. Don't change it unasked; when the feature is done, list it at the end of your final message (what, where, why, rough size) so the user can decide whether to do it.

## Development Setup

Prerequisites: `docker`, `node`, `npm`, `curl`, `python3`, `unzip`, `uv` (the scripts' Python environment, `scripts/pyproject.toml`).

```bash
bash scripts/launch.sh        # first time: build/import a region, .env files, start the app
bash scripts/start.sh         # every day: Docker services, the frontend in a new terminal, the browser
bash scripts/offline-maps.sh  # the offline maps menu: imagery, aerial photos, background maps
```

Services (`docker-compose.override.yml`; all on 127.0.0.1 but the gate):

| Service | Port | What |
|---|---|---|
| `gate` | 8800 (https) | nginx, **where the app is opened**; the one way in from the network, every request needs a logged-in session (`gate/nginx.conf`, certificate made in `data/gate/`) |
| `db` | 5432 | PostGIS |
| `tegola` | 7800 | the infrastructure tiles |
| `backend` | 8001 | API, login, search, and the background map (`/background`, from `data/offline-maps/`) |
| `satellite` | 8810 | satellite imagery (`pmtiles serve` of `data/offline-maps/*.sat-*.pmtiles`) |
| frontend | 5173 | `cd web && npm start`, reached through the gate |

Stop: Ctrl+C in the frontend window, then `docker compose stop`.

## Commands

### Frontend (`web/`)
```bash
npm start            # Dev server on port 5173
npm run build        # Production build
npm run lint         # ESLint + Prettier
npm run test:fork    # The fork's unit tests (src/fork/**/*.test.ts, happy-dom, no network)
npm run test         # Upstream's (Vitest + Puppeteer)
npm run fork-strings # Add new t('key', 'text') strings to src/fork/locales/en.json
npm run extract      # Upstream's translation strings
```

### Backend (`web-backend/`)
```bash
docker compose up -d --build backend               # Normal: runs in Docker (rebuild after changes)
uv run uvicorn src.main:app --reload --port 8001   # Developing it: `docker compose stop backend` first
uv run ruff check && uv run ruff format            # Lint, format
uv run mypy .                                      # Type check
uv run pytest tests/fork                           # The fork's tests
```

### Scripts and data (from the repo root)
```bash
uv run --project scripts pytest scripts/tests   # Script tests (fake docker/curl, scripts/tests/fakes/)
OIM_TEST_REAL_BUILD=1 uv run --project scripts pytest scripts/tests -k real_build   # Real Luxembourg build/export/import, its own Docker project
bash scripts/build-region.sh                               # Pick a region, wipe the DB, download + import
bash scripts/build-region.sh --region luxembourg --yes     # Unattended (tiny test region)
bash scripts/export-db.sh / import-db.sh FILE              # Save / restore data/exports/<region>.oimdb
bash scripts/number-towers.sh                              # Number the towers again
uv run --project scripts scripts/offline-maps.py maps --source ID --yes     # An offline map without questions
uv run scripts/fetch_images.py [--json-only|--count]       # Offline Wikidata cache in data/
docker compose down -v                                     # Wipe the DB and all project volumes
cd tegola && python3 ./generate_tegola_config.py ./tegola.yml ./layers.yml ./layers.fork.yml > ./config.toml   # After changing a layer
```

**Tests for fork code:** next to new code where there's logic to get wrong (parsing, geometry, state; not glue or layout): frontend `src/fork/**/*.test.ts`, backend `web-backend/tests/fork/`, scripts `scripts/tests/` (shell helpers tested by running them in bash; keep scripts testable: paths from `REPO_ROOT`, programs called by name). Upstream's code isn't covered.

## Environment Variables

`launch.sh` creates both files if missing (`start.sh` refreshes the imagery list):
- `web/.env`: `VITE_TEGOLA_URL`, `VITE_BACKEND_BASE_URL`, `VITE_BASEMAP_URL` (optional; the default is the backend's `/background`; only local tiles), optional `VITE_PHOTON_URL`. The satellite imagery isn't a setting: the map reads the list the scripts write (`data/offline-maps/imagery.json`, the backend's `/imagery`). Settings → Map sources overrides them per tab.
- `web-backend/.env`: `DATABASE_URL` (`postgresql+asyncpg://`) for running the backend on the host.

## Gotchas

- Bash reads scripts as it runs them: don't edit `scripts/*.sh` while one is running.
- Docker mounts need `:z` (Fedora/SELinux).
- `data/` is gitignored: downloads, exports, offline maps, caches. Never commit `.env` files or `*.bak`.
- Icons (`web/src/icons/*.svg`) are listed when the dev server starts (vite-plugin-render-svg): after adding or renaming one, restart it (it's then missing from the map and the key until then).
- Tegola's `config.toml` is generated (command above); Tegola caches tiles (to zoom 13, inside its container), so after changing a tile layer or the data under it, regenerate the config and recreate it (`up_services --force-recreate tegola`): don't ask the owner to clear caches. The browser keeps the key's tick boxes (localStorage): a new layer drawn with an icon or colour another key row hides is hidden with it, so give each new layer its own (docs/STYLE.md).
- Build SQL must scale to a country like France (millions of rows): `ANALYZE` temp tables after creating them, join instead of `IN`/`NOT IN (subquery)`, never join on `ST_Equals`, give `ST_DWithin` a constant distance. Distances and areas are written in real metres (`schema/fork/distances.sql`: `ST_DWithin(a, b, D * oim_max_stretch()) AND ST_DWithin(a, b, oim_units(D, b))`; `oim_metres`, `oim_ground_area`): map units stretch with latitude, and a test fails on a bare number. Test new build steps on more than Luxembourg.
- My layers' schema changes are new numbered files in `web-backend/src/fork/userdata/migrations/`, never edits of one already run.

## CI

`.github/workflows/fork-tests.yml` runs the fork's three test suites and linters on every push and pull request. Upstream's workflows (`web.yml`, `web-backend.yml`, ...) build and push images only in upstream's own repository.
