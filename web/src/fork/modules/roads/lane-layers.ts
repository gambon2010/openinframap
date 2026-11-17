// Fork: the trams', metros' and light rails' lanes from LOOM's tiles (zoom LANES_FROM
// on, shown from LANES_SHOWN_FROM) (modules/roads):
// each line in its lane, side by side where lines share a track, joined through
// junctions, as LOOM draws them (University of Freiburg; the backend's
// loom_input.py, loom_tiles.py; served at /background/transit). LOOM writes the
// lanes' offsets into the tiles, a set per zoom: each zoom's tiles show from half a
// zoom before it to half after (TILES_SHOWN_EARLY), reduced then enlarged, so the
// lanes' width follows (laneWidth) to keep them touching. Further out, one plain
// line per track (rail-layers.ts).
import type { ExpressionSpecification } from 'maplibre-gl'
import { BACKEND_BASE_URL } from '../../config.ts'
import { Builder, FULL, fading, tunnelOpacity } from './builder.ts'
import type { TrackSet } from './rail-layers.ts'
import { transitSetPrefix } from './rail-layers.ts'
import * as look from './roads.constants.ts'
import { LANES_FROM, LANES_SHOWN_FROM, TILES_SHOWN_EARLY } from './roads.constants.ts'

export const LANES_SOURCE = 'transit'
/** The last zoom of LOOM's tiles (loom_tiles.py's ZOOMS); further in, enlarged. */
export const LANES_TO = 18
/** A lane's width at each zoom's own tiles (pixels): LOOM's line width, 1.5 of its
 * pixels (256 to a tile; scripts/offline_maps/transit.py), 3 of the map's (512). */
export const LANE_WIDTH = 3

/** The source of the lanes' tiles. */
export function lanesSource() {
  return {
    type: 'vector' as const,
    tiles: [`${BACKEND_BASE_URL}/background/transit/{z}/{x}/{y}.mvt`],
    minzoom: LANES_FROM,
    maxzoom: LANES_TO
  }
}

/** A lane's width by zoom: LANE_WIDTH where each zoom's tiles are at their own size,
 * growing and shrinking with the map as they're shown enlarged or reduced (half a
 * zoom either side: TILES_SHOWN_EARLY), so the lanes keep touching; `plus` pixels
 * wider throughout (a glow around it: lane-highlight.ts). One zoom curve: MapLibre
 * takes none inside another expression, so `plus` goes into its stops. */
export function laneWidth(plus = 0): ExpressionSpecification {
  const early = TILES_SHOWN_EARLY
  const stops: number[] = []
  const at = (zoomsFromOwn: number) => LANE_WIDTH * 2 ** zoomsFromOwn + plus
  for (let z = LANES_FROM; z < LANES_TO; z++)
    stops.push(z - early, at(-early), z + early - 0.001, at(early - 0.001))
  // Past the last tiles, enlarged: the lanes spread as much as the map grows.
  stops.push(LANES_TO - early, at(-early), LANES_TO + 4, at(4))
  return ['interpolate', ['exponential', 2], ['zoom'], ...stops] as ExpressionSpecification
}

/** LOOM's layers: the lanes, and their joins through junctions. */
export const LOOM_LAYERS = ['lines', 'inner-connections']

function lanesFrom(sourceLayer: string) {
  return { source: LANES_SOURCE, sourceLayer, minzoom: LANES_SHOWN_FROM }
}

function partOf(sourceLayer: string) {
  return sourceLayer === 'lines' ? '' : '_joins'
}

function kindIs(set: TrackSet): ExpressionSpecification {
  return ['==', ['get', 'kind'], set.kind ?? '']
}

/** A set's outline around its lanes and joins, in a tunnel too (whole: a tunnel's
 * lanes are see-through inside it). Every set's outlines go under every set's lanes
 * (addLanes): an outline drawn over a lane, where a join meets it, would cut it. */
export function addLaneEdges(b: Builder, set: TrackSet) {
  if (!set.kind) return
  for (const sourceLayer of LOOM_LAYERS) {
    const edge = {
      'line-color': look.RAIL_EDGE_COLOUR,
      'line-gap-width': laneWidth(),
      'line-width': look.EDGE_WIDTH,
      'line-opacity': fading(FULL)
    }
    b.line(
      `${transitSetPrefix(set)}lanes${partOf(sourceLayer)}_edge`,
      kindIs(set),
      edge,
      lanesFrom(sourceLayer)
    )
  }
}

/** A set's lanes (its kind's, e.g. 'tram') over the outlines: in a tunnel
 * see-through, then above ground. */
export function addLanes(b: Builder, set: TrackSet) {
  if (!set.kind) return
  for (const tunnel of [true, false]) {
    const filter: ExpressionSpecification = [
      'all',
      kindIs(set),
      ['==', ['coalesce', ['get', 'tunnel'], false], tunnel]
    ]
    const lane = {
      'line-color': {
        light: look.TRAM_COLOUR.light,
        bold: ['to-color', ['get', 'colour'], look.TRAM_COLOUR.bold] as ExpressionSpecification
      },
      'line-width': laneWidth(),
      'line-opacity': fading(tunnelOpacity(FULL, tunnel))
    }
    const id = `${transitSetPrefix(set)}lanes_${tunnel ? 'tunnel' : 'ground'}`
    for (const sourceLayer of LOOM_LAYERS)
      b.line(`${id}${partOf(sourceLayer)}`, filter, lane, lanesFrom(sourceLayer))
  }
}
