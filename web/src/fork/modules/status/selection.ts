// Fork: the features picked with Shift-click (ui/selection.ts): outlined on the map,
// listed in a panel in the left column, with a form setting their status together.
import { GeoJSONSource, Map, MapGeoJSONFeature } from 'maplibre-gl'
import { el, setChildren } from 'redom'
import { t } from '../../core/i18n.ts'
import { sourceGeometry } from '../../core/map-data.ts'
import { closeButton } from '../../ui/details.ts'
import { LEFT_ORDER, leftColumn } from '../../ui/left-column.ts'
import { selection } from '../../services/selection.ts'
import { Field, canHaveStatus, fieldsOf } from './fields.ts'
import { FeatureRef, saveStatus, statusForm } from './form.ts'
import { geometryIs } from '../../core/map-style.ts'

const SOURCE = 'feature_selection'
const COLOR = '#7048e8'

function name(feature: MapGeoJSONFeature): string {
  return (
    feature.properties['name'] ||
    `${feature.sourceLayer} ${feature.properties['osm_id'] ?? feature.properties['id']}`
  )
}

function refOf(feature: MapGeoJSONFeature): FeatureRef {
  return {
    layer: feature.sourceLayer ?? '',
    id: Number(feature.properties['osm_id'] ?? feature.properties['id']),
    name: feature.properties['name'],
    fields: fieldsOf(feature)
  }
}

export class SelectionPanel {
  private el: HTMLElement
  private body = el('div.oim-side-panel-body')
  // Whole shapes (tiles have them cut at their edges), once fetched.
  private shapes = new globalThis.Map<string, GeoJSON.Geometry>()

  constructor(
    private map: Map,
    private onSaved: () => void
  ) {
    this.el = el(
      'div.maplibregl-ctrl.oim-side-panel.oim-selection-panel',
      el(
        'div.oim-side-panel-buttons',
        closeButton(() => selection.clear())
      ),
      this.body
    )
    leftColumn.add(this.el, LEFT_ORDER.selection)
    this.addLayers()
    map.on('style.load', () => this.addLayers())
    selection.onChange(() => this.show())
  }

  private addLayers() {
    if (this.map.getSource(SOURCE)) return
    this.map.addSource(SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    const kind = (...types: string[]) => geometryIs(...types) as never
    this.map.addLayer({
      id: 'feature_selection_line',
      type: 'line',
      source: SOURCE,
      filter: kind('LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'),
      paint: { 'line-color': COLOR, 'line-width': 4, 'line-dasharray': [2, 1], 'line-opacity': 0.9 }
    })
    this.map.addLayer({
      id: 'feature_selection_point',
      type: 'circle',
      source: SOURCE,
      filter: kind('Point', 'MultiPoint'),
      paint: {
        'circle-radius': 18,
        'circle-opacity': 0,
        'circle-stroke-color': COLOR,
        'circle-stroke-width': 3
      }
    })
    this.draw()
  }

  private draw() {
    const source = this.map.getSource(SOURCE) as GeoJSONSource | undefined
    source?.setData({
      type: 'FeatureCollection',
      features: selection.features.map(([id, f]) => ({
        type: 'Feature',
        geometry: this.shapes.get(id) ?? f.geometry,
        properties: {}
      }))
    })
    for (const [id, f] of selection.features) {
      if (this.shapes.has(id) || !f.sourceLayer) continue
      this.shapes.set(id, f.geometry)
      void sourceGeometry(f.sourceLayer, refOf(f).id).then((shape) => {
        if (!shape) return
        this.shapes.set(id, shape)
        this.draw()
      })
    }
  }

  private show(message?: string) {
    this.draw()
    const picked = selection.features
    this.el.classList.toggle('visible', picked.length > 0)
    if (!picked.length) return
    const list = el(
      'ul.oim-selection-list',
      picked.map(([id, feature]) =>
        el(
          'li',
          el('span', name(feature)),
          el('button.oim-selection-remove', '×', {
            type: 'button',
            title: t('selection.remove', 'Take out of the selection'),
            onclick: () => selection.remove(id)
          })
        )
      )
    )
    const setAll = el('button.oim-button', t('selection.set-status', 'Set status for all'), {
      type: 'button',
      onclick: () => setChildren(this.body, [title, list, this.form()])
    })
    const title = el(
      'div.oim-popup-header',
      el('h3', t('selection.title', '{{count}} selected', { count: picked.length }))
    )
    setChildren(
      this.body,
      [
        title,
        el('p.oim-selection-hint', t('selection.hint', 'Shift-click on the map to add or take out.')),
        list,
        message ? el('p.oim-selection-saved', message) : null,
        setAll
      ].filter(Boolean) as HTMLElement[]
    )
  }

  private form(): HTMLElement {
    // Small parts (switches, poles...) are left out: they can't have a status.
    const features = selection.features
      .filter(([, f]) => canHaveStatus(f.sourceLayer, f.properties))
      .map(([, f]) => refOf(f))
    // The extra fields any of them has; each gets only its own.
    const fields = [
      ...new globalThis.Map(features.flatMap((f) => f.fields).map((f) => [f.key, f])).values()
    ] as Field[]
    return statusForm({
      fields,
      submitLabel: t('selection.save', 'Save for all {{count}}', { count: features.length }),
      onSubmit: async (values) => {
        await saveStatus(features, values)
        this.onSaved()
        this.show(t('selection.saved', 'Saved for {{count}} features.', { count: features.length }))
      },
      onCancel: () => this.show()
    })
  }
}
