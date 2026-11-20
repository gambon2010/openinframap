# UI pieces brought to the standard (2026-11-20)

`docs/STYLE.md` ("Panels and controls") is the standard: the colour and size tokens
of `web/src/index.css`, `makePanel` for panels, the light grey title bar, the
`.oim-ul-button` buttons, `oim-on` for what's chosen, the line icons. An audit of the
fork's CSS and panels (hard-coded colours, radii and shadows; panels built by hand)
found these pieces not on it yet. My layers (`modules/userlayers/ui`) is the
reference and stays as it is; the context menu already uses the tokens (its
fallbacks are only for the tests).

## 0. Tokens that are missing (first: the others need them)

(Done, 2026-11-20.) The standard has no colour for an error, a success, a link or a
warning, so each piece picked its own red, green and blue. Added to the fork's own
`ui/panel.css` (not upstream's `index.css`: upstream's files stay as they are):
`--oim-error` (the reds `#b3261e`, `#c92a2a`),
`--oim-success` (`#1b7a33`), `--oim-link` (`#1a5fb4`), `--oim-warning-background`
(`#fff4e5`), `--oim-note-accent` (the extra data's orange edge). STYLE.md lists them.

## 1. The grid route panel (`modules/grid/grid-route.ts`, `grid-route.css`) (paused: grid routing is on hold)

Built by hand as a MapLibre control (redom), with its own colours (error red, warning
background, a yellow left edge for the chosen path, link blue) and a 3 px radius; 386
lines doing the route's state, the map drawing and the panel. Plan: the panel through
`makePanel` (title bar, close and minimise as the standard's), the colours from the
tokens, the chosen path with `oim-on`; split the file in two (the route and its map
layers / the panel), tests first. The path colours on the map stay (they're map
colours, not panel ones). Medium.

## 2. The coordinates box (`modules/coordinates/coordinates.css`) (done, 2026-11-20)

A white box at 80 % with `#222` text and its own monospace stack. Plan: the content
background and text tokens, `--oim-font-family-monospace` (STYLE: monospace for
coordinates); done with terrain step 6, which adds the height to it. Small.

## 3. Settings → Map sources and the account (`map-sources.css`, `account.css`) (done, 2026-11-20)

Status colours of their own (reachable green, error red, link blue). Plan: the
tokens from 0. Small.

## 4. The key's swatches (`ui/key/key.css`) (done, 2026-11-20)

A 3 px radius written out. Plan: `--oim-radius-small`. Small.

## 5. Notes in the details (`modules/extra/extra.css`) (done, 2026-11-20: kept, its colour a token)

An orange left edge and tint for notes about extra data, not in the standard. Plan:
decide whether notes get a look of their own (then STYLE.md says so, with
`--oim-note-accent`) or use the hint style (`.oim-ul-hint`). Small; the owner's call.

## 6. Dark overlays: the tooltip and the debug box (`ui/tooltip.css`, `debug.css`) (done, 2026-11-20: kept dark, tokens, written in STYLE.md)

Both dark on light text, colours written out; the standard says nothing about
tooltips or overlays. Plan: write their look into STYLE.md (dark, the tokens it
needs), or make them light like the panels; the owner's call. Small.

## Left as they are

The print module's page frame (`print.css`: a frame drawn on the map while choosing
the page, not a panel); My layers' own colours (the reference: the selection
yellow, the blue primary button are the standard's).
