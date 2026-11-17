// Fork: the bold roads, railways, trams, metro and borders (modules/roads): which ones
// show at each zoom, their widths, tunnels dashed, only railways in use, the same
// over the map and over imagery. Only their opacity follows the background
// (`{ map, imagery }`, listed in `following`, which the module hands to
// followBackground): over imagery they fade zoomed right in, and the borders show
// there only (over the map, the map's own). Roads at three quarters of the
// background map's widths, never thinner than a few pixels; small roads and paths
// alike at every zoom, thinner zoomed out; railways a line with white dashes; trams and
// metro a plain line in each line's colour, side by side where lines share a track.
import type { ExpressionSpecification, FilterSpecification, LineLayerSpecification } from 'maplibre-gl'
import baseLayers from '../../../style/style_base.ts'
import { LayerSpecificationWithZIndex } from '../../../style/types.ts'
import type { BackgroundValues } from '../../services/background.ts'
import * as look from './roads.constants.ts'

/** Each set's layers start with its prefix: the layer switcher's entries switch
 * them by it (index.ts). Borders under upstream's Borders entry, by its prefix. */
export const ROADS_PREFIX = 'roads_'
export const RAILWAYS_PREFIX = 'railways_'
export const TRANSIT_PREFIX = 'transit_'
export const BORDERS_PREFIX = 'boundaries_'

/** Under everything else that's data (the buildings' outlines included). */
const ZORDER = -11

type LinePaint = NonNullable<LineLayerSpecification['paint']>
type PaintProperty = keyof LinePaint
/** A value over the map, and over imagery. */
type OverEach<T> = { map: T; imagery: T }
/** A line's paint, where a value may differ with the background. */
type Paint = { [P in PaintProperty]?: LinePaint[P] | OverEach<LinePaint[P]> }

/** A paint value that follows the background. */
export interface Following {
  layerId: string
  property: PaintProperty
  values: BackgroundValues
}

function isOverEach(value: unknown): value is OverEach<unknown> {
  return typeof value === 'object' && value !== null && 'map' in value && 'imagery' in value
}

/** A kind of road, from the smallest to motorways (drawn in that order). */
interface RoadKind {
  name: string
  /** Which roads, tunnels or not. */
  filter: ExpressionSpecification
  /** The background map's layer it takes its widths from (tunnels too: the road's size). */
  widthFrom: string
  colour: string
  opacity: number
  /** Never thinner than this (pixels): the map's widths go down to nothing zoomed out. */
  minWidth: number
  /** Small roads and paths: their edge comes in gradually as they widen (thin, a full
   * edge would make them dark lines). */
  small?: true
  dashes?: number[]
}

const FULL = 1
const kind = (...kinds: string[]): ExpressionSpecification => ['in', ['get', 'kind'], ['literal', kinds]]
const isLink: ExpressionSpecification = ['has', 'is_link']
const isService: ExpressionSpecification = ['==', ['get', 'kind_detail'], 'service']
const isPier: ExpressionSpecification = ['==', ['get', 'kind_detail'], 'pier']
const detail = (...details: string[]): ExpressionSpecification => [
  'in',
  ['get', 'kind_detail'],
  ['literal', details]
]
/** Main roads with a look of their own (the rest of them, primary roads, yellow). */
const OWN_LOOK = ['trunk', 'secondary', 'tertiary']

