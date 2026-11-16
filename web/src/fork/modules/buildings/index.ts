// Fork: building outlines, a layer to switch on (Data layers → Background map →
// Buildings), over the map and over satellite imagery: dark on the map, white on
// imagery. Every building from zoom 15; zoomed out (12 to 14) those big enough to
// see there (fork/core/buildings.ts), all from the background map. Clickable anywhere
// inside (core/map-style.ts clickableArea): its details (height, area), and My
// layers' copy tool or the details' copy button make it an area of your own.
import { Layer, LayerGroup } from '@russss/maplibregl-layer-switcher'
import type { LineLayerSpecification, Map, MapGeoJSONFeature } from 'maplibre-gl'
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

const OUTLINE = { map: 'hsl(0, 0%, 15%)', imagery: '#ffffff' }

let theMap: Map | undefined

const OUTLINE_PAINT: LineLayerSpecification['paint'] = {
  'line-color': OUTLINE.map,
  'line-opacity': 0.8,
  'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.8, 15, 1, 18, 2, 20, 3]
}

const buildings: ForkModule = {
  layers: () => [
    // Zoomed out: those big enough to see at each zoom.
    ...clickableArea(
      ZOOMED_OUT_LAYER,
      {
        source: BUILDINGS_SOURCE,
        sourceLayer: ZOOMED_OUT_SOURCE_LAYER,
        minzoom: ZOOMED_OUT_MINZOOM,
        maxzoom: BUILDINGS_MINZOOM
      },
      -10,
      OUTLINE_PAINT
    ),
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
    ...clickableArea(
      BUILDINGS_LAYER,
      {
        source: BUILDINGS_SOURCE,
        sourceLayer: BUILDINGS_SOURCE_LAYER,
        filter: ['==', ['get', 'kind'], 'building'],
        minzoom: BUILDINGS_MINZOOM
      },
      -10,
      OUTLINE_PAINT
    )
  ],

  switcherGroups: () => [
    new LayerGroup(t('layers.background-map', 'Background map'), [
      // K: a letter never used before (E and N were the removed Osmose and night lights).
      new Layer('K', t('layers.buildings', 'Buildings'), BUILDINGS_PREFIX, false)
    ])
  ],

  init: ({ map }) => {
    theMap = map
    followBackground(map, BUILDINGS_LAYER, 'line-color', OUTLINE)
    followBackground(map, PARTS_LAYER, 'line-color', OUTLINE)
    followBackground(map, ZOOMED_OUT_LAYER, 'line-color', OUTLINE)
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
