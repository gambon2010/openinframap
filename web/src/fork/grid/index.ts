// Fork: feature details in a side panel on the left (instead of upstream's popup),
// a highlight of what's selected, where a power line goes, and routes between two
// stations over the grid (backend: web-backend/src/fork/grid.py).
import { t } from 'i18next'
import { Map, MapGeoJSONFeature } from 'maplibre-gl'
import { el, mount } from 'redom'
import { ForkContext, ForkModule } from '../types.ts'
import type { SearchResult } from '../../search/search.ts'
import type InfoPopup from '../../popup/infopopup.ts'
import GridRouteControl, { StationKind } from './grid-route.ts'
import FeatureHighlight from './highlight.ts'
import InfoPanel from './info-panel.ts'

class Details {
  map: Map
  infoPopup: InfoPopup
  panel: InfoPanel
  route: GridRouteControl
  highlight: FeatureHighlight
  // The feature whose details are shown (source + osm_id), to deselect it on a second click.
  selected: string | null = null

  constructor(ctx: ForkContext) {
    this.map = ctx.map
    this.infoPopup = ctx.infoPopup
    // Left side, top to bottom: search, feature details, grid connection.
    this.panel = new InfoPanel()
    this.map.addControl(this.panel, 'top-left')
    this.route = new GridRouteControl(ctx.urlHash)
    this.map.addControl(this.route, 'top-left')
    // The map link was read before this existed: pick up a route from it.
    const fromLink = (ctx.urlHash as unknown as { additional: Record<string, string> }).additional['route']
    if (fromLink) this.route.fromHash(fromLink)
    this.highlight = new FeatureHighlight(this.map)

    // Opening a circuit from the details replaces them.
    const inspector = ctx.circuitInspector
    const show = inspector.show.bind(inspector)
    inspector.show = (id: number) => {
      this.panel.close()
      return show(id)
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.panel.isOpen()) this.panel.close()
    })
  }

  keyOf(feature: MapGeoJSONFeature): string | null {
    return feature.properties['osm_id'] !== undefined
      ? `${feature.source}:${feature.properties['osm_id']}`
      : null
  }

  /** A feature was clicked. */
  open(feature: MapGeoJSONFeature) {
    if (import.meta.env.DEV) {
      console.info('Clicked feature on layer', feature.layer.id, '\n', feature.properties)
    }
    // A second click on the same thing (its icon or its area) deselects it.
    if (this.keyOf(feature) && this.keyOf(feature) === this.selected && this.panel.isOpen()) {
      this.panel.close()
      return
    }
    void this.show(feature)
  }

  /** Substations and plants: "Route from here" / "Route to here". */
  routeButtons(feature: MapGeoJSONFeature): HTMLElement | null {
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
          this.route.setEnd(end, station)
          this.panel.close()
        }
      })
    return el(
      'div.oim-route-buttons',
      button(t('route.from-here', 'Route from here'), 'from'),
      button(t('route.to-here', 'Route to here'), 'to')
    )
  }

  /** Show a feature's details in the side panel and highlight it. */
  async show(feature: MapGeoJSONFeature) {
    const key = this.keyOf(feature)
    const content = await this.infoPopup.popupHtml(feature)
    const buttons = this.routeButtons(feature)
    if (buttons) mount(content, buttons)
    const highlight = this.highlight
    // Show the panel first: replacing the previous details runs their close
    // callback, which clears the previous highlight.
    this.panel.show(content, () => {
      highlight.clear()
      this.selected = null
    })
    this.route.fold()
    this.selected = key
    highlight.showFeature(feature)

    // Power lines: highlight the whole line up to its stations, and say which.
    if (feature.layer.id.startsWith('power_line') && feature.properties['osm_id'] !== undefined) {
      const info = await highlight.showLine(Number(feature.properties['osm_id']))
      if (info && content.isConnected) {
        content.insertBefore(info, content.querySelector('.oim-info-footer'))
      }
    }
  }

  /**
   * A search result was picked and the map is flying to it. Open its details like
   * a click would: substations and plants are looked up on the map once it's
   * there; other results (places, coordinates, addresses) get a short panel and a
   * ring at the location.
   */
  selectSearchResult(result: SearchResult) {
    const backend = result.backend
    const target =
      backend?.id !== undefined && (backend.type === 'substation' || backend.type === 'plant')
        ? { kind: backend.type, osm_id: backend.id }
        : null
    const found = () => {
      if (!target) return null
      const prefix = target.kind === 'substation' ? 'power_substation' : 'power_plant'
      const candidates = this.map
        .queryRenderedFeatures({
          layers: this.infoPopup.layers.filter((id) => id.startsWith(prefix) && this.map.getLayer(id)),
          filter: ['==', ['get', 'osm_id'], target.osm_id]
        })
        // Prefer the area: its details are the same, and it's what gets highlighted when visible.
        .sort(
          (a, b) => Number(b.geometry.type.endsWith('Polygon')) - Number(a.geometry.type.endsWith('Polygon'))
        )
      return candidates[0] || null
    }
    let done = false
    const open = () => {
      if (done) return
      done = true
      const feature = found()
      if (feature) {
        void this.show(feature)
        return
      }
      const content = el(
        'div.oim-popup-content',
        el('div.oim-popup-header', el('h3', result.name)),
        ...(result.description ? [el('p', result.description)] : [])
      )
      this.panel.show(content, () => {
        this.highlight.clear()
        this.selected = null
      })
      this.selected = null
      this.highlight.showPoint(result.longitude, result.latitude)
    }
    // After the flight, once the tiles there have loaded (or after a few seconds).
    this.map.once('moveend', () => this.map.once('idle', open))
    setTimeout(open, 6000)
  }
}

let details: Details | undefined

/** The left side panel, for other modules' details (My layers' editor). */
export function sidePanel(): InfoPanel | undefined {
  return details?.panel
}

/** Fold the grid connection to one line (something else is shown above it). */
export function foldRoute() {
  details?.route.fold()
}

const grid: ForkModule = {
  init: (ctx) => {
    details = new Details(ctx)
  },
  popup: {
    open: (feature) => {
      if (!details) return false
      details.open(feature)
      return true
    }
  },
  searchSelected: (result) => details?.selectSearchResult(result)
}

export default grid
