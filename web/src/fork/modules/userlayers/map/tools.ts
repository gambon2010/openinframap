// Fork: what clicking the map does in "My layers": select (and drag a symbol, or
// the points of a line, area or graphic, to move them), place a symbol / picture /
// marker, draw a line, an area or a tactical graphic (by its control points), or
// copy a map feature into the active layer (with its full geometry from the backend).
import { t } from '../../../core/i18n.ts'
import { Map, MapGeoJSONFeature, MapMouseEvent, PointLike } from 'maplibre-gl'
import { LayerSpecificationWithZIndex } from '../../../../style/types.ts'
import { Store } from '../state/store.ts'
import { MAX_SIZE, MIN_SIZE, Renderer, controlPoints, moveVertex, sizeFromDrag } from './render.ts'
import { axisWidth, axisWidthFrom } from './graphics.ts'
import { DEFAULT_COLOR, FeatureProps, UserFeature } from '../model/model.ts'
import { sourceGeometry } from '../../../core/map-data.ts'
import { mapMode } from '../../../ui/map-mode.ts'
import { kindOf } from '../kinds/index.ts'
import { iconName } from './icons.ts'
import { areaCrossesItself, areaPoints, pathCrossesItself } from '../model/shapes.ts'

export type Tool =
  | { mode: 'select' }
  | { mode: 'place'; properties: FeatureProps }
  | {
      mode: 'line' | 'area'
      points: [number, number][]
      /** What it makes (none: a drawing): a measurement, for the measuring tools. */
      properties?: FeatureProps
    }
  | { mode: 'copy' }
  | {
      mode: 'graphic'
      properties: FeatureProps
      points: [number, number][]
      min: number
      max: number
      /** An arrow: drawn as a path from tail to tip (its width follows). */
      axis?: boolean
      /** An arrow: its width against the automatic one (a fifth of its length):
       * Shift + scroll while drawing. */
      widthFactor?: number
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

// Its name while a drawing or placing tool has the map (ui/map-mode.ts).
const MODE = 'userlayers-draw'

// How near (pixels) a click must be to an area's first point to close it there.
const CLOSE_PX = 10
// A new point of an area: at least this far (pixels) from the others; closer than
// REPEAT_PX it's the second click of a double-click.
const MIN_SEPARATION_PX = 12
const REPEAT_PX = 4

// Scrolled this far (pixels) makes one 10 % step of size (a mouse wheel's notch is
// about 100; a touchpad sends many small steps).
const WHEEL_NOTCH = 100

const clampSize = (size: number) => Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(size * 100) / 100))

const CROSSING = () => t('userlayers.area-crossing', "Not there: the area's outline would cross itself.")

