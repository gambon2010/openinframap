// Fork: the trams', metros' and light rails' lanes from zoom LANES_FROM (modules/roads):
// each line in its lane, side by side where lines share a track, joined through
// junctions, as LOOM draws them (University of Freiburg; the backend's
// loom_input.py, loom_tiles.py; served at /background/transit). LOOM writes the
// lanes' offsets into the tiles, a set per zoom: within a zoom the map grows them
// by up to twice before the next zoom's tiles come, so the lanes' width grows as
// much (laneWidth) to keep them touching. Further out, one plain line per track
// (rail-layers.ts).
import type { ExpressionSpecification } from 'maplibre-gl'
import { BACKEND_BASE_URL } from '../../config.ts'
import { Builder, FULL, fading, tunnelOpacity } from './builder.ts'
import type { TrackSet } from './rail-layers.ts'
import { transitSetPrefix } from './rail-layers.ts'
import * as look from './roads.constants.ts'
import { LANES_FROM } from './roads.constants.ts'

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

/** A lane's width by zoom: LANE_WIDTH at each zoom's tiles, growing with the map
 * (twice as wide a zoom later) until the next zoom's tiles come. */
export function laneWidth(): ExpressionSpecification {
  const stops: number[] = []
  for (let z = LANES_FROM; z < LANES_TO; z++) stops.push(z, LANE_WIDTH, z + 0.999, LANE_WIDTH * 2 ** 0.999)
  // Past the last tiles, enlarged: the lanes spread as much as the map grows.
  stops.push(LANES_TO, LANE_WIDTH, LANES_TO + 4, LANE_WIDTH * 2 ** 4)
  return ['interpolate', ['exponential', 2], ['zoom'], ...stops] as ExpressionSpecification
}

/** LOOM's layers: the lanes, and their joins through junctions. */
const LOOM_LAYERS = ['lines', 'inner-connections']

/** A set's lanes (its kind's, e.g. 'tram'), in a tunnel or above ground: an outline,
 * then the lanes over it (each lane's outline under its neighbour: one around them
 * all). */
export function addLanes(b: Builder, set: TrackSet, tunnel: boolean) {
  if (!set.kind) return
  const width = laneWidth()
  const filter: ExpressionSpecification = [
    'all',
    ['==', ['get', 'kind'], set.kind],
    ['==', ['coalesce', ['get', 'tunnel'], false], tunnel]
  ]
  const opacity = fading(tunnelOpacity(FULL, tunnel))
  const id = `${transitSetPrefix(set)}lanes_${tunnel ? 'tunnel' : 'ground'}`
  for (const sourceLayer of LOOM_LAYERS) {
    const from = { source: LANES_SOURCE, sourceLayer, minzoom: LANES_FROM }
    const part = sourceLayer === 'lines' ? '' : '_joins'
    if (!tunnel) {
      const edge = {
        'line-color': look.RAIL_EDGE_COLOUR,
        'line-gap-width': width,
        'line-width': look.EDGE_WIDTH,
        'line-opacity': opacity
      }
      b.line(`${id}${part}_edge`, filter, edge, from)
    }
    const lane = {
      'line-color': {
        light: look.TRAM_COLOUR.light,
        bold: ['to-color', ['get', 'colour'], look.TRAM_COLOUR.bold] as ExpressionSpecification
      },
      'line-width': width,
      'line-opacity': opacity
    }
    b.line(`${id}${part}`, filter, lane, from)
  }
}
