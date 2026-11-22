// Fork: draws "My layers". Each layer is a GeoJSON source (user_<id>) with its own
// map layers (user_<id>_fill/_line/_symbol). Copies of map features are drawn by
// clones of upstream's layers for that data (user_<id>__power_line...), so a
// copied 225 kV line looks just like the original, at every zoom. Ids start with
// user_, which the layer switcher and the key never hide (fork/key).
// Tactical graphics (arrows, phase lines, areas...) are drawn by the C5ISR renderer
// (graphics.ts) into a second source per layer (user_<id>_g), redrawn when the
// zoom changes (arrow heads and teeth depend on the scale).
import { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'
import { LayerSpecificationWithZIndex } from '../../../../style/types.ts'
import { UserFeature, UserLayer } from '../model/model.ts'
import { getLabelLevel } from './symbols.ts'
import { ensureImage, iconName } from './icons.ts'
import { measurePrefs } from '../../../services/measure-prefs.ts'
import { MeasureDrawer, type MeasureView } from './render-measures.ts'
import { graphicFeatures, type GraphicsView } from './render-graphics.ts'
import { Drafts } from './drafts.ts'
import { overlayLayers } from './overlay-layers.ts'
import { graphicsLibrary, mapScale } from '../graphics/graphics.ts'
import { pointOf } from '../model/shapes.ts'
import { DRAFT, GHOST, OUTLINE_PAD_PX, SELECTION } from './render.constants.ts'
import { IconBox } from './render.types.ts'
import {
  glows,
  isGraphic,
  isMeasure,
  resizable,
  scaledBox,
  selectionFeatures,
  visibleBox,
  withoutHandles
} from './geometry.ts'
import {
  copyLayers,
  graphicLayers,
  graphicsSourceId,
  highlightFilter,
  measureLayers,
  measureSourceId,
  ownLayers,
  sourceId
} from './layers.ts'

/** A feature as drawn: its properties plus what the map layers need. */
function drawn(feature: UserFeature, conflict = false): GeoJSON.Feature {
  const p = feature.properties
  return {
    type: 'Feature',
    geometry: feature.geometry,
    properties: {
      ...p,
      copy: undefined,
      fid: feature.id,
      icon: iconName(p),
      copy_key: p.copy ? `${p.copy.source}/${p.copy.sourceLayer}` : null,
      // In conflict with someone else's change (ui/conflicts.ts): marked.
      ...(conflict ? { conflict: true } : {})
    }
  }
}

export class Renderer {
  private map: MapLibreMap
  private primaryLayers: () => LayerSpecificationWithZIndex[]
  private last: { layers: Map<string, UserLayer>; hidden: Set<string> } | null = null
  /** Items in conflict (store.conflicts), drawn with an orange dashed ring. */
  conflicted = new Set<string>()
  /** The measurements' features (lines of sight's answers kept there). */
  private measures = new MeasureDrawer(() => this.renderMeasures())
  /** What the tools draw before anything is put down. */
  readonly drafts: Drafts
  /** The layers' order, top first (the list's, ui/outliner.ts layerOrder): the top one
   * is drawn on top. */
  orderOf?: () => string[]
  /** Whether an item may be changed now (state/view.ts canEditItem, given by
   * index.ts): one that can't (locked, in a locked or view-only layer) gets no handles. */
  canEditItem?: (feature: UserFeature) => boolean
  private orderKey = ''

  private graphicsZoom = -1
  // The selected feature, to keep the resize handle at its corner when the map moves.
  private selected: UserFeature | null = null

  constructor(map: MapLibreMap, primaryLayers: () => LayerSpecificationWithZIndex[]) {
    this.map = map
    this.primaryLayers = primaryLayers
    this.drafts = new Drafts(map, () => this.ensureOverlays())
    // Arrow heads, teeth and labels are sized for a scale: redraw on zoom.
    map.on('zoomend', () => {
      if (this.last && Math.abs(map.getZoom() - this.graphicsZoom) >= 0.5) void this.renderGraphics()
    })
    map.on('move', () => {
      if (resizable(this.selected)) this.select(this.selected)
    })
    // Measurements' marks depend on the zoom and what's in view; their bearings on
    // the north chosen.
    map.on('moveend', () => this.renderMeasures())
    measurePrefs.onChange(() => this.renderMeasures())
    // A new style (e.g. another background map) drops everything added here.
    map.on('style.load', () => {
      if (this.last) void this.render(this.last.layers, this.last.hidden)
    })
  }

  /** Draw the graphics of the layers shown (after render(), and on zoom); `changed`
   * draws a feature being dragged as it is now. */
  private async renderGraphics(changed?: UserFeature) {
    if (!this.last) return
    const { layers } = this.last
    const map = this.map
    const hasGraphics = (l: UserLayer) => [...l.features.values()].some(isGraphic)
    // A layer whose last graphic was deleted: nothing left to draw.
    for (const layer of layers.values()) {
      if (!hasGraphics(layer))
        (map.getSource(graphicsSourceId(layer.id)) as GeoJSONSource | undefined)?.setData({
          type: 'FeatureCollection',
          features: []
        })
    }
    const withGraphics = [...layers.values()].filter(hasGraphics)
    if (!withGraphics.length) return
    const lib = await graphicsLibrary()
    if (!this.last || this.last.layers !== layers) return
    const zoom = map.getZoom()
    this.graphicsZoom = zoom
    const bounds = map.getBounds()
    const scale = mapScale(zoom, map.getCenter().lat)
    const view: GraphicsView = {
      scale,
      bbox: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()],
      level: getLabelLevel()
    }
    for (const layer of withGraphics) {
      const features = graphicFeatures(lib, layer, view, changed)
      const source = map.getSource(graphicsSourceId(layer.id)) as GeoJSONSource | undefined
      source?.setData({ type: 'FeatureCollection', features })
    }
  }

  /** Show these layers (and nothing else of My layers). */
  async render(layers: Map<string, UserLayer>, hidden: Set<string>) {
    this.last = { layers, hidden }
    const map = this.map
    if (!map.isStyleLoaded()) {
      map.once('idle', () => {
        if (this.last?.layers === layers) void this.render(layers, hidden)
      })
      return
    }
    // The images the features need, added before the features are drawn. The layers
    // can change while they load (several changes saved at once share the same
    // map of layers), so check again until nothing is missing.
    const missing = () => {
      const icons = new Set<string>()
      for (const layer of layers.values()) {
        for (const f of layer.features.values()) {
          const icon = iconName(f.properties)
          if (icon && !map.hasImage(icon)) icons.add(icon)
        }
      }
      return [...icons]
    }
    for (let round = 0, icons = missing(); icons.length && round < 5; round++, icons = missing()) {
      await Promise.all(icons.map((icon) => ensureImage(map, icon)))
      if (this.last?.layers !== layers) return // something newer is being drawn
    }
    if (this.last?.layers !== layers) return

    const wanted = new Set<string>()
    const specIds = new Map<string, string[]>()
    let added = false
    for (const layer of layers.values()) {
      const source = sourceId(layer.id)
      const data: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: [...layer.features.values()].map((f) => drawn(f, this.conflicted.has(f.id)))
      }
      const existing = map.getSource(source) as GeoJSONSource | undefined
      if (existing) existing.setData(data)
      else map.addSource(source, { type: 'geojson', data, promoteId: 'fid' })

      const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
      if (!map.getSource(graphicsSourceId(layer.id)))
        map.addSource(graphicsSourceId(layer.id), { type: 'geojson', data: empty })
      if (!map.getSource(measureSourceId(layer.id)))
        map.addSource(measureSourceId(layer.id), { type: 'geojson', data: empty })
      const ids: string[] = []
      for (const spec of [
        ...copyLayers(layer, this.primaryLayers),
        ...graphicLayers(layer, this.highlighted),
        ...measureLayers(layer, this.highlighted),
        ...ownLayers(layer)
      ]) {
        wanted.add(spec.id)
        ids.push(spec.id)
        if (!map.getLayer(spec.id)) {
          map.addLayer(spec, this.map.getLayer(`${SELECTION}_line`) ? `${SELECTION}_line` : undefined)
          added = true
        }
        map.setLayoutProperty(spec.id, 'visibility', hidden.has(layer.id) ? 'none' : 'visible')
      }
      specIds.set(layer.id, ids)
    }
    // Stacked in the list's order, its top layer on top (again only when it or the
    // map's layers changed): each moved, bottom first, just under the overlays.
    const order = this.orderOf?.() ?? []
    const key = order.join(',')
    if (order.length && (added || key !== this.orderKey)) {
      this.orderKey = key
      const under = map.getLayer(`${SELECTION}_line`) ? `${SELECTION}_line` : undefined
      for (const id of [...order].reverse()) {
        for (const spec of specIds.get(id) ?? []) map.moveLayer(spec, under)
      }
    }
    // Remove what's no longer there (deleted layers, copies of a kind no longer in a layer).
    for (const layer of map.getStyle().layers ?? []) {
      if (
        layer.id.startsWith('user_') &&
        !layer.id.startsWith(SELECTION) &&
        !layer.id.startsWith(DRAFT) &&
        !wanted.has(layer.id)
      ) {
        map.removeLayer(layer.id)
      }
    }
    for (const id of Object.keys(map.getStyle().sources ?? {})) {
      if (
        id.startsWith('user_') &&
        id !== SELECTION &&
        !id.startsWith(DRAFT) &&
        ![...layers.keys()].some(
          (l) => sourceId(l) === id || graphicsSourceId(l) === id || measureSourceId(l) === id
        )
      ) {
        map.removeSource(id)
      }
    }
    this.ensureOverlays()
    // The selection drawn again as its item is now: its layer may have been hidden or
    // shown, and a resize handle needs the image, which may only be loaded now.
    if (this.selected) this.select(this.storedVersion(this.selected))
    this.renderMeasures()
    await this.renderGraphics()
  }

  /** The measurements (measure/features.ts): labels, and marks for what's in view.
   * `changed`: one being dragged, drawn as it is now. */
  renderMeasures(changed?: UserFeature) {
    if (!this.last) return
    const map = this.map
    const b = map.getBounds()
    const ticks = {
      zoom: map.getZoom(),
      bounds: { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() }
    }
    const view: MeasureView = { ticks, north: measurePrefs.north }
    for (const layer of this.last.layers.values()) {
      const source = map.getSource(measureSourceId(layer.id)) as GeoJSONSource | undefined
      source?.setData({
        type: 'FeatureCollection',
        features: this.measures.layerFeatures(layer, view, this.conflicted, changed)
      })
    }
  }

  /** Map layer ids of My layers' features (for clicks). */
  featureLayerIds(): string[] {
    // No style yet while the page loads (the mouse may already move over the map): none.
    return (this.map.getStyle()?.layers ?? [])
      .map((l) => l.id)
      .filter((id) => id.startsWith('user_') && !id.startsWith(SELECTION) && !id.startsWith(DRAFT))
  }

  private ensureOverlays() {
    const map = this.map
    const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
    for (const id of [SELECTION, DRAFT, GHOST]) {
      if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: empty })
    }
    for (const spec of overlayLayers()) if (!map.getLayer(spec.id)) map.addLayer(spec)
  }

  // The graphics and measurements highlighted: they glow under their own lines
  // (renderGraphics, renderMeasures), not a shape drawn over them.
  private highlighted: string[] = []

  private highlightItems(features: UserFeature[]) {
    const ids = features.filter((f) => isGraphic(f) || isMeasure(f)).map((f) => f.id)
    if (ids.join() === this.highlighted.join()) return
    this.highlighted = ids
    for (const layer of this.map.getStyle().layers) {
      if (!layer.id.startsWith('user_')) continue
      if (layer.id.endsWith('_g_highlight'))
        this.map.setFilter(layer.id, highlightFilter('graphic', this.highlighted))
      if (layer.id.endsWith('_m_highlight'))
        this.map.setFilter(layer.id, highlightFilter('measure', this.highlighted))
    }
  }

  /** Highlight several features (no handles: they're for one item at a time); none
   * in a hidden layer. */
  selectAll(features: UserFeature[]) {
    if (features.length <= 1) {
      this.select(features[0] ?? null)
      return
    }
    this.selected = null
    this.ensureOverlays()
    const shown = features.filter((f) => !this.inHiddenLayer(f))
    this.highlightItems(shown)
    ;(this.map.getSource(SELECTION) as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: shown.flatMap((f) => this.outline(f) ?? selectionFeatures(f).slice(0, glows(f) ? 0 : 1))
    })
  }

  /** An item as the layers last drawn hold it (itself if they don't). */
  private storedVersion(feature: UserFeature): UserFeature {
    for (const layer of this.last?.layers.values() ?? []) {
      const stored = layer.features.get(feature.id)
      if (stored) return stored
    }
    return feature
  }

  /** Whether an item's layer is hidden from the map (as the layers were last drawn). */
  private inHiddenLayer(feature: UserFeature): boolean {
    if (!this.last) return false
    for (const layer of this.last.layers.values())
      if (layer.features.has(feature.id)) return this.last.hidden.has(layer.id)
    return false
  }

  /** A picture, symbol or marker's outline: the box around its image, on screen. */
  private outline(feature: UserFeature): GeoJSON.Feature[] | null {
    if (!resizable(feature)) return null
    const box = this.iconBox(feature)
    if (!box) return null
    const { left, top, right, bottom } = scaledBox(box, feature.properties.size ?? 1, OUTLINE_PAD_PX)
    const at = pointOf(feature)
    const ring = [
      [left, top],
      [right, top],
      [right, bottom],
      [left, bottom],
      [left, top]
    ].map(([x, y]) => this.offsetOnScreen(at, x, y))
    return [
      { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: { outline: true } }
    ]
  }

  /** Highlight a feature (null: none); pictures, symbols and markers get a resize handle.
   * Nothing is drawn for an item in a hidden layer, its handles neither (it stays
   * selected: they come back when the layer is shown); one that can't be changed
   * (locked) is highlighted without its handles. */
  select(feature: UserFeature | null) {
    this.selected = feature
    this.ensureOverlays()
    const shown = feature && !this.inHiddenLayer(feature) ? feature : null
    this.highlightItems(shown ? [shown] : [])
    const editable = shown !== null && (this.canEditItem?.(shown) ?? true)
    const shapes = shown ? (this.outline(shown) ?? selectionFeatures(shown)) : []
    const features = editable ? shapes : withoutHandles(shapes)
    const handle = shown && editable ? this.resizeHandle(shown) : null
    if (handle) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: handle },
        properties: { resize: true }
      })
    }
    ;(this.map.getSource(SELECTION) as GeoJSONSource).setData({ type: 'FeatureCollection', features })
  }

  // The visible part of each image (by name): see visibleBox.
  private boxes = new Map<string, IconBox>()

  /** Where a point feature's image is drawn, its empty margins left out: px from
   * its centre at size 1. */
  iconBox(feature: UserFeature): IconBox | null {
    const name = iconName(feature.properties)
    const image = name ? this.map.getImage(name) : null
    if (!name || !image) return null
    const key = `${name}@${image.data.width}x${image.data.height}`
    let box = this.boxes.get(key)
    if (!box) {
      box = visibleBox(image.data.data, image.data.width, image.data.height, image.pixelRatio || 1)
      this.boxes.set(key, box)
    }
    return box
  }

  /** Where the resize handle goes: the bottom-right corner of the image. */
  private resizeHandle(feature: UserFeature): [number, number] | null {
    if (!resizable(feature)) return null
    const box = this.iconBox(feature)
    if (!box) return null
    const { right, bottom } = scaledBox(box, feature.properties.size ?? 1)
    return this.offsetOnScreen(pointOf(feature), right, bottom)
  }

  /** A point `dx`, `dy` screen pixels from another, on the map. */
  private offsetOnScreen(at: [number, number], dx: number, dy: number): [number, number] {
    const p = this.map.project(at)
    const moved = this.map.unproject([p.x + dx, p.y + dy])
    return [moved.lng, moved.lat]
  }

  /** Draw a feature as it's being changed (e.g. resized), before it's saved. */
  preview(layerId: string, feature: UserFeature) {
    const layer = this.last?.layers.get(layerId)
    const source = this.map.getSource(sourceId(layerId)) as GeoJSONSource | undefined
    if (!layer || !source) return
    if (isGraphic(feature)) {
      void this.renderGraphics(feature)
      return
    }
    if (isMeasure(feature)) {
      this.renderMeasures(feature)
      return
    }
    source.setData({
      type: 'FeatureCollection',
      features: [...layer.features.values()].map((f) => drawn(f.id === feature.id ? feature : f))
    })
  }
}
