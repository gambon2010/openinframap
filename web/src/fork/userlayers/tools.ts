// Fork: what clicking the map does in "My layers": select (and drag points to move
// them), place a symbol/picture/marker, draw a line or an area, or copy a map
// feature into the active layer (with its full geometry from the backend).
import { tt } from './i18n.ts'
import { Map, MapGeoJSONFeature, MapMouseEvent, PointLike } from 'maplibre-gl'
import { LayerSpecificationWithZIndex } from '../../style/types.ts'
import { Store } from './store.ts'
import { Renderer } from './render.ts'
import { FeatureProps, UserFeature } from './model.ts'
import { sourceGeometry } from './api.ts'

export type Tool =
  | { mode: 'select' }
  | { mode: 'place'; properties: FeatureProps }
  | { mode: 'line' | 'area'; points: [number, number][] }
  | { mode: 'copy' }

export class Tools {
  tool: Tool = { mode: 'select' }
  selected: string | null = null
  /** Disabled while the history is played back. */
  enabled = true
  message = ''
  private map: Map
  private store: Store
  private renderer: Renderer
  private primaryLayers: () => LayerSpecificationWithZIndex[]
  private listeners: (() => void)[] = []
  private dragging: { feature: UserFeature; layerId: string } | null = null
  // The last click My layers took (decided before it changes the tool).
  private captured: Event | null = null

  constructor(
    map: Map,
    store: Store,
    renderer: Renderer,
    primaryLayers: () => LayerSpecificationWithZIndex[]
  ) {
    this.map = map
    this.store = store
    this.renderer = renderer
    this.primaryLayers = primaryLayers
    map.on('click', (e) => void this.click(e))
    map.on('dblclick', (e) => {
      if (this.tool.mode === 'line' || this.tool.mode === 'area') {
        e.preventDefault()
        this.finishDrawing()
      }
    })
    map.on('mousemove', (e) => this.mousemove(e))
    map.on('mousedown', (e) => this.mousedown(e))
    map.on('mouseup', () => this.mouseup())
    document.addEventListener('keydown', (e) => this.keydown(e))
  }

  onChange(listener: () => void) {
    this.listeners.push(listener)
  }

  private notify() {
    for (const listener of this.listeners) listener()
  }

  setTool(tool: Tool, message = '') {
    this.tool = tool
    this.message = message
    if (tool.mode === 'line' || tool.mode === 'area') this.map.doubleClickZoom.disable()
    else this.map.doubleClickZoom.enable()
    this.renderer.draft([], false)
    this.map.getCanvas().style.cursor = tool.mode === 'select' ? '' : 'crosshair'
    this.notify()
  }

  select(featureId: string | null) {
    this.selected = featureId
    const layer = featureId ? this.store.layerOf(featureId) : undefined
    this.renderer.select(layer?.features.get(featureId!) ?? null)
    this.notify()
  }

  /** The active layer, made if there's none yet. */
  private activeLayer(): string {
    if (this.store.activeLayer && this.store.layers.has(this.store.activeLayer)) return this.store.activeLayer
    return this.store.createLayer(tt('userlayers.default-name', 'My layer'))
  }

  /** My layers' feature under a point, if any. */
  private hit(point: PointLike): MapGeoJSONFeature | undefined {
    const layers = this.renderer.featureLayerIds()
    if (!layers.length) return undefined
    const [x, y] = Array.isArray(point) ? point : [point.x, point.y]
    return this.map.queryRenderedFeatures(
      [
        [x - 5, y - 5],
        [x + 5, y + 5]
      ],
      { layers }
    )[0]
  }

  /** Whether a click is for My layers, so upstream's popups should ignore it. */
  capturesClick(e: MapMouseEvent): boolean {
    if (!this.enabled) return false
    return e.originalEvent === this.captured || this.tool.mode !== 'select' || this.hit(e.point) !== undefined
  }

  private async click(e: MapMouseEvent) {
    if (!this.enabled) return
    // This runs before upstream's click router, which asks capturesClick().
    if (this.capturesClick(e)) this.captured = e.originalEvent
    const lngLat: [number, number] = [e.lngLat.lng, e.lngLat.lat]
    switch (this.tool.mode) {
      case 'place': {
        const id = this.store.addFeature(
          this.activeLayer(),
          { type: 'Point', coordinates: lngLat },
          {
            ...this.tool.properties
          }
        )
        this.setTool({ mode: 'select' })
        this.select(id)
        break
      }
      case 'line':
      case 'area':
        this.tool.points.push(lngLat)
        this.renderer.draft(this.tool.points, this.tool.mode === 'area')
        break
      case 'copy':
        await this.copyAt(e)
        break
      case 'select': {
        const hit = this.hit(e.point)
        this.select(hit ? String(hit.properties.fid) : null)
        break
      }
    }
  }

