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
import { DEFAULT_COLOR, UserFeature, UserLayer } from '../model/model.ts'
import { getLabelLevel } from './symbols.ts'
import { isDirection } from '../graphics/variants.ts'
import { ensureImage, iconName } from './icons.ts'
import { Measurement, measurementFeatures, measurementOf } from '../measure/features.ts'
import { measurePrefs } from '../measure/prefs.ts'
import {
  axisControlPoints,
  axisWidth,
  axisWidthFrom,
  graphicsLibrary,
  isAxis,
  mapScale,
  pathFromAxisPoints,
  renderGraphic,
  squareUp
} from '../graphics/graphics.ts'
import { modifiersToDraw } from '../model/fields.ts'
import { supplyColours } from '../../../services/supply.ts'
import { pointOf } from '../model/shapes.ts'
import { DRAFT, GHOST, GRAPHIC_DRAFT, OUTLINE_PAD_PX, SELECTION } from './render.constants.ts'
import { GraphicDraft, IconBox } from './render.types.ts'
import {
  controlPoints,
  glows,
  isGraphic,
  isMeasure,
  resizable,
  scaledBox,
  selectionFeatures,
  visibleBox
} from './geometry.ts'
import {
  copyLayers,
  graphicLayers,
  graphicSpecs,
  graphicsSourceId,
  highlightFilter,
  measureLayers,
  measureSourceId,
  overlayLayers,
  ownLayers,
  sourceId,
  supplyLayers
} from './layers.ts'

