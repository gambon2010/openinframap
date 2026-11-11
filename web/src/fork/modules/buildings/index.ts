// Fork: building outlines, a layer to switch on (Data layers → Background map →
// Buildings), over the map and over satellite imagery. Every building from zoom 15
// (fork/core/buildings.ts: only those tiles hold them all), from the background
// map already downloaded: nothing new to fetch. Not clickable (a click in a town
// would always land on one); My layers' copy tool copies them as areas.
import { Layer, LayerGroup } from '@russss/maplibregl-layer-switcher'
import { t } from '../../core/i18n.ts'
import {
  BUILDINGS_LAYER,
  BUILDINGS_MINZOOM,
  BUILDINGS_SOURCE,
  BUILDINGS_SOURCE_LAYER
} from '../../core/buildings.ts'
import { ForkModule } from '../../types.ts'

const buildings: ForkModule = {
  layers: () => [
    {
      id: BUILDINGS_LAYER,
      type: 'line',
      source: BUILDINGS_SOURCE,
      'source-layer': BUILDINGS_SOURCE_LAYER,
      minzoom: BUILDINGS_MINZOOM,
      filter: ['in', ['get', 'kind'], ['literal', ['building', 'building_part']]],
      // Under everything else that's data: the infrastructure is drawn over them.
      zorder: -10,
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': 'hsl(0, 0%, 15%)',
        'line-opacity': 0.75,
        'line-width': ['interpolate', ['linear'], ['zoom'], 15, 0.6, 18, 1.4, 20, 2]
      }
    }
  ],

  switcherGroups: () => [
    new LayerGroup(t('layers.background-map', 'Background map'), [
      // K: a letter never used before (E and N were the removed Osmose and night lights).
      new Layer('K', t('layers.buildings', 'Buildings (zoom 15 and closer)'), BUILDINGS_LAYER, false)
    ])
  ],

  init: ({ clickRouter }) => {
    // Every data layer gets the details popup (openinframap.ts); not this one.
    delete clickRouter.handlers[BUILDINGS_LAYER]
  }
}

export default buildings
