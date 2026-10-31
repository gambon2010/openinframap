// Fork: a clicked map feature's details in the left details panel (instead of
// upstream's popup), with the feature highlighted; a second click on it closes
// them, and a click near a line selects it (near-click.ts). Shift-click picks
// features for acting on several at once (ui/selection.ts). Search results open
// the same way. Other modules add to the details with
// addDetailsExtra (ui/details.ts), e.g. the grid's "Route from here". A circuit
// opened from them shows below them (circuit.ts).
import { Map, MapGeoJSONFeature } from 'maplibre-gl'
import { el } from 'redom'
import { ForkContext, ForkModule } from '../../types.ts'
import type { SearchResult } from '../../../search/search.ts'
import type InfoPopup from '../../../popup/infopopup.ts'
import { DetailsPanel, detailsExtras } from '../../ui/details.ts'
import { FeatureHighlight } from '../../ui/highlight.ts'
import { leftColumn } from '../../ui/left-column.ts'
import { selection } from '../../ui/selection.ts'
import { selectNearLines } from './near-click.ts'
import { circuitBelowDetails } from './circuit.ts'

class Details {
  map: Map
  infoPopup: InfoPopup
  panel: DetailsPanel
  highlight: FeatureHighlight
  // The feature whose details are shown (source + osm_id), to deselect it on a second click.
  selected: string | null = null

  constructor(ctx: ForkContext) {
    this.map = ctx.map
    this.infoPopup = ctx.infoPopup
    this.panel = leftColumn.details
    this.highlight = leftColumn.highlight

    // A circuit opened from the details ("View") shows below them.
    circuitBelowDetails(ctx.circuitInspector, this.panel)
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
    // Shift-click: added to (or taken out of) the selection instead (ui/selection.ts).
    if (selection.shift && selection.toggle(feature)) return
    // A second click on the same thing (its icon or its area) deselects it.
    if (this.keyOf(feature) && this.keyOf(feature) === this.selected && this.panel.isOpen()) {
      this.panel.close()
      return
    }
    void this.show(feature)
  }

  /** Show a feature's details in the side panel and highlight it. */
  async show(feature: MapGeoJSONFeature) {
    const key = this.keyOf(feature)
    const content = await this.infoPopup.popupHtml(feature)
    const highlight = this.highlight
    // Show the panel first: replacing the previous details runs their close
    // callback, which clears the previous highlight.
    this.panel.show(content, () => {
      highlight.clear()
      this.selected = null
    })
    this.selected = key
    highlight.showFeature(feature)
    for (const extra of detailsExtras()) extra(feature, content)
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

const detailsModule: ForkModule = {
  init: (ctx) => {
    details = new Details(ctx)
    selectNearLines(ctx.map, ctx.clickRouter)
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

export default detailsModule
