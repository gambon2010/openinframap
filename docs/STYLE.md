# Style

How the application looks: its panels and controls, and what it draws on the map.
Every new panel, button or map layer follows this; a change to the look changes
this file first. The values live in code (named below): this file says which to
use, not their numbers twice.

## Principles

- **Quiet by default, clear when chosen.** The map and panels stay light and
  calm; what the person picked (a tick, a selected line, a tool on) stands out.
- **Say it as a person would.** Titles are names people use ("A35 – Autoroute
  des Cigognes", "Tram B", "Building"), never a layer id, a tag key or a data
  source. Raw data (properties, layer ids, sources) shows only with debug on,
  under a "Debug info" heading (`modules/debug`).
- **One look for one thing.** Every panel, button, list and highlight comes from
  the shared pieces below; nothing styled locally to look nearly the same.

## Panels and controls

The reference is My layers (`modules/userlayers/ui`); the shared pieces are in
`fork/ui/`.

- **Colours and sizes:** the tokens in `web/src/index.css` (`--oim-content-background`,
  `--oim-light-grey`, `--oim-grey`, `--oim-text-color`, `--oim-text-color-light`,
  `--oim-radius-large`, `--oim-radius-small`, `--oim-drop-shadow`), and the fork's
  own where upstream has none (`ui/panel.css`): `--oim-error`, `--oim-success`,
  `--oim-link`, `--oim-warning-background`, `--oim-note-accent` (a note's edge,
  as on extra data's notices), `--oim-on-background`, and for the dark overlays
  (the tooltip, the debug box: dark, as tooltips are) `--oim-overlay-background`,
  `--oim-overlay-text`, `--oim-overlay-accent`. No other colours, greys, radii or
  shadows in panels and controls.
- **A panel:** `makePanel` (`ui/panel.ts`) for docked and floating panels. The
  left column's side panels (`ui/details.ts`) match it (`ui/details.css`): white
  body, large radius, drop shadow, 330–340 px wide, scrolling inside.
- **Title bar:** light grey (`--oim-light-grey`), the title bold at 1.05 rem,
  flat square buttons at its right end (close ×, minimise –), grey on hover. No
  coloured headers (upstream's green popup header is overridden).
- **Body:** 6–10 px padding; sections titled at 0.95 rem with a thin grey rule
  under them.
- **Values:** label and value rows, the label in the light text colour, no boxes
  or striped backgrounds; only rows a person needs.
- **Buttons:** small, bordered, square-ish: `.oim-ul-button` (the details panel's
  `.oim-button` is given the same look). A main action is `.primary` (blue).
  Disabled at half opacity.
- **Chosen, on, selected:** class `oim-on`, the map selection's yellow background
  (`ui/panel.css`); the size and border never change, so nothing moves. The map's
  buttons when their panel is open: `oim-pressed`.
- **Hints and notes:** 0.85 rem in the light text colour (`.oim-ul-hint`).
- **Each key row its own icon and colour:** the key hides by icon and colour, and
  remembers it in the browser; a new layer reusing another row's icon is hidden with
  it (the oil and gas facilities had the fuel depots' icon: hidden while that row
  was unticked).
- **A kind in a colour of its own within its category** (disused military and former
  airfields, grey among the military's green) is grouped apart zoomed out, in discs
  of its colour (`GROUP_COLOURS`, `KIND_GROUPS`, `site_group` in `sites.sql`), so its
  discs never hide in the category's.
- **A kind with no key row of its own** (closed airfields, a grey icon) is shown and
  hidden by another kind's row (the open airfields': `KEY_ROW_OF`); that row hides
  both icons (a hide spec of several icons), so one thing has one tick box.
- **A kind listed under two categories** (military airfields: Transport and Military)
  has one tick box in both sections, ticked alike, and keeps its own category's icon
  and colour (green under Transport too); both categories' layers draw it, so hiding
  either still shows it, and it's never grouped (the other category's discs wouldn't
  show it). Its fill is drawn once, its outline by both (`shared_kinds`).
- **Icons:** one set of line icons (`ui/icons.ts`: 24-unit outlines, 2 wide, round
  ends, in the text's colour), one picture per button, never a near-copy of another
  button's (Data layers a stack, My layers a pencil) nor a decoration added to tell
  two apart.
- **The map's buttons (top right):** in groups with a gap between: the view (zoom,
  3D), what's on the map (Data layers, My layers, satellite), then print, Settings and
  your account (`ui/panel.css`, by order). A mode is a button pressed, not a setting.
- **Text:** the page font (`--oim-font-family`); monospace only for raw data
  (debug) and coordinates.

## The map

The background map is the high-contrast one (`map-sources/palette`): each kind of
area its own pale shade. On it the fork draws its own roads, railways, trams and
metro (`modules/roads`), the same at every zoom over the map and imagery.

- **Two looks per kind** (`roads.constants.ts`, `Looks`): *light* over the map
  while its Data layers entry is unticked (roads white with a grey edge), *bold*
  once ticked (colours by importance). Over imagery only the ticked ones, bold.
  Railways and trams unticked show the background map's own instead.
- **Roads by importance (bold):** motorways orange, trunk roads amber, primary
  yellow, secondary pale yellow, tertiary and smaller white, paths grey; a dark
  edge around each. Widths follow the background map's, never thinner than a
  minimum per kind.
- **Railways:** a dark line with white dashes, a near-black outline; one line
  where tracks run close (zoomed out). Never white outlines.
- **Trams and metro:** each line in its own colour (its route's, else one fixed
  per letter), side by side in lanes where lines share a track (LOOM), with a
  dark outline around the bundle.
- **Tunnels:** the same line, see-through (`TUNNEL_OPACITY`), at the same level
  as above ground; trams' tunnels keep a full outline. Never dotted.
- **Switching layers fades:** a data layer ticked fades in, unticked fades out
  (`ui/fade.ts`, 300 ms, MapLibre's paint transition); never a jump.
- **Hand-overs at the tile switch:** a zoom's vector tiles show from half a zoom
  before it, so a layer handing over to another (zoomed out to close in) does it
  there (`core/tile-zooms.ts`), or neither draws for half a zoom. Checked for the
  whole style (`handovers.test.ts`).
- **Ends and joins:** round caps and joins, so pieces meet without gaps.
- **Order:** tunnels, then roads from the smallest up, railways, trams, borders;
  bold layers over light ones; a highlight over everything of its kind.
- **Highlight (what was clicked):** the yellow glow (`ui/highlight.ts`,
  `#ffd400`), the thing itself redrawn over it in its own colour; a line
  highlighted whole, its stops as white dots with a dark ring.
- **Labels:** dark text with a thin white halo (about 1.5 px), never a wide
  blurred one (it shows as a white box); over imagery white text on a dark halo.
  A label for something picked goes on top of every other label.
- **One thing, one place:** a feature two data layers would draw is drawn by one
  (an oil depot: Oil & Natural Gas, not Critical sites); things of one kind look alike
  whichever layer draws them (oil and gas facilities in the fuel depots' colour and
  icon).
- **Hill shading** (`modules/terrain`, Data layers → Terrain → Hill shading, on at
  first): MapLibre's `hillshade` from the terrain's elevations, light from the
  north-west (several directions blended, so slopes away from it don't go flat),
  soft warm-grey shadows and faint highlights, see-through. Over the map it lies on
  the land cover and water, under roads, buildings, labels and all data; over
  imagery right above the photos, fainter. Zoomed in past 13 it's as smooth as at
  13 (the terrain's finest).
- **Contour lines** (`modules/terrain`, Data layers → Terrain → Contour lines, off at
  first), as on US military maps (FM 3-25.26), in the USGS's US Topo browns: every
  fifth line an *index contour*, heavier, its height in metres written along it in
  dark brown on a thin white halo; the four between thin *intermediate contours*;
  *supplementary contours* at half the interval, dashed, on level ground only (from
  zoom 12); *depression contours* (closed round lower ground) with short ticks on
  their downhill side. The interval follows the maps' scales: 100 m at zooms 9–10,
  50 m at 11, 20 m at 12–13, 10 m from 14 (made in the backend). They lie with the
  hill shading, under the roads, buildings and data; over imagery a lighter brown.
  From zoom 9 (nothing further out).
- **Leave out clutter the original map leaves out:** small pieces with no name
  that read as noise at that zoom are not drawn (stand lead-ins at airports,
  sidings and depots until asked for).

## Checking a change

Look at it on the map at a zoomed-out, a middle and a close zoom, over the map
and over imagery, with its entry ticked and unticked; a panel open alongside My
layers to compare.
