// Fork: the roads, railways and borders, the same in every mode (modules/roads):
// which ones show at each zoom, their widths, tunnels dashed, only railways in use.
// Only colours (and fading zoomed in, over photos) differ between the map and
// imagery: such a paint value is `{ map, imagery }` (roads.constants.ts), set on the
// layer for the map and listed in `following`, which the module hands to
// followBackground. Roads at three quarters of the background map's widths, never
// thinner than a few pixels; small roads and paths at their size from zoom 14 (where
// the map has all of them), a thin line before; railways a line with white dashes.
import type { ExpressionSpecification, FilterSpecification, LineLayerSpecification } from 'maplibre-gl'
import baseLayers from '../../../style/style_base.ts'
import { LayerSpecificationWithZIndex } from '../../../style/types.ts'
import * as look from './roads.constants.ts'
import type { Both } from './roads.constants.ts'

/** Every road layer's id starts with this. */
export const ROADS_PREFIX = 'roads_'

export function isRoadLayer(layerId: string): boolean {
  return layerId.startsWith(ROADS_PREFIX)
}

/** Under everything else that's data (the buildings' outlines included). */
const ZORDER = -11

type LinePaint = NonNullable<LineLayerSpecification['paint']>
type PaintProperty = keyof LinePaint
/** A line's paint, where any value may differ between the map and imagery. */
type Paint = { [P in PaintProperty]?: LinePaint[P] | Both<LinePaint[P]> }

/** A paint value set on the map that's another over imagery. */
export interface Following {
  layerId: string
  property: PaintProperty
  values: Both<unknown>
}

function isBoth(value: unknown): value is Both<unknown> {
  return typeof value === 'object' && value !== null && 'map' in value && 'imagery' in value
}

/** A kind of road, from the smallest to motorways (drawn in that order). */
interface RoadKind {
  name: string
  /** Which roads, tunnels or not. */
  filter: ExpressionSpecification
  /** The background map's layer it takes its widths from (tunnels too: the road's size). */
  widthFrom: string
  colour: Both<string>
  opacity: Both<number>
  /** Never thinner than this (pixels): the map's widths go down to nothing zoomed out. */
  minWidth: number
  /** Small roads and paths: drawn at their size from this zoom, a thin line before. */
  minzoom?: number
  dashes?: number[]
}

const kind = (...kinds: string[]): ExpressionSpecification => ['in', ['get', 'kind'], ['literal', kinds]]
const isLink: ExpressionSpecification = ['has', 'is_link']
const isService: ExpressionSpecification = ['==', ['get', 'kind_detail'], 'service']
const isPier: ExpressionSpecification = ['==', ['get', 'kind_detail'], 'pier']

const ROAD_KINDS: RoadKind[] = [
  {
    name: 'paths',
    minWidth: look.SMALL_ROAD_MIN_WIDTH,
    filter: ['all', kind('other', 'path'), ['!', isPier]],
    widthFrom: 'osm_roads_other',
    colour: look.PATH_COLOUR,
    opacity: look.SMALLEST_OPACITY,
    minzoom: look.SMALL_ROADS_FROM_ZOOM,
    dashes: look.PATH_DASHES
  },
  {
    name: 'service',
    minWidth: look.SMALL_ROAD_MIN_WIDTH,
    filter: ['all', kind('minor_road'), isService],
    widthFrom: 'osm_roads_minor_service',
    colour: look.MINOR_COLOUR,
    opacity: look.SMALLEST_OPACITY,
    minzoom: look.SMALL_ROADS_FROM_ZOOM
  },
  {
    name: 'minor',
    minWidth: look.SMALL_ROAD_MIN_WIDTH,
    filter: ['all', kind('minor_road'), ['!', isService], ['!', isLink]],
    widthFrom: 'osm_roads_minor',
    colour: look.MINOR_COLOUR,
    opacity: look.MINOR_OPACITY,
    minzoom: look.SMALL_ROADS_FROM_ZOOM
  },
  {
    name: 'links',
    minWidth: look.LINK_MIN_WIDTH,
    filter: isLink,
    widthFrom: 'osm_roads_link',
    colour: look.MAJOR_COLOUR,
    opacity: { map: 1, imagery: 1 }
  },
  {
    name: 'major',
    minWidth: look.MAJOR_MIN_WIDTH,
    filter: ['all', kind('major_road'), ['!', isLink]],
    widthFrom: 'osm_roads_major',
    colour: look.MAJOR_COLOUR,
    opacity: { map: 1, imagery: 1 }
  },
  {
    name: 'highway',
    minWidth: look.HIGHWAY_MIN_WIDTH,
    filter: ['all', kind('highway'), ['!', isLink]],
    widthFrom: 'osm_roads_highway',
    colour: look.HIGHWAY_COLOUR,
    opacity: { map: 1, imagery: 1 }
  }
]

/** Small roads and paths (a thin line zoomed out). */
const SMALL_KINDS = ROAD_KINDS.filter((road) => road.minzoom !== undefined)

