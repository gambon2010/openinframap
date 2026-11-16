// Fork: "satellite with roads": the roads, railways and borders drawn over the
// imagery. The background map's own (white roads, light grey railways: made for a
// light map) vanish on photos, so these are the fork's own layers on the same
// source, shown only in that mode (index.ts places them right above the imagery):
// roads at three quarters of the map's widths (readable on coarse imagery too) but
// never thinner than a few pixels, each with a dark edge and coloured by importance,
// tunnels dashed, railways black and white; all fade a little zoomed in, where the
// photos show the roads themselves. Street names turn white on a dark halo over any imagery.
import type { ExpressionSpecification, Map } from 'maplibre-gl'
import baseLayers from '../../../style/style_base.ts'
import { LayerSpecificationWithZIndex } from '../../../style/types.ts'
import { followBackground } from '../../services/background.ts'
import * as look from './hybrid.constants.ts'

// Under the imagery's own prefix: chosen in Settings → Background, not in the layer switcher.
const PREFIX = 'satellite_roads_'

export function isHybridLayer(layerId: string): boolean {
  return layerId.startsWith(PREFIX)
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
  /** Small roads and paths: drawn at their size from this zoom, a thin dark line before. */
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
    colour: look.MINOR_COLOUR,
    opacity: look.SMALLEST_OPACITY,
    minzoom: look.SMALL_ROADS_FROM_ZOOM,
    dashes: [3, 1]
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
    opacity: 1
  },
  {
    name: 'major',
    minWidth: look.MAJOR_MIN_WIDTH,
    filter: ['all', kind('major_road'), ['!', isLink]],
    widthFrom: 'osm_roads_major',
    colour: look.MAJOR_COLOUR,
    opacity: 1
  },
  {
    name: 'highway',
    minWidth: look.HIGHWAY_MIN_WIDTH,
    filter: ['all', kind('highway'), ['!', isLink]],
    widthFrom: 'osm_roads_highway',
    colour: look.HIGHWAY_COLOUR,
    opacity: 1
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

/** Full strength until zoomed right in, then fading: the photos show the roads there. */
function fading(opacity: number): ExpressionSpecification {
  return [
    'interpolate',
    ['linear'],
    ['zoom'],
    look.FADE_FROM_ZOOM,
    opacity,
    look.FADE_TO_ZOOM,
    opacity * look.FADED
  ]
}

function line(
  id: string,
  filter: ExpressionSpecification,
  paint: NonNullable<Extract<LayerSpecificationWithZIndex, { type: 'line' }>['paint']>,
  visible: boolean,
  zooms: { minzoom?: number; maxzoom?: number } = {}
): LayerSpecificationWithZIndex {
  return {
    id: PREFIX + id,
    zorder: 1,
    type: 'line',
    source: 'basemap',
    'source-layer': 'roads',
    filter,
    ...zooms,
    layout: { 'line-join': 'round', visibility: visible ? 'visible' : 'none' },
    paint
  }
}

/** A kind of road above ground or in a tunnel: its dark edge, then the road. */
function roadLayers(road: RoadKind, tunnel: boolean, visible: boolean): LayerSpecificationWithZIndex[] {
  const where = tunnel ? 'tunnel' : 'ground'
  const width = resized(mapLineWidth(road.widthFrom), look.ROAD_WIDTH_SCALE, road.minWidth)
  const filter: ExpressionSpecification = ['all', tunnel ? inTunnel : aboveGround, road.filter]
  const edge = line(
    `roads_${where}_${road.name}_edge`,
    filter,
    {
      'line-color': look.EDGE_COLOUR,
      'line-gap-width': width,
      'line-width': look.EDGE_WIDTH,
      'line-opacity': fading(1),
      ...(tunnel ? { 'line-dasharray': look.TUNNEL_EDGE_DASHES } : {})
    },
    visible,
    { minzoom: road.minzoom }
  )
  const fill = line(
    `roads_${where}_${road.name}`,
    filter,
    {
      'line-color': road.colour,
      'line-width': width,
      'line-opacity': fading(road.opacity),
      ...(tunnel || road.dashes ? { 'line-dasharray': road.dashes ?? look.TUNNEL_DASHES } : {})
    },
    visible,
    { minzoom: road.minzoom }
  )
  return [edge, fill]
}

/** Railways above ground: a light edge, a black line, white dashes on it. In a
 * tunnel: the edge and the black line dashed, like the roads' tunnels. */
function railLayers(tunnel: boolean, visible: boolean): LayerSpecificationWithZIndex[] {
  const where = tunnel ? 'tunnel' : 'ground'
  const width = resized(mapLineWidth('osm_rail'), 1, look.RAIL_MIN_WIDTH)
  const filter: ExpressionSpecification = ['all', tunnel ? inTunnel : aboveGround, isRail]
  const opacity = fading(1)
  const tunnelDashes = (dashes: number[]) => (tunnel ? { 'line-dasharray': dashes } : {})
  const layers = [
    line(
      `rail_${where}_edge`,
      filter,
      {
        'line-color': look.RAIL_EDGE_COLOUR,
        'line-gap-width': width,
        'line-width': look.EDGE_WIDTH,
        'line-opacity': opacity,
        ...tunnelDashes(look.TUNNEL_EDGE_DASHES)
      },
      visible
    ),
    line(
      `rail_${where}`,
      filter,
      {
        'line-color': look.RAIL_COLOUR,
        'line-width': width,
        'line-opacity': opacity,
        ...tunnelDashes(look.TUNNEL_DASHES)
      },
      visible
    )
  ]
  if (tunnel) return layers
  return [
    ...layers,
    line(
      `rail_${where}_dashes`,
      filter,
      {
        'line-color': look.RAIL_DASH_COLOUR,
        'line-width': width,
        'line-dasharray': look.RAIL_DASHES,
        'line-opacity': opacity
      },
      visible
    )
  ]
}

/** Small roads and paths before they're drawn at their size: a thin dark line, where
 * the background map has them (some from zoom 12, all from 14). */
function smallRoadsZoomedOut(visible: boolean): LayerSpecificationWithZIndex {
  const small: ExpressionSpecification = ['any', ...SMALL_KINDS.map((road) => road.filter)]
  return line(
    'roads_small_zoomed_out',
    small,
    {
      'line-color': look.SMALL_ROADS_ZOOMED_OUT_COLOUR,
      'line-width': look.SMALL_ROADS_ZOOMED_OUT_WIDTH
    },
    visible,
    { maxzoom: look.SMALL_ROADS_FROM_ZOOM }
  )
}

/** The map's country borders: red dashes on a dark edge, to show on any photo. */
function borderLayers(visible: boolean): LayerSpecificationWithZIndex[] {
  const border = mapLayer('boundaries_country')
  if (border.type !== 'line') throw new Error("The background map's borders aren't lines")
  const width = border.paint?.['line-width']
  const layout = { ...border.layout, visibility: visible ? ('visible' as const) : ('none' as const) }
  const edge: LayerSpecificationWithZIndex = {
    ...border,
    id: `${PREFIX}borders_edge`,
    zorder: 1,
    layout,
    paint: { 'line-color': look.EDGE_COLOUR, 'line-gap-width': width, 'line-width': look.EDGE_WIDTH }
  }
  const dashes: LayerSpecificationWithZIndex = {
    ...border,
    id: `${PREFIX}borders`,
    zorder: 1,
    layout,
    paint: { ...border.paint, 'line-color': look.BORDER_COLOUR }
  }
  return [edge, dashes]
}

/** All of it, bottom to top: small roads zoomed out, tunnels, roads, railways, borders. */
export function hybridLayers(visible: boolean): LayerSpecificationWithZIndex[] {
  return [
    smallRoadsZoomedOut(visible),
    ...ROAD_KINDS.flatMap((road) => roadLayers(road, true, visible)),
    ...railLayers(true, visible),
    ...ROAD_KINDS.flatMap((road) => roadLayers(road, false, visible)),
    ...railLayers(false, visible),
    ...borderLayers(visible)
  ]
}

const STREET_NAMES = ['label_roads_minor', 'label_roads_major']

/** Street names white on a dark halo over imagery (the map's own colours over the map).
 * Called once the style is loaded: the map's colours are read from it. */
export function streetNamesOverImagery(map: Map) {
  for (const id of STREET_NAMES) {
    if (!map.getLayer(id)) continue
    followBackground(map, id, 'text-color', {
      map: map.getPaintProperty(id, 'text-color'),
      imagery: look.NAME_COLOUR
    })
    followBackground(map, id, 'text-halo-color', {
      map: map.getPaintProperty(id, 'text-halo-color'),
      imagery: look.NAME_HALO_COLOUR
    })
    followBackground(map, id, 'text-halo-width', {
      map: map.getPaintProperty(id, 'text-halo-width'),
      imagery: look.NAME_HALO_WIDTH
    })
  }
}
