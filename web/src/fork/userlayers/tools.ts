// Fork: what clicking the map does in "My layers": select (and drag a symbol, or
// the points of a line, area or graphic, to move them), place a symbol / picture /
// marker, draw a line, an area or a tactical graphic (by its control points), or
// copy a map feature into the active layer (with its full geometry from the backend).
import { tt } from './i18n.ts'
import { Map, MapGeoJSONFeature, MapMouseEvent, PointLike } from 'maplibre-gl'
import { LayerSpecificationWithZIndex } from '../../style/types.ts'
import { Store } from './store.ts'
import { Renderer, controlPoints, moveVertex, sizeFromDrag } from './render.ts'
import { axisWidthFrom, defaultAxisWidth } from './graphics.ts'
import { FeatureProps, UserFeature } from './model.ts'
import { sourceGeometry } from './api.ts'

export type Tool =
  | { mode: 'select' }
  | { mode: 'place'; properties: FeatureProps }
  | { mode: 'line' | 'area'; points: [number, number][] }
  | { mode: 'copy' }
  | {
      mode: 'graphic'
      properties: FeatureProps
      points: [number, number][]
      min: number
      max: number
      /** An arrow: drawn as a path from tail to tip, its width set afterwards. */
      axis?: boolean
    }

/** Modes that add points one click at a time. */
function drawing(tool: Tool): tool is Extract<Tool, { points: [number, number][] }> {
  return tool.mode === 'line' || tool.mode === 'area' || tool.mode === 'graphic'
}

/** A graphic's control points as a geometry (a line through them, or one point). */
export function graphicGeometry(points: [number, number][]): GeoJSON.Geometry {
  return points.length > 1
    ? { type: 'LineString', coordinates: points }
    : { type: 'MultiPoint', coordinates: points }
}

/** Points of a drawing, without the repeats a double-click adds. */
export function dropRepeats(points: [number, number][]): [number, number][] {
  return points.filter((p, i, all) => i === 0 || p[0] !== all[i - 1][0] || p[1] !== all[i - 1][1])
}

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
  // index: the point of a line, area or graphic being moved (none: a whole symbol);
  // resize: the image is being resized (its centre on screen, and the handle's
  // distance from it at size 1).
  private dragging: {
    feature: UserFeature
    layerId: string
    index?: number
    resize?: { x: number; y: number; distanceAtSize1: number }
  } | null = null
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
      if (drawing(this.tool)) {
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
    if (drawing(tool)) this.map.doubleClickZoom.disable()
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
      case 'graphic':
        this.tool.points.push(lngLat)
        this.renderer.draft(this.tool.points, false)
        // Graphics with a fixed number of points (block, breach...) finish by themselves.
        if (this.tool.points.length >= this.tool.max) this.finishDrawing()
        else this.notify()
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
    if (!drawing(this.tool)) return
    // A double-click adds the same point twice.
    const points = dropRepeats(this.tool.points)
    if (this.tool.mode === 'graphic') {
      if (points.length < this.tool.min) {
        this.message = tt('userlayers.graphic-more', 'This graphic needs at least {{n}} points.', {
          n: this.tool.min
        })
        this.notify()
        return
      }
      const properties = this.tool.axis
        ? { ...this.tool.properties, axisWidth: defaultAxisWidth(points) }
        : this.tool.properties
      const id = this.store.addFeature(this.activeLayer(), graphicGeometry(points), properties)
      this.setTool({ mode: 'select' })
      this.select(id)
      return
    }
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
    const layer = this.store.layerOf(this.selected)
    const feature = layer?.features.get(this.selected)
    if (!layer || !feature || feature.properties.kind === 'copy') return
    // The resize handle of a picture, symbol or marker.
    if (this.handleAt(e.point, 'user_selection_resize')) {
      const half = this.renderer.iconHalfSize(feature)
      if (half) {
        e.preventDefault()
        this.map.dragPan.disable()
        const centre = this.map.project((feature.geometry as GeoJSON.Point).coordinates as [number, number])
        this.dragging = {
          feature: structuredClone(feature),
          layerId: layer.id,
          resize: { x: centre.x, y: centre.y, distanceAtSize1: Math.hypot(half[0], half[1]) }
        }
        return
      }
    }
    // A point handle of the selected line, area or graphic.
    const handle = this.map.getLayer('user_selection_vertex')
      ? this.map.queryRenderedFeatures(
          [
            [e.point.x - 6, e.point.y - 6],
            [e.point.x + 6, e.point.y + 6]
          ],
          { layers: ['user_selection_vertex'] }
        )[0]
      : undefined
    if (handle) {
      e.preventDefault()
      this.map.dragPan.disable()
      this.dragging = {
        feature: structuredClone(feature),
        layerId: layer.id,
        index: Number(handle.properties.index)
      }
      return
    }
    const hit = this.hit(e.point)
    if (!hit || String(hit.properties.fid) !== this.selected || feature.geometry.type !== 'Point') return
    e.preventDefault()
    this.map.dragPan.disable()
    // Moved on a copy, saved as one change on mouseup.
    this.dragging = { feature: structuredClone(feature), layerId: layer.id }
  }

  /** A selection handle (resize or point) under the pointer, if any. */
  private handleAt(point: { x: number; y: number }, layer: string) {
    if (!this.map.getLayer(layer)) return undefined
    return this.map.queryRenderedFeatures(
      [
        [point.x - 7, point.y - 7],
        [point.x + 7, point.y + 7]
      ],
      { layers: [layer] }
    )[0]
  }

  private mousemove(e: MapMouseEvent) {
    if (this.tool.mode !== 'select') this.map.getCanvas().style.cursor = 'crosshair'
    else if (!this.dragging && this.selected)
      this.map.getCanvas().style.cursor = this.handleAt(e.point, 'user_selection_resize') ? 'nwse-resize' : ''
    if (!this.dragging) return
    const to: [number, number] = [e.lngLat.lng, e.lngLat.lat]
    const { feature, index, resize, layerId } = this.dragging
    if (resize) {
      const size = sizeFromDrag(
        Math.hypot(e.point.x - resize.x, e.point.y - resize.y),
        resize.distanceAtSize1
      )
      feature.properties = { ...feature.properties, size }
      this.renderer.preview(layerId, feature)
    } else if (index === undefined) {
      feature.geometry = { type: 'Point', coordinates: to }
    } else if (feature.properties.kind === 'graphic' && index === -1) {
      // An arrow's width handle.
      const width = axisWidthFrom(controlPoints(feature.geometry), to)
      feature.properties = { ...feature.properties, axisWidth: width }
      this.renderer.preview(layerId, feature)
    } else if (feature.properties.kind === 'graphic') {
      const points = controlPoints(feature.geometry).map((c, i) => (i === index ? to : c))
      feature.geometry = graphicGeometry(points)
      this.renderer.preview(layerId, feature)
    } else {
      feature.geometry = moveVertex(feature.geometry, index, to)
    }
    this.renderer.select(feature)
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