const ROAD_KINDS: RoadKind[] = [
  {
    name: 'paths',
    minWidth: look.SMALL_ROAD_MIN_WIDTH,
    filter: ['all', kind('other', 'path'), ['!', isPier]],
    widthFrom: 'osm_roads_other',
    colour: look.PATH_COLOUR,
    opacity: look.SMALLEST_OPACITY,
    small: true,
    dashes: look.PATH_DASHES
  },
  {
    name: 'service',
    minWidth: look.SMALL_ROAD_MIN_WIDTH,
    filter: ['all', kind('minor_road'), isService],
    widthFrom: 'osm_roads_minor_service',
    colour: look.MINOR_COLOUR,
    opacity: look.SMALLEST_OPACITY,
    small: true
  },
  {
    name: 'minor',
    minWidth: look.SMALL_ROAD_MIN_WIDTH,
    filter: ['all', kind('minor_road'), ['!', isService], ['!', isLink]],
    widthFrom: 'osm_roads_minor',
    colour: look.MINOR_COLOUR,
    opacity: look.MINOR_OPACITY,
    small: true
  },
  {
    name: 'links',
    minWidth: look.LINK_MIN_WIDTH,
    filter: isLink,
    widthFrom: 'osm_roads_link',
    colour: look.MAJOR_COLOUR,
    opacity: FULL
  },
  {
    name: 'tertiary',
    minWidth: look.MAJOR_MIN_WIDTH,
    filter: ['all', kind('major_road'), detail('tertiary'), ['!', isLink]],
    widthFrom: 'osm_roads_major',
    colour: look.TERTIARY_COLOUR,
    opacity: FULL
  },
  {
    name: 'secondary',
    minWidth: look.MAJOR_MIN_WIDTH,
    filter: ['all', kind('major_road'), detail('secondary'), ['!', isLink]],
    widthFrom: 'osm_roads_major',
    colour: look.SECONDARY_COLOUR,
    opacity: FULL
  },
  {
    name: 'major',
    minWidth: look.MAJOR_MIN_WIDTH,
    filter: ['all', kind('major_road'), ['!', detail(...OWN_LOOK)], ['!', isLink]],
    widthFrom: 'osm_roads_major',
    colour: look.MAJOR_COLOUR,
    opacity: FULL
  },
  {
    name: 'trunk',
    minWidth: look.TRUNK_MIN_WIDTH,
    filter: ['all', kind('major_road'), detail('trunk'), ['!', isLink]],
    widthFrom: 'osm_roads_major',
    colour: look.TRUNK_COLOUR,
    opacity: FULL
  },
  {
    name: 'highway',
    minWidth: look.HIGHWAY_MIN_WIDTH,
    filter: ['all', kind('highway'), ['!', isLink]],
    widthFrom: 'osm_roads_highway',
    colour: look.HIGHWAY_COLOUR,
    opacity: FULL
  }
]

const inTunnel: ExpressionSpecification = ['has', 'is_tunnel']
const aboveGround: ExpressionSpecification = ['!', inTunnel]
/** The railways, trams and metro: a layer of the background map's tiles, added by the
 * backend from the zoomed out file (web-backend/src/fork/background/zoomed_railways.py:
 * ranked from OpenStreetMap's tags, close tracks drawn as one zoomed out). */
export const RAILWAYS_LAYER = 'railways'
/** Trams, metro and light rail: drawn apart from the railways, each line in its own
 * colour (the backend's TRANSIT_KINDS, web-backend/src/fork/background/transit_lines.py;
 * the background map's own rail lines say the same in kind_detail). */
export const TRANSIT_KINDS = ['tram', 'subway', 'light_rail']
const isTransit: ExpressionSpecification = ['in', ['get', 'kind'], ['literal', TRANSIT_KINDS]]
const railTunnel = (tunnel: boolean): ExpressionSpecification => [
  '==',
  ['coalesce', ['get', 'tunnel'], false],
  tunnel
]
/** Main lines drawn over branch lines, over the rest. */
const RAIL_SORT_KEY: ExpressionSpecification = [
  'match',
  ['get', 'rank'],
  'main',
  3,
  'branch',
  2,
  'minor',
  1,
  0
]

/** A layer of the background map (its widths and borders are reused, so they stay in step). */
function mapLayer(id: string): LayerSpecificationWithZIndex {
  const layer = baseLayers.find((l) => l.id === id)
  if (!layer) throw new Error(`The background map has no layer ${id}`)
  return layer
}

function mapLineWidth(id: string) {
  const layer = mapLayer(id)
  const width = layer.type === 'line' ? layer.paint?.['line-width'] : undefined
  if (width === undefined) throw new Error(`The background map's ${id} has no line width`)
  return width
}

/** A width by zoom (an interpolation, as the map's all are) times `scale`, never
 * under `minimum`. */
export function resized(width: unknown, scale: number, minimum: number): ExpressionSpecification {
  if (!Array.isArray(width) || width[0] !== 'interpolate')
    throw new Error(`Not a width by zoom: ${JSON.stringify(width)}`)
  const [operator, curve, input, ...stops] = width
  // Stops are zoom, width, zoom, width...: only the widths change.
  const widths = stops.map((stop, i) => (i % 2 === 1 ? Math.max(Number(stop) * scale, minimum) : stop))
  return [operator, curve, input, ...widths] as ExpressionSpecification
}

/** Over the map, as it is; over imagery full strength until zoomed right in, then
 * fading: the photos show the roads there. */
function fading(opacity: number): OverEach<number | ExpressionSpecification> {
  const overImagery: ExpressionSpecification = [
    'interpolate',
    ['linear'],
    ['zoom'],
    look.FADE_FROM_ZOOM,
    opacity,
    look.FADE_TO_ZOOM,
    opacity * look.FADED
  ]
  return { map: opacity, imagery: overImagery }
}

