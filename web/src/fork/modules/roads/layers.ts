// Fork: the bold roads and borders (modules/roads), and every bold layer in order
// (railways, trams and metro: rail-layers.ts; how they're made: builder.ts). Roads at
// three quarters of the background map's widths, never thinner than a few pixels,
// coloured by importance; small roads and paths alike at every zoom, thinner zoomed
// out; tunnels dashed. Borders over imagery only (over the map, the map's own).
import type { ExpressionSpecification } from 'maplibre-gl'
import { LayerSpecificationWithZIndex } from '../../../style/types.ts'
import {
  Builder,
  FULL,
  Varying,
  ONLY_OVER_IMAGERY,
  fading,
  growing,
  tunnelOpacity,
  mapLayer,
  mapLineWidth,
  resized
} from './builder.ts'
import { addTracks } from './rail-layers.ts'
import * as look from './roads.constants.ts'
import type { Looks } from './roads.constants.ts'

/** Each set's layers start with its prefix: the layer switcher's entries switch
 * them by it (index.ts; railways' and trams': rail-layers.ts). Borders under
 * upstream's Borders entry, by its prefix. */
export const ROADS_PREFIX = 'roads_'
export const BORDERS_PREFIX = 'boundaries_'

/** A kind of road, from the smallest to motorways (drawn in that order). */
export interface RoadKind {
  name: string
  /** Which roads, tunnels or not. */
  filter: ExpressionSpecification
  /** The background map's layer it takes its widths from (tunnels too: the road's size). */
  widthFrom: string
  colour: Looks<string>
  opacity: Looks<number>
  /** Never thinner than this (pixels): the map's widths go down to nothing zoomed out. */
  minWidth: number
  /** Small roads and paths: their edge comes in gradually as they widen (thin, a full
   * edge would make them dark lines). */
  small?: true
  dashes?: number[]
}

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

export const ROAD_KINDS: RoadKind[] = [
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

/** A kind of road's layers' ids start with this (the key's rows hide them by it). */
export const roadKindPrefixes = (road: RoadKind) => [
  `${ROADS_PREFIX}tunnel_${road.name}`,
  `${ROADS_PREFIX}ground_${road.name}`
]

/** A kind of road above ground (its edge, then the road) or in a tunnel (the road
 * see-through, without an edge). */
function addRoad(b: Builder, road: RoadKind, tunnel: boolean) {
  const where = tunnel ? 'tunnel' : 'ground'
  const width = resized(mapLineWidth(road.widthFrom), look.ROAD_WIDTH_SCALE, road.minWidth)
  const filter: ExpressionSpecification = ['all', tunnel ? inTunnel : aboveGround, road.filter]
  const dashes = road.dashes
  if (!tunnel)
    b.line(`${ROADS_PREFIX}${where}_${road.name}_edge`, filter, {
      'line-color': look.EDGE_COLOUR,
      'line-gap-width': width,
      'line-width': road.small ? growing(look.EDGE_WIDTH) : look.EDGE_WIDTH,
      'line-opacity': fading(FULL)
    })
  b.line(`${ROADS_PREFIX}${where}_${road.name}`, filter, {
    'line-color': road.colour,
    'line-width': width,
    'line-opacity': fading(tunnelOpacity(road.opacity, tunnel)),
    ...(dashes ? { 'line-dasharray': dashes } : {})
  })
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

/** Every layer, bottom to top (tunnels, roads, railways, trams and metro, borders),
 * and the paint values that vary with the look or the background. */
export function roadLayers(): { layers: LayerSpecificationWithZIndex[]; varying: Varying[] } {
  const b = new Builder()
  for (const road of ROAD_KINDS) addRoad(b, road, true)
  addTracks(b, true)
  for (const road of ROAD_KINDS) addRoad(b, road, false)
  addTracks(b, false)
  addBorders(b)
  return { layers: b.layers, varying: b.varying }
}
