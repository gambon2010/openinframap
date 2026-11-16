// Fork: building outlines, a layer to switch on (Data layers → Background map →
// Buildings), over the map and over satellite imagery. Over imagery they're also
// filled like roofs, with a small shadow, so they read as buildings even on blurry
// imagery (the background map has its own fill under the outlines). Every building from zoom 15; zoomed out (12 to 14) those big enough to
// see there (fork/core/buildings.ts), all from the background map. Clickable anywhere
// inside (core/map-style.ts clickableArea): its details (height, area), and My
// layers' copy tool or the details' copy button make it an area of your own.
import { Layer, LayerGroup } from '@russss/maplibregl-layer-switcher'
import type {
  FillLayerSpecification,
  FilterSpecification,
  LineLayerSpecification,
  Map,
  MapGeoJSONFeature
} from 'maplibre-gl'
import { el } from 'redom'
import { t } from '../../core/i18n.ts'
import { formatArea } from '../../core/geo.ts'
import { clickableArea } from '../../core/map-style.ts'
import {
  BUILDINGS_LAYER,
  BUILDINGS_MINZOOM,
  BUILDINGS_PREFIX,
  BUILDINGS_SOURCE,
  BUILDINGS_SOURCE_LAYER,
  PARTS_LAYER,
  ZOOMED_OUT_LAYER,
  ZOOMED_OUT_MINZOOM,
  ZOOMED_OUT_SOURCE_LAYER,
  buildingOutline,
  isBuildingLayer,
  outlineArea
} from '../../core/buildings.ts'
import { followBackground } from '../../services/background.ts'
import { ForkModule } from '../../types.ts'
import { detailsCard } from '../../ui/details.ts'
import {
  OUTLINE,
  ROOF_COLOUR,
  ROOF_OPACITY,
  SHADOW_COLOUR,
  SHADOW_OFFSET,
  SHADOW_OPACITY
} from './buildings.constants.ts'

let theMap: Map | undefined

const OUTLINE_PAINT: LineLayerSpecification['paint'] = {
  'line-color': OUTLINE,
  'line-opacity': 0.8,
  'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.8, 15, 1, 18, 2, 20, 3]
}

const ZOOMED_OUT_FROM = {
  source: BUILDINGS_SOURCE,
  sourceLayer: ZOOMED_OUT_SOURCE_LAYER,
  minzoom: ZOOMED_OUT_MINZOOM,
  maxzoom: BUILDINGS_MINZOOM
}
const BUILDINGS_FROM = {
  source: BUILDINGS_SOURCE,
  sourceLayer: BUILDINGS_SOURCE_LAYER,
  filter: ['==', ['get', 'kind'], 'building'] as FilterSpecification,
  minzoom: BUILDINGS_MINZOOM
}

/** A building's shadow over imagery (`<id>_shadow`): its shape in dark, shifted down
 * and right on screen, under the roof. Not drawn over the map. */
function shadow(
  id: string,
  from: typeof ZOOMED_OUT_FROM | typeof BUILDINGS_FROM,
  zorder: number
): FillLayerSpecification & { zorder: number } {
  return {
    id: `${id}_shadow`,
    type: 'fill',
    zorder,
    source: from.source,
    'source-layer': from.sourceLayer,
    ...('filter' in from ? { filter: from.filter } : {}),
    minzoom: from.minzoom,
    ...('maxzoom' in from ? { maxzoom: from.maxzoom } : {}),
    paint: {
      'fill-color': SHADOW_COLOUR,
      'fill-opacity': SHADOW_OPACITY.map,
      'fill-translate': SHADOW_OFFSET,
      'fill-translate-anchor': 'viewport'
    }
  }
}

/** The layers filled like roofs over imagery (their `<id>_hit` fill), with a shadow:
 * whole buildings and the zoomed out ones. Parts lie inside buildings: a fill of
 * their own would darken them. */
const ROOFED = [BUILDINGS_LAYER, ZOOMED_OUT_LAYER]

const buildings: ForkModule = {
  layers: () => [
    shadow(ZOOMED_OUT_LAYER, ZOOMED_OUT_FROM, -10.6),
    shadow(BUILDINGS_LAYER, BUILDINGS_FROM, -10.6),
    // Zoomed out: those big enough to see at each zoom.
    ...clickableArea(ZOOMED_OUT_LAYER, ZOOMED_OUT_FROM, -10, OUTLINE_PAINT),
    // Parts under whole buildings: a click inside a building finds the building
    // first, whichever part it lands on. Parts with no building mapped around them
    // (about one in ten in Paris) are still clicked on their own.
    ...clickableArea(
      PARTS_LAYER,
      {
        source: BUILDINGS_SOURCE,
        sourceLayer: BUILDINGS_SOURCE_LAYER,
        filter: ['==', ['get', 'kind'], 'building_part'],
        minzoom: BUILDINGS_MINZOOM
      },
      -10.5,
      OUTLINE_PAINT
    ),
    // Every whole building, under everything else that's data: the infrastructure
    // is drawn and clicked first.
    ...clickableArea(BUILDINGS_LAYER, BUILDINGS_FROM, -10, OUTLINE_PAINT)
  ],

  switcherGroups: () => [
    new LayerGroup(t('layers.background-map', 'Background map'), [
      // K: a letter never used before (E and N were the removed Osmose and night lights).
      new Layer('K', t('layers.buildings', 'Buildings'), BUILDINGS_PREFIX, false)
    ])
  ],

  init: ({ map }) => {
    theMap = map
    for (const id of ROOFED) {
      // The clickable inside (invisible over the map) is the roof.
      followBackground(map, `${id}_hit`, 'fill-color', { map: '#000000', imagery: ROOF_COLOUR })
      followBackground(map, `${id}_hit`, 'fill-opacity', ROOF_OPACITY)
      followBackground(map, `${id}_shadow`, 'fill-opacity', SHADOW_OPACITY)
    }
  },

  popup: {
    html: (feature) => (isBuildingLayer(feature.layer.id) ? details(feature) : undefined)
  }
}

/** What there is to say about a building: little (the background map keeps its
 * outline, height and kind), plus its area on the ground. */
function details(feature: MapGeoJSONFeature): HTMLElement {
  const p = feature.properties
  const area = groundArea(feature)
  return detailsCard(
    t('buildings.building', 'Building'),
    [
      [t('buildings.height', 'Height'), typeof p.height === 'number' && `${Math.round(p.height)} m`],
      [
        t('buildings.starts-at', 'Starts at'),
        typeof p.min_height === 'number' && p.min_height > 0 && `${Math.round(p.min_height)} m`
      ],
      [t('buildings.area', 'Area (on the ground)'), area ? formatArea(area) : undefined]
    ],
    el('p.oim-extra-notice', t('buildings.source', 'From the background map (OpenStreetMap, via Protomaps).'))
  )
}

/** Square metres: zoomed out, measured whole when the tiles were made; closer, from
 * the outline joined across tiles. */
function groundArea(feature: MapGeoJSONFeature): number | undefined {
  const measuredWhenMade = feature.properties.area_m2
  if (typeof measuredWhenMade === 'number') return measuredWhenMade
  const outline = (theMap && buildingOutline(theMap, feature)) || feature.geometry
  if (outline.type !== 'Polygon' && outline.type !== 'MultiPolygon') return undefined
  return outlineArea(outline)
}

export default buildings
