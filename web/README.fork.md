<!-- Fork: this directory as the fork runs it (local, offline). Upstream's README.md is left as it is. -->
# Web Frontend

The web frontend for Open Infrastructure Map, written in TypeScript and built with Vite.

## Local development

`bash scripts/launch.sh` (repo root) creates `.env` for you and `bash scripts/start.sh`
starts everything. To do it by hand, copy the example env file:

```bash
cp .env.example .env
```

and set `VITE_BACKEND_BASE_URL=http://localhost:8001` (local backend) and
`VITE_TEGOLA_URL=http://localhost:7800` (local Tegola). The background map comes from
`VITE_TILE_BASE_URL` (openinframap.org) unless `VITE_BASEMAP_URL` points at your own
Protomaps-schema tile server; see `.env.example`.

Install dependencies and start the dev server:

```bash
npm install
npm start   # → http://localhost:5173
```

The Vite dev server proxies `/stats`, `/about`, `/static`, and `/local-images` to the
backend URL configured in `.env`, so backend-rendered pages load correctly.

## Fork-specific behaviour

**Search** (`src/search/`) combines coordinates, the local backend (`/search/typeahead`:
infrastructure and places such as cities and villages) and, if configured, a Photon server
for addresses (`VITE_PHOTON_URL` or Settings). Upstream's OpenCage geocoder is
removed. Providers run with `Promise.allSettled`, so one failing doesn't hide the others'
results, and same-name results within ~5 km are merged.

The **background switcher** (OpenStreetMap / nighttime lights) is hidden: night lights
only exist online. Re-enabling it needs care, because saved map links made without it
have no background layer in their list and would show an empty background.

**Settings** (`src/fork/ui/settings.ts`, a link in the header after about / stats /
export) holds the map sources (`src/fork/map-sources/`): the background-map URL in use,
which can be changed for the current tab, and the optional Photon server. The background map
comes from `VITE_BASEMAP_URL` (set by `scripts/build-region.sh` when you download an
offline one) or openinframap.org.

**Panels.** Layers, Key and My layers open on click in a dock next to the buttons on
the right (`src/fork/ui/dock.ts`), one at a time. Upstream's key and layer list are moved
into it unchanged. Feature details open in a side panel on the left (`src/fork/grid/`)
instead of a popup, above the Grid connection panel. All panels share one look
(`src/fork/ui/panel.css`; `makePanel()` in `panel.ts` for new ones).

## Testing

Code style is checked with [Prettier](https://prettier.io/) and [ESLint](https://eslint.org/):

```bash
npm run lint
```

There is a minimal test suite using [Vitest](https://vitest.dev/):

```bash
npm test   # requires the dev server to be running
```

## Translation

Translation is handled using [i18next](https://www.i18next.com/). If you add a translation
string, add it to [locales/en/translation.json](./locales/en/translation.json) so it is
picked up by Weblate in the upstream project.

To extract new strings:

```bash
npm run extract
```
