// Fork: the power grid. Routes between two stations (the Grid connection panel,
// grid-route.ts), "Route from / to here" in a substation's or plant's details,
// and where a clicked power line goes (line.ts). Backend: web-backend/src/fork/grid/.
import { t } from '../../core/i18n.ts'
import { MapGeoJSONFeature } from 'maplibre-gl'
import { el, mount } from 'redom'
import { ForkModule } from '../../types.ts'
import { addDetailsExtra } from '../../ui/details.ts'
import { LEFT_ORDER, leftColumn } from '../../ui/left-column.ts'
import GridRouteControl from './grid-route.ts'
import type { StationKind } from './grid-route.types.ts'
import { showLine } from './line.ts'
import { hideUpstreamTowerLabels, towerDetails, towerNumberLayers } from './towers.ts'

/** Substations and plants: "Route from here" / "Route to here". */
function routeButtons(feature: MapGeoJSONFeature, route: GridRouteControl): HTMLElement | null {
  const layer_id = feature.layer.id
  const kind: StationKind | null = layer_id.startsWith('power_substation')
    ? 'substation'
    : layer_id.startsWith('power_plant')
      ? 'plant'
      : null
  if (!kind || feature.properties['osm_id'] === undefined) return null
  const station = {
    kind,
    osm_id: Number(feature.properties['osm_id']),
    name: feature.properties['name'] || null
  }
  const button = (label: string, end: 'from' | 'to') =>
    el('button.oim-button', label, {
      type: 'button',
      onclick: () => {
        route.setEnd(end, station)
        leftColumn.details.close()
      }
    })
  return el(
    'div.oim-route-buttons',
    button(t('route.from-here', 'Route from here'), 'from'),
    button(t('route.to-here', 'Route to here'), 'to')
  )
}

const grid: ForkModule = {
  layers: towerNumberLayers,
  init: (ctx) => {
    const route = new GridRouteControl(ctx.urlHash)
    leftColumn.addControl(route, LEFT_ORDER.route)
    // The map link was read before this existed: pick up a route from it.
    const fromLink = (ctx.urlHash as unknown as { additional: Record<string, string> }).additional['route']
    if (fromLink) route.fromHash(fromLink)
    // Whatever the details panel shows, the route folds to one line below it.
    leftColumn.details.onShow(() => route.fold())

    addDetailsExtra((feature, content) => {
      const buttons = routeButtons(feature, route)
      if (buttons) mount(content, buttons)
    })
    // Power lines: highlight the whole line up to its stations, and say which.
    addDetailsExtra(async (feature, content) => {
      if (!feature.layer.id.startsWith('power_line') || feature.properties['osm_id'] === undefined) return
      const info = await showLine(ctx.map, leftColumn.highlight, Number(feature.properties['osm_id']))
      if (info && content.isConnected) content.insertBefore(info, content.querySelector('.oim-info-footer'))
    })
    // Towers: their number along each line they carry, and short labels.
    addDetailsExtra(towerDetails)
    hideUpstreamTowerLabels(ctx.map)
  }
}

export default grid
