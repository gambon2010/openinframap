// Fork: building outlines, a layer to switch on (Data layers → Background map →
// Buildings), over the map and over satellite imagery, filled like roofs over
// imagery and raised in the 3D view (look.ts). Every building from zoom 15; zoomed
// out (12 to 14) those big enough to see there (fork/core/buildings.ts), all from the
// background map. Clickable anywhere inside: its details (height, area), and My
// layers' copy tool or the details' copy button make it an area of your own.
import { Layer, LayerGroup } from '@russss/maplibregl-layer-switcher'
import type { Map, MapGeoJSONFeature } from 'maplibre-gl'
import { el } from 'redom'
import { t } from '../../core/i18n.ts'
import { formatArea } from '../../core/geo.ts'
import {
  BUILDINGS_PREFIX,
  BUILDINGS_SWITCHER_ID,
  buildingOutline,
  isBuildingLayer,
  outlineArea
} from '../../core/buildings.ts'
import { ForkModule } from '../../types.ts'
import { detailsCard } from '../../ui/details.ts'
import { buildingLayers, followLook } from './look.ts'

let theMap: Map | undefined

const buildings: ForkModule = {
  layers: buildingLayers,

  switcherGroups: () => [
    new LayerGroup(t('layers.background-map', 'Background map'), [
      new Layer(BUILDINGS_SWITCHER_ID, t('layers.buildings', 'Buildings'), BUILDINGS_PREFIX, false)
    ])
  ],

  init: ({ map }) => {
    theMap = map
    followLook(map)
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