/** A feature as drawn: its properties plus what the map layers need. */
function drawn(feature: UserFeature, layerColor: string, conflict = false): GeoJSON.Feature {
  const p = feature.properties
  const supply = p.copy ? supplyColours.of(p.copy.sourceLayer, p.osm_id) : null
  return {
    type: 'Feature',
    geometry: feature.geometry,
    properties: {
      ...p,
      copy: undefined,
      fid: feature.id,
      icon: iconName(p, layerColor),
      copy_key: p.copy ? `${p.copy.source}/${p.copy.sourceLayer}` : null,
      // Power supply mode on: a copied line, substation or plant's original's colour
      // (left out otherwise: the supply layers draw what has one).
      ...(supply ? { supply } : {}),
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
  /** The layers' order, top first (the list's, ui/outliner.ts layerOrder): the top one
   * is drawn on top. */
  orderOf?: () => string[]
  private orderKey = ''

  private graphicsZoom = -1
  /** Called with arrows drawn the old way (four free points), to turn them into paths. */
  onOldArrow?: (layerId: string, feature: UserFeature) => void
  private oldArrowsReported = new Set<string>()
  // The selected feature, to keep the resize handle at its corner when the map moves.
  private selected: UserFeature | null = null

  constructor(map: MapLibreMap, primaryLayers: () => LayerSpecificationWithZIndex[]) {
    this.map = map
    this.primaryLayers = primaryLayers
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
    // Power supply mode turned on or off, or its colours changed.
    supplyColours.onChange(() => {
      if (this.last) void this.render(this.last.layers, this.last.hidden)
    })
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
    const level = getLabelLevel()
    for (const layer of withGraphics) {
      const features: GeoJSON.Feature[] = []
      for (const stored of layer.features.values()) {
        let f = changed && stored.id === changed.id ? changed : stored
        if (!isGraphic(f) || !f.properties.sidc) continue
        const p = f.properties
        if (
          !p.axis &&
          p.axisWidth === undefined &&
          controlPoints(f.geometry).length >= 3 &&
          isAxis(lib, p.sidc!)
        ) {
          // An old arrow: draw it as a path, and have it saved that way.
          const old = controlPoints(f.geometry)
          const path = pathFromAxisPoints(old)
          f = {
            ...f,
            geometry: { type: 'LineString', coordinates: path },
            properties: { ...p, axis: true, axisWidth: axisWidthFrom(path, old[old.length - 1]) }
          }
          if (!this.oldArrowsReported.has(f.id)) {
            this.oldArrowsReported.add(f.id)
            this.onOldArrow?.(layer.id, f)
          }
        }
        try {
          const pieces = renderGraphic(lib, {
            sidc: f.properties.sidc!,
            points:
              f.properties.axis || f.properties.axisWidth !== undefined
                ? axisControlPoints(controlPoints(f.geometry), f.properties.axisWidth)
                : isDirection(f.properties.sidc)
                  ? [...controlPoints(f.geometry)].reverse()
                  : squareUp(f.properties.sidc, controlPoints(f.geometry)),
            modifiers: modifiersToDraw(f.properties.modifiers, level),
            color: f.properties.color,
            scale,
            bbox: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()]
          })
          for (const piece of pieces) piece.properties = { ...piece.properties, fid: f.id }
          features.push(...pieces)
        } catch (e) {
          console.warn('My layers: could not draw graphic', f.properties.sidc, e)
        }
      }
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
          const icon = iconName(f.properties, layer.style.color ?? DEFAULT_COLOR)
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
        features: [...layer.features.values()].map((f) =>
          drawn(f, layer.style.color ?? DEFAULT_COLOR, this.conflicted.has(f.id))
        )
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
        ...supplyLayers(layer),
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
    // The selection's resize handle needs the image, which may only be loaded now.
    if (resizable(this.selected)) this.select(this.selected)
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
    for (const layer of this.last.layers.values()) {
      const source = map.getSource(measureSourceId(layer.id)) as GeoJSONSource | undefined
      if (!source) continue
      const features: GeoJSON.Feature[] = []
      for (const stored of layer.features.values()) {
        const f = changed?.id === stored.id ? changed : stored
        if (!isMeasure(f)) continue
        const m = measurementOf(f)
        if (!m) continue
        features.push(
          ...measurementFeatures(m, {
            north: measurePrefs.north,
            ticks,
            properties: {
              fid: f.id,
              color: f.properties.color ?? layer.style.color ?? DEFAULT_COLOR,
              ...(this.conflicted.has(f.id) ? { conflict: true } : {})
            }
          })
        )
      }
      source.setData({ type: 'FeatureCollection', features })
    }
  }

  /** Map layer ids of My layers' features (for clicks). */
  featureLayerIds(): string[] {
    return (this.map.getStyle().layers ?? [])
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

  /** Highlight several features (no handles: they're for one item at a time). */
  selectAll(features: UserFeature[]) {
    if (features.length <= 1) {
      this.select(features[0] ?? null)
      return
    }
    this.selected = null
    this.ensureOverlays()
    this.highlightItems(features)
    ;(this.map.getSource(SELECTION) as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: features.flatMap((f) => this.outline(f) ?? selectionFeatures(f).slice(0, glows(f) ? 0 : 1))
    })
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

  /** Highlight a feature (null: none); pictures, symbols and markers get a resize handle. */
  select(feature: UserFeature | null) {
    this.selected = feature
    this.ensureOverlays()
    this.highlightItems(feature ? [feature] : [])
    const features = feature ? (this.outline(feature) ?? selectionFeatures(feature)) : []
    const handle = feature ? this.resizeHandle(feature) : null
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
    const layer = [...(this.last?.layers.values() ?? [])].find((l) => l.features.has(feature.id))
    const name = iconName(feature.properties, layer?.style.color ?? DEFAULT_COLOR)
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
    const color = layer.style.color ?? DEFAULT_COLOR
    source.setData({
      type: 'FeatureCollection',
      features: [...layer.features.values()].map((f) => drawn(f.id === feature.id ? feature : f, color))
    })
  }

  /** What a placing tool would put down (an icon: map/icons.ts), faint at a point;
   * null: nothing. */
  async ghost(icon: string | null, at: [number, number] | null, size = 1) {
    this.ensureOverlays()
    if (icon) await ensureImage(this.map, icon)
    const features: GeoJSON.Feature[] =
      icon && at
        ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: at }, properties: { icon, size } }]
        : []
    ;(this.map.getSource(GHOST) as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features
    })
  }

  /** A measurement being drawn (to the cursor), with its labels and marks. */
  measureDraft(m: Measurement) {
    this.ensureOverlays()
    // Its marks come once it's done.
    const features = measurementFeatures(m, {
      draft: true,
      north: measurePrefs.north,
      zoom: this.map.getZoom()
    })
    ;(this.map.getSource(DRAFT) as GeoJSONSource).setData({ type: 'FeatureCollection', features })
  }

  /** A graphic being drawn (an arrow, a boundary...), as it will look once done,
   * faint: its points so far and the cursor. Drawn once per frame at most (the
   * graphic is computed again as the mouse moves); null: none. */
  graphicDraft(draft: GraphicDraft | null) {
    this.pendingGraphic = draft
    if (this.graphicFrame) return
    this.graphicFrame = requestAnimationFrame(() => {
      this.graphicFrame = 0
      void this.drawGraphicDraft()
    })
  }

  private pendingGraphic: GraphicDraft | null = null
  private graphicFrame = 0

  private async drawGraphicDraft() {
    const draft = this.pendingGraphic
    const map = this.map
    this.ensureOverlays()
    if (!map.getSource(GRAPHIC_DRAFT)) {
      map.addSource(GRAPHIC_DRAFT, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      for (const spec of graphicSpecs(GRAPHIC_DRAFT, DEFAULT_COLOR, 0.6)) map.addLayer(spec)
    }
    const source = map.getSource(GRAPHIC_DRAFT) as GeoJSONSource
    if (!draft) {
      source.setData({ type: 'FeatureCollection', features: [] })
      return
    }
    // In the colour of the layer it goes into.
    map.setPaintProperty(`${GRAPHIC_DRAFT}_line`, 'line-color', ['coalesce', ['get', 'stroke'], draft.colour])
    const lib = await graphicsLibrary()
    if (this.pendingGraphic !== draft) return // something newer
    const bounds = map.getBounds()
    let pieces: GeoJSON.Feature[] = []
    try {
      pieces = renderGraphic(lib, {
        sidc: draft.sidc,
        points: draft.axis
          ? axisControlPoints(draft.points, Math.max(10, axisWidth(draft.points) * (draft.widthFactor ?? 1)))
          : isDirection(draft.sidc)
            ? [...draft.points].reverse()
            : draft.points,
        modifiers: {},
        scale: mapScale(map.getZoom(), map.getCenter().lat),
        bbox: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()]
      })
    } catch {
      // Not drawable with these points (yet): nothing.
    }
    source.setData({ type: 'FeatureCollection', features: pieces })
  }

  /** The shape being drawn (line/area tools); cursor: where the line goes on to
   * (no point drawn there: none has been put down yet); line: false, the points only. */
  draft(points: [number, number][], closed: boolean, cursor?: [number, number], line = true) {
    this.ensureOverlays()
    const coordinates = cursor && points.length ? [...points, cursor] : points
    const features: GeoJSON.Feature[] = points.map((c) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: c },
      properties: {}
    }))
    if (line && coordinates.length > 1) {
      features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: closed ? [...coordinates, coordinates[0]] : coordinates
        },
        properties: {}
      })
    }
    ;(this.map.getSource(DRAFT) as GeoJSONSource).setData({ type: 'FeatureCollection', features })
  }
}