/** Shown over imagery only (the map draws its own). */
const ONLY_OVER_IMAGERY: OverEach<number> = { map: 0, imagery: 1 }

/** An edge width growing from a hairline to its full width as small roads widen. */
function growing(width: number): ExpressionSpecification {
  return [
    'interpolate',
    ['linear'],
    ['zoom'],
    look.SMALL_EDGE_FROM_ZOOM,
    look.SMALL_EDGE_HAIRLINE,
    look.SMALL_EDGE_FULL_ZOOM,
    width
  ]
}

interface LineFrom {
  sourceLayer?: string
  minzoom?: number
  maxzoom?: number
  sortKey?: ExpressionSpecification
}

/** Builds the layers, noting each paint value that follows the background. */
class Builder {
  layers: LayerSpecificationWithZIndex[] = []
  following: Following[] = []

  /** A line from the background map, by default its roads (`from`: another layer,
   * zooms, a layout's sort key). */
  line(layerId: string, filter: FilterSpecification, paint: Paint, from: LineFrom = {}) {
    const { sourceLayer = 'roads', sortKey, ...zooms } = from
    this.layers.push({
      id: layerId,
      zorder: ZORDER,
      type: 'line',
      source: 'basemap',
      'source-layer': sourceLayer,
      filter,
      ...zooms,
      layout: { 'line-join': 'round', ...(sortKey ? { 'line-sort-key': sortKey } : {}) },
      paint: this.overTheMap(layerId, paint)
    })
  }

  /** The paint over the map; the values that follow the background noted. */
  private overTheMap(layerId: string, paint: Paint): LinePaint {
    const onMap: Record<string, unknown> = {}
    for (const [property, value] of Object.entries(paint)) {
      if (isOverEach(value)) {
        onMap[property] = value.map
        this.following.push({
          layerId,
          property: property as PaintProperty,
          values: value as BackgroundValues
        })
      } else onMap[property] = value
    }
    return onMap as LinePaint
  }
}

/** A kind of road above ground or in a tunnel: its edge, then the road. */
function addRoad(b: Builder, road: RoadKind, tunnel: boolean) {
  const where = tunnel ? 'tunnel' : 'ground'
  const width = resized(mapLineWidth(road.widthFrom), look.ROAD_WIDTH_SCALE, road.minWidth)
  const filter: ExpressionSpecification = ['all', tunnel ? inTunnel : aboveGround, road.filter]
  const dashes = tunnel ? (road.dashes ?? look.TUNNEL_DASHES) : road.dashes
  b.line(`${ROADS_PREFIX}${where}_${road.name}_edge`, filter, {
    'line-color': look.EDGE_COLOUR,
    'line-gap-width': width,
    'line-width': road.small ? growing(look.EDGE_WIDTH) : look.EDGE_WIDTH,
    'line-opacity': fading(FULL),
    ...(tunnel ? { 'line-dasharray': look.TUNNEL_EDGE_DASHES } : {})
  })
  b.line(`${ROADS_PREFIX}${where}_${road.name}`, filter, {
    'line-color': road.colour,
    'line-width': width,
    'line-opacity': fading(road.opacity),
    ...(dashes ? { 'line-dasharray': dashes } : {})
  })
}

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

/** The railways (RAILWAYS_LAYER, but trams and metro). Above ground: a light edge, a line,
 * white dashes on it. In a tunnel: the edge and the line dashed, like the roads'
 * tunnels. The more important lines drawn over the others. */
function addRail(b: Builder, tunnel: boolean) {
  const where = tunnel ? 'tunnel' : 'ground'
  const width = byRank(resized(mapLineWidth('osm_rail'), 1, 0))
  const filter: ExpressionSpecification = ['all', railTunnel(tunnel), ['!', isTransit]]
  const from: LineFrom = { sourceLayer: RAILWAYS_LAYER, sortKey: RAIL_SORT_KEY }
  const opacity = fading(FULL)
  const tunnelDashes = (dashes: number[]) => (tunnel ? { 'line-dasharray': dashes } : {})
  b.line(
    `${RAILWAYS_PREFIX}${where}_edge`,
    filter,
    {
      'line-color': look.RAIL_EDGE_COLOUR,
      'line-gap-width': width,
      'line-width': look.EDGE_WIDTH,
      'line-opacity': opacity,
      ...tunnelDashes(look.TUNNEL_EDGE_DASHES)
    },
    from
  )
  b.line(
    `${RAILWAYS_PREFIX}${where}`,
    filter,
    {
      'line-color': look.RAIL_COLOUR,
      'line-width': width,
      'line-opacity': opacity,
      ...tunnelDashes(look.TUNNEL_DASHES)
    },
    from
  )
  if (tunnel) return
  b.line(
    `${RAILWAYS_PREFIX}${where}_dashes`,
    filter,
    {
      'line-color': look.RAIL_DASH_COLOUR,
      'line-width': width,
      'line-dasharray': look.RAIL_DASHES,
      'line-opacity': opacity
    },
    from
  )
}