const inTunnel: ExpressionSpecification = ['has', 'is_tunnel']
const aboveGround: ExpressionSpecification = ['!', inTunnel]
// Not the abandoned, disused or dismantled ones, platforms, turntables...: the
// background map files all of those as kind "rail".
const isRail: ExpressionSpecification = [
  'all',
  kind('rail'),
  ['in', ['get', 'kind_detail'], ['literal', look.RAILWAYS]]
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
function fading(opacity: Both<number>): Both<number | ExpressionSpecification> {
  const overImagery: ExpressionSpecification = [
    'interpolate',
    ['linear'],
    ['zoom'],
    look.FADE_FROM_ZOOM,
    opacity.imagery,
    look.FADE_TO_ZOOM,
    opacity.imagery * look.FADED
  ]
  return { map: opacity.map, imagery: overImagery }
}

const FULL: Both<number> = { map: 1, imagery: 1 }

/** Builds the layers, noting each paint value that follows the background. */
class Builder {
  layers: LayerSpecificationWithZIndex[] = []
  following: Following[] = []

  /** A line from the background map's roads (`source` its other layers: borders). */
  line(
    id: string,
    filter: FilterSpecification,
    paint: Paint,
    from: { sourceLayer?: string; minzoom?: number; maxzoom?: number } = {}
  ) {
    const layerId = ROADS_PREFIX + id
    const { sourceLayer = 'roads', ...zooms } = from
    this.layers.push({
      id: layerId,
      zorder: ZORDER,
      type: 'line',
      source: 'basemap',
      'source-layer': sourceLayer,
      filter,
      ...zooms,
      layout: { 'line-join': 'round' },
      paint: this.overTheMap(layerId, paint)
    })
  }

  /** The paint for the map; the values over imagery noted. */
  private overTheMap(layerId: string, paint: Paint): LinePaint {
    const onMap: Record<string, unknown> = {}
    for (const [property, value] of Object.entries(paint)) {
      if (isBoth(value)) {
        onMap[property] = value.map
        this.following.push({ layerId, property: property as PaintProperty, values: value })
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
  b.line(
    `${where}_${road.name}_edge`,
    filter,
    {
      'line-color': look.EDGE_COLOUR,
      'line-gap-width': width,
      'line-width': look.EDGE_WIDTH,
      'line-opacity': fading(FULL),
      ...(tunnel ? { 'line-dasharray': look.TUNNEL_EDGE_DASHES } : {})
    },
    { minzoom: road.minzoom }
  )
  b.line(
    `${where}_${road.name}`,
    filter,
    {
      'line-color': road.colour,
      'line-width': width,
      'line-opacity': fading(road.opacity),
      ...(dashes ? { 'line-dasharray': dashes } : {})
    },
    { minzoom: road.minzoom }
  )
}

/** Railways above ground: a light edge, a line, white dashes on it. In a tunnel: the
 * edge and the line dashed, like the roads' tunnels. */
function addRail(b: Builder, tunnel: boolean) {
  const where = tunnel ? 'tunnel' : 'ground'
  const width = resized(mapLineWidth('osm_rail'), 1, look.RAIL_MIN_WIDTH)
  const filter: ExpressionSpecification = ['all', tunnel ? inTunnel : aboveGround, isRail]
  const opacity = fading(FULL)
  const tunnelDashes = (dashes: number[]) => (tunnel ? { 'line-dasharray': dashes } : {})
  b.line(`rail_${where}_edge`, filter, {
    'line-color': look.RAIL_EDGE_COLOUR,
    'line-gap-width': width,
    'line-width': look.EDGE_WIDTH,
    'line-opacity': opacity,
    ...tunnelDashes(look.TUNNEL_EDGE_DASHES)
  })
  b.line(`rail_${where}`, filter, {
    'line-color': look.RAIL_COLOUR,
    'line-width': width,
    'line-opacity': opacity,
    ...tunnelDashes(look.TUNNEL_DASHES)
  })
  if (tunnel) return
  b.line(`rail_${where}_dashes`, filter, {
    'line-color': look.RAIL_DASH_COLOUR,
    'line-width': width,
    'line-dasharray': look.RAIL_DASHES,
    'line-opacity': opacity
  })
}

/** Small roads and paths before they're drawn at their size: a thin line, where the
 * background map has them (some from zoom 12, all from 14). */
function addSmallRoadsZoomedOut(b: Builder) {
  const small: ExpressionSpecification = ['any', ...SMALL_KINDS.map((road) => road.filter)]
  b.line(
    'small_zoomed_out',
    small,
    {
      'line-color': look.SMALL_ROADS_ZOOMED_OUT_COLOUR,
      'line-width': look.SMALL_ROADS_ZOOMED_OUT_WIDTH
    },
    { maxzoom: look.SMALL_ROADS_FROM_ZOOM }
  )
}

/** The map's country borders: red dashes, on a dark edge over imagery. */
function addBorders(b: Builder) {
  const border = mapLayer('boundaries_country')
  if (border.type !== 'line' || !border.filter || !border['source-layer'])
    throw new Error("The background map's borders aren't lines")
  const width = border.paint?.['line-width']
  const from = { sourceLayer: border['source-layer'] }
  b.line(
    'borders_edge',
    border.filter,
    { 'line-color': look.BORDER_EDGE_COLOUR, 'line-gap-width': width, 'line-width': look.EDGE_WIDTH },
    from
  )
  b.line('borders', border.filter, { ...border.paint, 'line-color': look.BORDER_COLOUR }, from)
}

/** Every road layer, bottom to top (small roads zoomed out, tunnels, roads, railways,
 * borders), and the paint values that follow the background. */
export function roadLayers(): { layers: LayerSpecificationWithZIndex[]; following: Following[] } {
  const b = new Builder()
  addSmallRoadsZoomedOut(b)
  for (const road of ROAD_KINDS) addRoad(b, road, true)
  addRail(b, true)
  for (const road of ROAD_KINDS) addRoad(b, road, false)
  addRail(b, false)
  addBorders(b)
  return { layers: b.layers, following: b.following }
}