export class Tools {
  tool: Tool = { mode: 'select' }
  selected: string | null = null
  /** Off while a past version is shown (a situation, the history), or while another
   * tool has the map (measuring: ui/map-mode.ts). */
  get enabled(): boolean {
    return this.store.view.live && (!mapMode.current || mapMode.current === MODE)
  }
  message = ''
  // The tool's own hint (message shows a warning instead for a moment).
  private hint = ''
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
    // Shift + scroll while placing or drawing an arrow: its size, not the zoom (before
    // the map's own wheel handling, which it then doesn't reach).
    map.getContainer().addEventListener('wheel', (e) => this.wheel(e), { capture: true, passive: false })
    // Off the map: no preview, no line to the cursor.
    map.on('mouseout', () => {
      this.drawGhost(null)
      this.drawDraft()
    })
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
    this.keepResize()
    this.tool = tool
    this.message = message
    this.hint = message
    this.renderer.draft([], false)
    this.renderer.graphicDraft(null)
    this.drawGhost(null)
    // A tool other than select has the map (another one, like measuring, stops);
    // when it's taken back (Esc, measuring started), select again.
    if (tool.mode === 'select') mapMode.leave(MODE)
    else
      mapMode.enter({
        name: MODE,
        cursor: 'crosshair',
        doubleClickZoom: !drawing(tool),
        // Its own keys (keydown below) stop the tool on Escape.
        keydown: (e) => e.key === 'Escape',
        contextmenu: () => this.cancelDrawing(),
        exit: () => {
          if (this.tool.mode !== 'select') this.setTool({ mode: 'select' })
        }
      })
    this.notify()
  }

  /** Items selected along with `selected` (Shift-click): changed together. */
  others: string[] = []

  select(featureId: string | null) {
    this.keepResize()
    this.selected = featureId
    this.others = []
    this.drawSelection()
    this.notify()
  }

  /** Add an item to the selection, or take it out (Shift-click). */
  toggle(featureId: string) {
    const all = this.selection()
    const next = all.includes(featureId) ? all.filter((id) => id !== featureId) : [...all, featureId]
    this.selected = next[0] ?? null
    this.others = next.slice(1)
    this.drawSelection()
    this.notify()
  }

  /** After a change: drop what no longer exists, draw the rest again. */
  refreshSelection() {
    const ids = this.selection().filter((id) => this.store.layerOf(id))
    if (!ids.length && !this.selected) return
    this.selected = ids[0] ?? null
    this.others = ids.slice(1)
    this.drawSelection()
    this.notify()
  }

  /** Everything selected, the main one first. */
  selection(): string[] {
    return this.selected ? [this.selected, ...this.others.filter((id) => id !== this.selected)] : []
  }

  private drawSelection() {
    const features = this.selection()
      .map((id) => this.store.layerOf(id)?.features.get(id))
      .filter((f): f is UserFeature => Boolean(f))
    this.renderer.selectAll(features)
  }

  /** The active layer, made if there's none yet. */
  private activeLayer(): string {
    const active = this.store.activeLayer ? this.store.layers.get(this.store.activeLayer) : undefined
    if (active && this.store.view.canEdit(active)) return active.id
    // A locked layer takes nothing new: draw into another one, or a new one.
    const open = [...this.store.layers.values()].find((l) => this.store.view.canEdit(l))
    if (open) {
      this.store.setActive(open.id)
      return open.id
    }
    return this.store.createLayer(t('userlayers.default-name', 'My layer'))
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
        // A click on an area's first point closes it.
        if (this.tool.mode === 'area' && this.tool.points.length >= 3 && this.nearFirst(lngLat)) {
          this.finishDrawing()
          break
        }
        // Not on top of another of an area's points: the second click of a
        // double-click is let go quietly, one a little further off refused.
        if (this.tool.mode === 'area' && this.tool.points.length) {
          const near = this.nearestPx(lngLat)
          if (near <= REPEAT_PX) break
          if (near < MIN_SEPARATION_PX) {
            this.message = t('userlayers.area-too-close', 'Too close to another point of the area.')
            this.notify()
            break
          }
        }
        // An area's outline mustn't cross itself (model/shapes.ts).
        if (this.tool.mode === 'area' && pathCrossesItself([...this.tool.points, lngLat])) {
          this.message = CROSSING()
          this.notify()
          break
        }
        this.tool.points.push(lngLat)
        this.drawDraft()
        if (this.message !== this.hint) {
          this.message = this.hint
          this.notify()
        }
        break
      case 'graphic':
        this.tool.points.push(lngLat)
        this.drawDraft(lngLat)
        // Graphics with a fixed number of points (block, breach...) finish by themselves.
        if (this.tool.points.length >= this.tool.max) this.finishDrawing()
        else this.notify()
        break
      case 'copy':
        await this.copyAt(e)
        break
      case 'select': {
        const hit = this.hit(e.point)
        // Shift-click adds to (or takes out of) the selection.
        if (hit && e.originalEvent.shiftKey) this.toggle(String(hit.properties.fid))
        else this.select(hit ? String(hit.properties.fid) : null)
        break
      }
    }
  }

  /** How far (pixels) a point is from the nearest point drawn so far. */
  private nearestPx(lngLat: [number, number]): number {
    if (!drawing(this.tool)) return Infinity
    const b = this.map.project(lngLat)
    return Math.min(
      ...this.tool.points.map((p) => {
        const a = this.map.project(p)
        return Math.hypot(a.x - b.x, a.y - b.y)
      })
    )
  }

  /** Whether a point is on the first point of the area being drawn (a few pixels). */
  private nearFirst(lngLat: [number, number]): boolean {
    if (!drawing(this.tool) || !this.tool.points.length) return false
    const a = this.map.project(this.tool.points[0])
    const b = this.map.project(lngLat)
    return Math.hypot(a.x - b.x, a.y - b.y) <= CLOSE_PX
  }

  finishDrawing() {
    if (!drawing(this.tool)) return
    // A double-click adds the same point twice.
    let points = dropRepeats(this.tool.points)
    // An area finished on its first point: that's where it closes anyway.
    if (this.tool.mode === 'area' && points.length > 3 && this.nearFirst(points[points.length - 1])) {
      points = points.slice(0, -1)
    }
    if (this.tool.mode === 'graphic') {
      if (points.length < this.tool.min) {
        this.message = t('userlayers.graphic-more', 'This graphic needs at least {{n}} points.', {
          n: this.tool.min
        })
        this.notify()
        return
      }
      const properties = this.tool.axis
        ? {
            ...this.tool.properties,
            axis: true,
            axisWidth: Math.max(10, Math.round(axisWidth(points) * (this.tool.widthFactor ?? 1)))
          }
        : this.tool.properties
      const id = this.store.addFeature(this.activeLayer(), graphicGeometry(points), properties)
      this.setTool({ mode: 'select' })
      this.select(id)
      return
    }
    const area = this.tool.mode === 'area'
    if (area && areaCrossesItself(points)) {
      // Closing it would cross: a point more (or one taken back) first.
      this.message = t(
        'userlayers.area-crossing-close',
        'Closing the area here would make it cross itself: add a point elsewhere, or take one back (Backspace).'
      )
      this.notify()
      return
    }
    if (points.length >= (area ? 3 : 2)) {
      const geometry: GeoJSON.Geometry = area
        ? { type: 'Polygon', coordinates: [[...points, points[0]]] }
        : { type: 'LineString', coordinates: points }
      const id = this.store.addFeature(
        this.activeLayer(),
        geometry,
        this.tool.properties ?? { kind: 'drawing' }
      )
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
      this.message = t(
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
        this.message = t('userlayers.copy.already', 'Already in this layer.')
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
    this.message = t('userlayers.copy.done', 'Copied. Click more features to copy them, or Esc to stop.')
    this.select(featureId)
  }

  private mousedown(e: MapMouseEvent) {
    this.keepResize()
    if (!this.enabled || this.tool.mode !== 'select' || !this.selected) return
    const layer = this.store.layerOf(this.selected)
    const feature = layer?.features.get(this.selected)
    if (
      !layer ||
      !feature ||
      kindOf(feature.properties).movable === false ||
      !this.store.view.canEditItem(layer, feature)
    )
      return
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

  /** The line or area being drawn; a measurement: with its lengths so far, to the cursor. */
  private drawDraft(cursor?: [number, number]) {
    if (!drawing(this.tool)) return
    if (this.tool.mode === 'graphic') {
      // As it will look once done, faint, once it has enough points for a shape
      // (an arrow: two); until then the points and a line to the cursor.
      const points = cursor ? [...this.tool.points, cursor] : this.tool.points
      const needed = this.tool.axis ? 2 : Math.max(2, this.tool.min)
      if (points.length >= needed && this.tool.properties.sidc) {
        const active = this.store.activeLayer ? this.store.layers.get(this.store.activeLayer) : undefined
        this.renderer.draft(this.tool.points, false, undefined, false)
        this.renderer.graphicDraft({
          sidc: this.tool.properties.sidc,
          points,
          axis: this.tool.axis,
          widthFactor: this.tool.widthFactor,
          colour: this.tool.properties.color ?? active?.style.color ?? DEFAULT_COLOR
        })
      } else {
        this.renderer.graphicDraft(null)
        this.renderer.draft(this.tool.points, false, cursor)
      }
      return
    }
    // On to where the next point would go (an area: and back to its start).
    const area = this.tool.mode === 'area'
    if (this.tool.properties?.kind === 'measure') {
      const points = cursor && this.tool.points.length ? [...this.tool.points, cursor] : this.tool.points
      this.renderer.measureDraft({ type: area ? 'area' : 'distance', points })
      return
    }
    this.renderer.draft(this.tool.points, area, cursor)
  }

  /** A placing tool: what it would put down, faint under the cursor (null: none). */
  private drawGhost(cursor: [number, number] | null) {
    if (this.tool.mode !== 'place' || !cursor) {
      void this.renderer.ghost(null, null)
      // Range rings are previewed as a draft.
      if (this.tool.mode === 'place') this.renderer.draft([], false)
      return
    }
    const p = this.tool.properties
    if (p.kind === 'measure') {
      this.renderer.measureDraft({ type: 'rings', points: [cursor], radii: p.radii as number[] })
      return
    }
    const active = this.store.activeLayer ? this.store.layers.get(this.store.activeLayer) : undefined
    void this.renderer.ghost(iconName(p, active?.style.color ?? DEFAULT_COLOR), cursor, p.size ?? 1)
  }

  /** Right-click while drawing: what's drawn so far is dropped; again: the tool stops. */
  private cancelDrawing() {
    if (drawing(this.tool) && this.tool.points.length) {
      this.tool.points = []
      this.renderer.draft([], false)
      this.renderer.graphicDraft(null)
      this.notify()
    } else this.setTool({ mode: 'select' })
  }

  // Where the pointer was last on the map (to draw previews again after a scroll).
  private cursor: [number, number] | null = null
  private wheelTotal = 0

  /** Shift + scroll: the item being placed bigger or smaller, the arrow being drawn
   * wider or narrower (a notch: 10 %). */
  private wheel(e: WheelEvent) {
    if (!e.shiftKey || !this.enabled) return
    const placing = this.tool.mode === 'place' && kindOf(this.tool.properties).sized
    const arrow = this.tool.mode === 'graphic' && this.tool.axis
    const editing = this.tool.mode === 'select' && this.resizable() !== null
    if (!placing && !arrow && !editing) return
    e.preventDefault()
    e.stopPropagation()
    // Shift turns the wheel sideways in most browsers; lines and pages into pixels.
    const raw = e.deltaY || e.deltaX
    this.wheelTotal += raw * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 400 : 1)
    const steps = Math.trunc(this.wheelTotal / WHEEL_NOTCH)
    if (!steps) return
    this.wheelTotal -= steps * WHEEL_NOTCH
    const factor = 1.1 ** -steps // wheel up (negative): bigger
    if (editing) this.resizeSelected(factor)
    else if (this.tool.mode === 'place') {
      const size = clampSize((this.tool.properties.size ?? 1) * factor)
      this.tool.properties = { ...this.tool.properties, size }
      this.message = `${this.hint} ${t('userlayers.size-now', 'Size: {{n}} %', { n: Math.round(size * 100) })}`
      this.drawGhost(this.cursor)
    } else if (this.tool.mode === 'graphic') {
      const widthFactor = Math.min(5, Math.max(0.2, (this.tool.widthFactor ?? 1) * factor))
      this.tool.widthFactor = widthFactor
      this.message = `${this.hint} ${t('userlayers.width-now', 'Width: {{n}} %', { n: Math.round(widthFactor * 100) })}`
      this.drawDraft(this.cursor ?? undefined)
    }
    this.notify()
  }

  /** The selected item, if Shift + scroll can resize it: one item, that may be
   * changed, with a size (a marker, a symbol, a picture) or an arrow's width. */
  private resizable(): { layerId: string; feature: UserFeature } | null {
    if (!this.selected || this.others.length) return null
    const layer = this.store.layerOf(this.selected)
    const feature = layer?.features.get(this.selected)
    if (!layer || !feature || !this.store.view.canEditItem(layer, feature)) return null
    const p = feature.properties
    const sized = kindOf(p).sized && feature.geometry.type === 'Point'
    if (!sized && !(p.axis || p.axisWidth !== undefined)) return null
    return { layerId: layer.id, feature }
  }

  // An item being resized with Shift + scroll: shown as it changes, kept as one
  // change once the scrolling stops.
  private resizing: { layerId: string; feature: UserFeature; timer: ReturnType<typeof setTimeout> } | null =
    null

  private resizeSelected(factor: number) {
    const target = this.resizable()
    if (!target) return
    const feature = structuredClone(
      this.resizing?.feature.id === target.feature.id ? this.resizing.feature : target.feature
    )
    const p = feature.properties
    if (kindOf(p).sized && feature.geometry.type === 'Point') {
      const size = clampSize((p.size ?? 1) * factor)
      feature.properties = { ...p, size }
      this.message = t('userlayers.size-now', 'Size: {{n}} %', { n: Math.round(size * 100) })
    } else {
      const width = Math.max(
        10,
        Math.round((p.axisWidth ?? axisWidth(controlPoints(feature.geometry))) * factor)
      )
      feature.properties = { ...p, axisWidth: width }
      this.message = t('userlayers.width-metres', 'Width: {{n}} m', { n: width })
    }
    this.notify()
    this.renderer.preview(target.layerId, feature)
    this.renderer.select(feature)
    if (this.resizing) clearTimeout(this.resizing.timer)
    this.resizing = { layerId: target.layerId, feature, timer: setTimeout(() => this.keepResize(), 500) }
  }

  /** The resize so far, kept (one change). */
  private keepResize() {
    const resizing = this.resizing
    if (!resizing) return
    clearTimeout(resizing.timer)
    this.resizing = null
    this.message = this.hint
    this.store.updateFeature(resizing.layerId, resizing.feature)
    this.notify()
  }

  private mousemove(e: MapMouseEvent) {
    this.cursor = [e.lngLat.lng, e.lngLat.lat]
    if (this.tool.mode !== 'select') this.map.getCanvas().style.cursor = 'crosshair'
    if (drawing(this.tool)) this.drawDraft([e.lngLat.lng, e.lngLat.lat])
    else if (this.tool.mode === 'place') this.drawGhost([e.lngLat.lng, e.lngLat.lat])
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
    } else if (index === undefined) {
      feature.geometry = { type: 'Point', coordinates: to }
    } else if (kindOf(feature.properties).drawn === 'graphic' && index === -1) {
      // An arrow's size handle: only the width changes.
      const width = axisWidthFrom(controlPoints(feature.geometry), to)
      feature.properties = { ...feature.properties, axisWidth: width }
    } else if (kindOf(feature.properties).drawn === 'graphic') {
      const points = controlPoints(feature.geometry).map((c, i) => (i === index ? to : c))
      feature.geometry = graphicGeometry(points)
    } else {
      const moved = moveVertex(feature.geometry, index, to)
      // An area's point can't go where the outline would cross itself: it stops.
      const ring = areaPoints(moved)
      if (ring && areaCrossesItself(ring)) return
      feature.geometry = moved
    }
    // The item itself follows as it's dragged (saved on mouseup).
    this.renderer.preview(layerId, feature)
    this.renderer.select(feature)
  }

  private mouseup() {
    if (!this.dragging) return
    const { feature, layerId } = this.dragging
    this.dragging = null
    this.map.dragPan.enable()
    // A click without a move isn't a change.
    const stored = this.store.layers.get(layerId)?.features.get(feature.id)
    const same =
      stored &&
      JSON.stringify(stored.geometry) === JSON.stringify(feature.geometry) &&
      JSON.stringify(stored.properties) === JSON.stringify(feature.properties)
    if (!same) this.store.updateFeature(layerId, feature)
    else this.renderer.preview(layerId, stored)
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
    } else if (e.key === 'Backspace' && drawing(this.tool) && this.tool.points.length) {
      // Take back the last point.
      this.tool.points.pop()
      this.drawDraft()
      this.notify()
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected) {
      this.deleteSelected()
    }
  }

  /** Delete everything selected (not what's in a locked layer), as one undo step. */
  deleteSelected() {
    const ids = this.selection().filter((id) => {
      const layer = this.store.layerOf(id)
      return this.store.view.canEditItem(layer, layer?.features.get(id))
    })
    if (ids.length) this.store.deleteFeatures(ids)
    this.select(null)
  }
}