/** Where a line's strand goes beside the others on its track: its slot's distance
 * from the middle, in strand widths (slot and slots from the backend's strands; a
 * track without lines on it in the middle). */
const fromTheMiddle: ExpressionSpecification = [
  '-',
  ['coalesce', ['get', 'slot'], 0],
  ['/', ['-', ['coalesce', ['get', 'slots'], 1], 1], 2]
]

/** A width by zoom times each strand's place: its offset from the track. */
export function besideTheOthers(width: ExpressionSpecification): ExpressionSpecification {
  const [operator, curve, input, ...stops] = width
  // Stops are zoom, width, zoom, width...: each width times the strand's place.
  const offsets = stops.map((stop, i) => (i % 2 === 1 ? ['*', fromTheMiddle, stop] : stop))
  return [operator, curve, input, ...offsets] as ExpressionSpecification
}

/** Trams, metro and light rail (RAILWAYS_LAYER's): a plain line in its line's colour
 * (TRAM_COLOUR without one), narrower than railways, on a light edge, the lines
 * sharing a track side by side; dashed in a tunnel (most metro). */
function addTransit(b: Builder, tunnel: boolean) {
  const where = tunnel ? 'tunnel' : 'ground'
  const width = resized(mapLineWidth('osm_rail'), look.TRAM_WIDTH_SCALE, look.TRAM_MIN_WIDTH)
  const offset = besideTheOthers(width)
  const filter: ExpressionSpecification = ['all', railTunnel(tunnel), isTransit]
  const from: LineFrom = { sourceLayer: RAILWAYS_LAYER }
  const opacity = fading(FULL)
  const tunnelDashes = (dashes: number[]) => (tunnel ? { 'line-dasharray': dashes } : {})
  b.line(
    `${TRANSIT_PREFIX}${where}_edge`,
    filter,
    {
      'line-color': look.RAIL_EDGE_COLOUR,
      'line-gap-width': width,
      'line-width': look.EDGE_WIDTH,
      'line-offset': offset,
      'line-opacity': opacity,
      ...tunnelDashes(look.TUNNEL_EDGE_DASHES)
    },
    from
  )
  b.line(
    `${TRANSIT_PREFIX}${where}`,
    filter,
    {
      'line-color': ['to-color', ['get', 'colour'], look.TRAM_COLOUR],
      'line-width': width,
      'line-offset': offset,
      'line-opacity': opacity,
      ...tunnelDashes(look.TUNNEL_DASHES)
    },
    from
  )
}

/** The map's country borders, over imagery: red dashes on a dark edge. */
function addBorders(b: Builder) {
  const border = mapLayer('boundaries_country')
  if (border.type !== 'line' || !border.filter || !border['source-layer'])
    throw new Error("The background map's borders aren't lines")
  const width = border.paint?.['line-width']
  const from = { sourceLayer: border['source-layer'] }
  b.line(
    `${BORDERS_PREFIX}countries_edge`,
    border.filter,
    {
      'line-color': look.BORDER_EDGE_COLOUR,
      'line-gap-width': width,
      'line-width': look.EDGE_WIDTH,
      'line-opacity': ONLY_OVER_IMAGERY
    },
    from
  )
  b.line(
    `${BORDERS_PREFIX}countries`,
    border.filter,
    { ...border.paint, 'line-color': look.BORDER_COLOUR, 'line-opacity': ONLY_OVER_IMAGERY },
    from
  )
}

/** Every layer, bottom to top (tunnels, roads, railways, trams and metro, borders), and the
 * paint values that follow the background. */
export function roadLayers(): { layers: LayerSpecificationWithZIndex[]; following: Following[] } {
  const b = new Builder()
  for (const road of ROAD_KINDS) addRoad(b, road, true)
  addRail(b, true)
  addTransit(b, true)
  for (const road of ROAD_KINDS) addRoad(b, road, false)
  addRail(b, false)
  addTransit(b, false)
  addBorders(b)
  return { layers: b.layers, following: b.following }
}