  finishDrawing() {
    if (this.tool.mode !== 'line' && this.tool.mode !== 'area') return
    // A double-click adds the same point twice.
    const points = this.tool.points.filter(
      (p, i, all) => i === 0 || p[0] !== all[i - 1][0] || p[1] !== all[i - 1][1]
    )
    const area = this.tool.mode === 'area'
    if (points.length >= (area ? 3 : 2)) {
      const geometry: GeoJSON.Geometry = area
        ? { type: 'Polygon', coordinates: [[...points, points[0]]] }
        : { type: 'LineString', coordinates: points }
      const id = this.store.addFeature(this.activeLayer(), geometry, { kind: 'drawing' })
      this.setTool({ mode: 'select' })
      this.select(id)
    } else {
      this.setTool({ mode: 'select' })
    }
  }

  private async copyAt(e: MapMouseEvent) {
    // The topmost map feature (upstream's or the fork's data layers) under the click.
    const order = new globalThis.Map(this.primaryLayers().map((l) => [l.id, l.zorder]))
    const candidates = this.map
      .queryRenderedFeatures([
        [e.point.x - 4, e.point.y - 4],
        [e.point.x + 4, e.point.y + 4]
      ])
      .filter((f) => order.has(f.layer.id) && f.sourceLayer && !f.layer.id.startsWith('user_'))
      .sort((a, b) => (order.get(b.layer.id) ?? 0) - (order.get(a.layer.id) ?? 0))
    const f = candidates[0]
    if (!f) {
      this.message = tt(
        'userlayers.copy.nothing',
        'Nothing to copy there: click a line, a substation, a site...'
      )
      this.notify()
      return
    }
    const id = Number(f.properties.osm_id ?? f.properties.id)
    const layerId = this.activeLayer()
    const key = `${f.source}/${f.sourceLayer}`
    const layer = this.store.layers.get(layerId)!
    for (const existing of layer.features.values()) {
      const c = existing.properties.copy
      if (
        c &&
        `${c.source}/${c.sourceLayer}` === key &&
        Number(existing.properties.osm_id ?? existing.properties.id) === id
      ) {
        this.message = tt('userlayers.copy.already', 'Already in this layer.')
        this.select(existing.id)
        return
      }
    }
    let geometry: GeoJSON.Geometry = f.geometry
    if (f.geometry.type !== 'Point' && Number.isFinite(id)) {
      geometry = (await sourceGeometry(f.sourceLayer!, id)) ?? f.geometry
    }
    const properties: FeatureProps = {
      ...(f.properties as Record<string, unknown>),
      kind: 'copy',
      copy: { source: f.source, sourceLayer: f.sourceLayer!, layer: f.layer.id }
    }
    const featureId = this.store.addFeature(layerId, geometry, properties)
    this.message = tt('userlayers.copy.done', 'Copied. Click more features to copy them, or Esc to stop.')
    this.select(featureId)
  }

  private mousedown(e: MapMouseEvent) {
    if (!this.enabled || this.tool.mode !== 'select' || !this.selected) return
    const hit = this.hit(e.point)
    if (!hit || String(hit.properties.fid) !== this.selected) return
    const layer = this.store.layerOf(this.selected)
    const feature = layer?.features.get(this.selected)
    if (!layer || !feature || feature.geometry.type !== 'Point') return
    e.preventDefault()
    this.map.dragPan.disable()
    // Moved on a copy, saved as one change on mouseup.
    this.dragging = { feature: structuredClone(feature), layerId: layer.id }
  }

  private mousemove(e: MapMouseEvent) {
    if (this.tool.mode !== 'select') this.map.getCanvas().style.cursor = 'crosshair'
    if (!this.dragging) return
    const geometry = this.dragging.feature.geometry as GeoJSON.Point
    geometry.coordinates = [e.lngLat.lng, e.lngLat.lat]
    this.renderer.select(this.dragging.feature)
  }

  private mouseup() {
    if (!this.dragging) return
    const { feature, layerId } = this.dragging
    this.dragging = null
    this.map.dragPan.enable()
    this.store.updateFeature(layerId, feature)
    this.select(feature.id)
  }

  private keydown(e: KeyboardEvent) {
    if (!this.enabled) return
    const target = e.target as HTMLElement
    if (target.closest('input, textarea, select')) return
    if (e.key === 'Escape') {
      if (this.tool.mode !== 'select') this.setTool({ mode: 'select' })
      else this.select(null)
    } else if (e.key === 'Enter') {
      this.finishDrawing()
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected) {
      this.deleteSelected()
    }
  }

  deleteSelected() {
    if (!this.selected) return
    const layer = this.store.layerOf(this.selected)
    if (layer) this.store.deleteFeature(layer.id, this.selected)
    this.select(null)
  }
}
