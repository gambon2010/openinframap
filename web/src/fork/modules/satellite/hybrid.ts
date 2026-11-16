// Fork: "satellite with roads": the roads, railways and borders drawn over the
// imagery. The background map's own (white roads, light grey railways: made for a
// light map) vanish on photos, so these are the fork's own layers on the same
// source, shown only in that mode (index.ts places them right above the imagery):
// roads at the map's widths (their real size, readable on coarse imagery too), each
// with a dark edge and coloured by importance, tunnels see-through with a dashed
// edge, railways black and white; all fade a little zoomed in, where the photos show
// the roads themselves. Street names turn white on a dark halo over any imagery.
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
  /** The background map's layers it takes its widths from: above ground, in a tunnel. */
  widthsFrom: { ground: string; tunnel: string }
  colour: string
  opacity: number
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
    filter: ['all', kind('other', 'path'), ['!', isPier]],
    widthsFrom: { ground: 'osm_roads_other', tunnel: 'osm_roads_tunnels_other' },
    colour: look.MINOR_COLOUR,
    opacity: look.SMALLEST_OPACITY,
    minzoom: look.SMALLEST_FROM_ZOOM,
    dashes: [3, 1]
  },
  {
    name: 'service',
    filter: ['all', kind('minor_road'), isService],
    widthsFrom: { ground: 'osm_roads_minor_service', tunnel: 'osm_roads_tunnels_minor' },
    colour: look.MINOR_COLOUR,
    opacity: look.SMALLEST_OPACITY,
    minzoom: look.SMALLEST_FROM_ZOOM
  },
  {
    name: 'minor',
    filter: ['all', kind('minor_road'), ['!', isService], ['!', isLink]],
    widthsFrom: { ground: 'osm_roads_minor', tunnel: 'osm_roads_tunnels_minor' },
    colour: look.MINOR_COLOUR,
    opacity: look.MINOR_OPACITY
  },
  {
    name: 'links',
    filter: isLink,
    widthsFrom: { ground: 'osm_roads_link', tunnel: 'osm_roads_tunnels_link' },
    colour: look.MAJOR_COLOUR,
    opacity: 1
  },
  {
    name: 'major',
    filter: ['all', kind('major_road'), ['!', isLink]],
    widthsFrom: { ground: 'osm_roads_major', tunnel: 'osm_roads_tunnels_major' },
    colour: look.MAJOR_COLOUR,
    opacity: 1
  },
  {
    name: 'highway',
    filter: ['all', kind('highway'), ['!', isLink]],
    widthsFrom: { ground: 'osm_roads_highway', tunnel: 'osm_roads_tunnels_highway' },
    colour: look.HIGHWAY_COLOUR,
    opacity: 1
  }
]

const inTunnel: ExpressionSpecification = ['has', 'is_tunnel']
const aboveGround: ExpressionSpecification = ['!', inTunnel]
const isRail = kind('rail')

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
  minzoom?: number
): LayerSpecificationWithZIndex {
  return {
    id: PREFIX + id,
    zorder: 1,
    type: 'line',
    source: 'basemap',
    'source-layer': 'roads',
    filter,
    ...(minzoom === undefined ? {} : { minzoom }),
    layout: { 'line-join': 'round', visibility: visible ? 'visible' : 'none' },
    paint
  }
}

/** A kind of road above ground or in a tunnel: its dark edge, then the road. */
function roadLayers(road: RoadKind, tunnel: boolean, visible: boolean): LayerSpecificationWithZIndex[] {
  const where = tunnel ? 'tunnel' : 'ground'
  const width = mapLineWidth(road.widthsFrom[where])
  const filter: ExpressionSpecification = ['all', tunnel ? inTunnel : aboveGround, road.filter]
  const strength = tunnel ? look.TUNNEL_OPACITY : 1
  const edge = line(
    `roads_${where}_${road.name}_edge`,
    filter,
    {
      'line-color': look.EDGE_COLOUR,
      'line-gap-width': width,
      'line-width': look.EDGE_WIDTH,
      'line-opacity': fading(strength),
      ...(tunnel ? { 'line-dasharray': look.TUNNEL_EDGE_DASHES } : {})
    },
    visible,
    road.minzoom
  )
  const fill = line(
    `roads_${where}_${road.name}`,
    filter,
    {
      'line-color': road.colour,
      'line-width': width,
      'line-opacity': fading(road.opacity * strength),
      ...(road.dashes ? { 'line-dasharray': road.dashes } : {})
    },
    visible,
    road.minzoom
  )
  return [edge, fill]
}

/** Railways above ground or in a tunnel: a light edge, a black line, white dashes on it. */
function railLayers(tunnel: boolean, visible: boolean): LayerSpecificationWithZIndex[] {
  const where = tunnel ? 'tunnel' : 'ground'
  const width = mapLineWidth('osm_rail')
  const filter: ExpressionSpecification = ['all', tunnel ? inTunnel : aboveGround, isRail]
  const opacity = fading(tunnel ? look.TUNNEL_OPACITY : 1)
  return [
    line(
      `rail_${where}_edge`,
      filter,
      {
        'line-color': look.RAIL_EDGE_COLOUR,
        'line-gap-width': width,
        'line-width': look.EDGE_WIDTH,
        'line-opacity': opacity
      },
      visible
    ),
    line(
      `rail_${where}`,
      filter,
      { 'line-color': look.RAIL_COLOUR, 'line-width': width, 'line-opacity': opacity },
      visible
    ),
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

/** The map's country borders, in a colour that shows on photos. */
function borderLayer(visible: boolean): LayerSpecificationWithZIndex {
  const border = mapLayer('boundaries_country')
  if (border.type !== 'line') throw new Error("The background map's borders aren't lines")
  return {
    ...border,
    id: `${PREFIX}borders`,
    zorder: 1,
    layout: { ...border.layout, visibility: visible ? 'visible' : 'none' },
    paint: { ...border.paint, 'line-color': look.BORDER_COLOUR }
  }
}

/** All of it, bottom to top: tunnels, roads, railways, borders. */
export function hybridLayers(visible: boolean): LayerSpecificationWithZIndex[] {
  return [
    ...ROAD_KINDS.flatMap((road) => roadLayers(road, true, visible)),
    ...railLayers(true, visible),
    ...ROAD_KINDS.flatMap((road) => roadLayers(road, false, visible)),
    ...railLayers(false, visible),
    borderLayer(visible)
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
