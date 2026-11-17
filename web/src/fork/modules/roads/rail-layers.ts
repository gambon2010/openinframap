// Fork: the railways, trams and metro (modules/roads), from a layer of the background
// map's tiles the backend adds (web-backend/src/fork/background/zoomed_railways.py:
// ranked from OpenStreetMap's tags, close tracks drawn as one). Railways: a line with
// white dashes, one set of layers per rank (main lines drawn over the others), so the
// key can hide each. Trams, metro and light rail zoomed out: a plain line, one set
// per kind (from LANES_SHOWN_FROM, LOOM's lanes: lane-layers.ts). Sidings, yards and depots
// of both their own set, at every zoom.
import type { ExpressionSpecification } from 'maplibre-gl'
import { Builder, FULL, LineFrom, fading, mapLineWidth, tunnelOpacity, resized } from './builder.ts'
import * as look from './roads.constants.ts'
import { LANES_SHOWN_FROM } from './roads.constants.ts'

export const RAILWAYS_PREFIX = 'railways_'
export const TRANSIT_PREFIX = 'transit_'
export const RAILWAYS_LAYER = 'railways'
/** Trams, metro and light rail: drawn apart from the railways (the backend's
 * TRANSIT_KINDS, web-backend/src/fork/background/transit_lines.py; the background
 * map's own rail lines say the same in kind_detail). */
export const TRANSIT_KINDS = ['tram', 'subway', 'light_rail']

const isTransit: ExpressionSpecification = ['in', ['get', 'kind'], ['literal', TRANSIT_KINDS]]
const isSiding: ExpressionSpecification = ['==', ['get', 'rank'], 'service']
const railTunnel = (tunnel: boolean): ExpressionSpecification => [
  '==',
  ['coalesce', ['get', 'tunnel'], false],
  tunnel
]
const FROM: LineFrom = { sourceLayer: RAILWAYS_LAYER }

/** A set of tracks with layers of its own (a key row): its name in the layers' ids,
 * and which tracks. */
export interface TrackSet {
  name: string
  filter: ExpressionSpecification
  /** Trams, metro, light rail: their kind (OpenStreetMap's railway=), whose lanes
   * LOOM draws from LANES_SHOWN_FROM (lane-layers.ts). */
  kind?: string
}

/** The railways' sets, drawn in this order (main lines on top). */
export const RAILWAY_SETS: TrackSet[] = [
  { name: 'sidings', filter: isSiding },
  { name: 'minor', filter: ['==', ['get', 'rank'], 'minor'] },
  { name: 'branch', filter: ['==', ['get', 'rank'], 'branch'] },
  { name: 'main', filter: ['==', ['get', 'rank'], 'main'] }
]

function transitKind(name: string, kind: string): TrackSet {
  return { name, kind, filter: ['all', ['==', ['get', 'kind'], kind], ['!', isSiding]] }
}

/** The trams', metros' and light rails' sets (their sidings and depots apart). */
export const TRANSIT_SETS: TrackSet[] = [
  { name: 'sidings', filter: isSiding },
  transitKind('light_rail', 'light_rail'),
  transitKind('metro', 'subway'),
  transitKind('tram', 'tram')
]

/** A set's layers' ids start with this (the key's rows hide them by it). */
export const railwaySetPrefix = (set: TrackSet) => `${RAILWAYS_PREFIX}${set.name}_`
export const transitSetPrefix = (set: TrackSet) => `${TRANSIT_PREFIX}${set.name}_`

/** A width by zoom whose minimum depends on the railway's rank (main lines never
 * thinner than motorways, branch lines than main roads...). */
export function byRank(width: ExpressionSpecification): ExpressionSpecification {
  const [operator, curve, input, ...stops] = width
  const minimum = [
    'match',
    ['get', 'rank'],
    ...Object.entries(look.RAIL_MIN_WIDTH).flat(),
    look.RAIL_MIN_WIDTH.service
  ]
  // Stops are zoom, width, zoom, width...: each width raised to the rank's minimum.
  const widths = stops.map((stop, i) => (i % 2 === 1 ? ['max', stop, minimum] : stop))
  return [operator, curve, input, ...widths] as ExpressionSpecification
}

/** A set of railways. Above ground: a light edge, a line, white dashes on it. In a
 * tunnel: the line see-through, like the roads' tunnels. */
function addRailways(b: Builder, set: TrackSet, tunnel: boolean) {
  const id = `${railwaySetPrefix(set)}${tunnel ? 'tunnel' : 'ground'}`
  const width = byRank(resized(mapLineWidth('osm_rail'), 1, 0))
  const filter: ExpressionSpecification = ['all', railTunnel(tunnel), ['!', isTransit], set.filter]
  const opacity = fading(FULL)
  if (tunnel) {
    const seeThrough = fading(tunnelOpacity(FULL, true))
    b.line(
      id,
      filter,
      { 'line-color': look.RAIL_COLOUR, 'line-width': width, 'line-opacity': seeThrough },
      FROM
    )
    return
  }
  const edge = {
    'line-color': look.RAIL_EDGE_COLOUR,
    'line-gap-width': width,
    'line-width': look.EDGE_WIDTH,
    'line-opacity': opacity
  }
  b.line(`${id}_edge`, filter, edge, FROM)
  b.line(id, filter, { 'line-color': look.RAIL_COLOUR, 'line-width': width, 'line-opacity': opacity }, FROM)
  const dashes = {
    'line-color': look.RAIL_DASH_COLOUR,
    'line-width': width,
    'line-dasharray': look.RAIL_DASHES,
    'line-opacity': opacity
  }
  b.line(`${id}_dashes`, filter, dashes, FROM)
}

/** A set of trams, metro or light rail zoomed out (LOOM's lanes from LANES_SHOWN_FROM,
 * lane-layers.ts; sidings and depots at every zoom): a plain line, narrower than
 * railways, on an outline; in a tunnel (most metro), see-through. */
function addTransit(b: Builder, set: TrackSet, tunnel: boolean) {
  const id = `${transitSetPrefix(set)}${tunnel ? 'tunnel' : 'ground'}`
  const width = resized(mapLineWidth('osm_rail'), look.TRAM_WIDTH_SCALE, look.TRAM_MIN_WIDTH)
  const filter: ExpressionSpecification = ['all', railTunnel(tunnel), isTransit, set.filter]
  const opacity = fading(tunnelOpacity(FULL, tunnel))
  const from: LineFrom = set.kind ? { ...FROM, maxzoom: LANES_SHOWN_FROM } : FROM
  if (!tunnel) {
    const edge = {
      'line-color': look.RAIL_EDGE_COLOUR,
      'line-gap-width': width,
      'line-width': look.EDGE_WIDTH,
      'line-opacity': opacity
    }
    b.line(`${id}_edge`, filter, edge, from)
  }
  b.line(id, filter, { 'line-color': look.TRAM_COLOUR, 'line-width': width, 'line-opacity': opacity }, from)
}

/** Every set of railways, then of trams and metro (zoomed out), in a tunnel or above
 * ground. */
export function addTracks(b: Builder, tunnel: boolean) {
  for (const set of RAILWAY_SETS) addRailways(b, set, tunnel)
  for (const set of TRANSIT_SETS) addTransit(b, set, tunnel)
}
