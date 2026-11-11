// Fork: building outlines, a layer to switch on (Data layers → Background map →
// Buildings), over the map and over satellite imagery: dark on the map, white on
// imagery. Every building from zoom 15 (fork/core/buildings.ts: only those tiles
// hold them all), from the background map already downloaded. Clickable anywhere
// inside (core/map-style.ts clickableArea): its details (height, area), and My
// layers' copy tool or the details' copy button make it an area of your own.
import { Layer, LayerGroup } from '@russss/maplibregl-layer-switcher'
import type { Map, MapGeoJSONFeature } from 'maplibre-gl'
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
  buildingId,
  buildingOutline,
  isBuildingLayer,
  outlineArea
} from '../../core/buildings.ts'
import { followBackground } from '../../services/background.ts'
import { ForkModule } from '../../types.ts'

const OUTLINE = { map: 'hsl(0, 0%, 15%)', imagery: '#ffffff' }

let theMap: Map | undefined

const buildings: ForkModule = {
  layers: () =>
    clickableArea(
      BUILDINGS_LAYER,
      {
        source: BUILDINGS_SOURCE,
        sourceLayer: BUILDINGS_SOURCE_LAYER,
        filter: ['in', ['get', 'kind'], ['literal', ['building', 'building_part']]],
        minzoom: BUILDINGS_MINZOOM
      },
      // Under everything else that's data: the infrastructure is drawn and clicked first.
      -10,
      {
        'line-color': OUTLINE.map,
        'line-opacity': 0.8,
        'line-width': ['interpolate', ['linear'], ['zoom'], 15, 0.6, 18, 1.4, 20, 2]
      }
    ),

  switcherGroups: () => [
    new LayerGroup(t('layers.background-map', 'Background map'), [
      // K: a letter never used before (E and N were the removed Osmose and night lights).
      new Layer('K', t('layers.buildings', 'Buildings (zoom 15 and closer)'), BUILDINGS_PREFIX, false)
    ])
  ],

  init: ({ map }) => {
    theMap = map
    followBackground(map, BUILDINGS_LAYER, 'line-color', OUTLINE)
  },

  popup: {
    html: (feature) => (isBuildingLayer(feature.layer.id) ? details(feature) : undefined)
  }
}

/** What there is to say about a building: little (the background map keeps its
 * outline, height and kind), plus its area worked out from the outline. */
function details(feature: MapGeoJSONFeature): HTMLElement {
  const p = feature.properties
  const id = buildingId(feature)
  const outline = (theMap && id !== undefined && buildingOutline(theMap, id)) || feature.geometry
  const area =
    outline.type === 'Polygon' || outline.type === 'MultiPolygon' ? outlineArea(outline) : undefined
  const rows: [string, string | undefined][] = [
    [t('buildings.height', 'Height'), typeof p.height === 'number' ? `${Math.round(p.height)} m` : undefined],
    [
      t('buildings.starts-at', 'Starts at'),
      typeof p.min_height === 'number' && p.min_height > 0 ? `${Math.round(p.min_height)} m` : undefined
    ],
    [t('buildings.area', 'Area (on the ground)'), area ? formatArea(area) : undefined]
  ]
  return el(
    'div.oim-popup-content',
    el(
      'div.oim-popup-header',
      el(
        'h3',
        p.kind === 'building_part'
          ? t('buildings.part', 'Part of a building')
          : t('buildings.building', 'Building')
      )
    ),
    el(
      'table.item_info',
      rows
        .filter(([, value]) => value)
        .map(([key, value]) => el('tr', el('th', key), el('td', value as string)))
    ),
    el('p.oim-extra-notice', t('buildings.source', 'From the background map (OpenStreetMap, via Protomaps).'))
  )
}

export default buildings
