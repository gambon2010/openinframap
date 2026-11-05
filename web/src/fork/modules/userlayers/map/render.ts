// Fork: draws "My layers". Each layer is a GeoJSON source (user_<id>) with its own
// map layers (user_<id>_fill/_line/_symbol). Copies of map features are drawn by
// clones of upstream's layers for that data (user_<id>__power_line...), so a
// copied 225 kV line looks just like the original, at every zoom. Ids start with
// user_, which the layer switcher and the key never hide (fork/key).
// Tactical graphics (arrows, phase lines, areas...) are drawn by the C5ISR renderer
// (graphics.ts) into a second source per layer (user_<id>_g), redrawn when the
// zoom changes (arrow heads and teeth depend on the scale).
import {
  FilterSpecification,
  GeoJSONSource,
  LayerSpecification,
  Map as MapLibreMap,
  SymbolLayerSpecification
} from 'maplibre-gl'
import { LayerSpecificationWithZIndex } from '../../../../style/types.ts'
import { font, text_paint } from '../../../../style/common.ts'
import { DEFAULT_COLOR, UserFeature, UserLayer } from '../model/model.ts'
import { getLabelLevel } from './symbols.ts'
import { ensureImage, iconName } from './icons.ts'
import { KINDS, kindOf } from '../kinds/index.ts'
import { Measurement, measurementFeatures, measurementOf } from '../measure/features.ts'
import { measurePrefs } from '../measure/prefs.ts'
import {
  axisControlPoints,
  axisWidth,
  axisWidthFrom,
  axisWidthPoint,
  graphicsLibrary,
  isAxis,
  mapScale,
  pathFromAxisPoints,
  renderGraphic,
  squareUp
} from './graphics.ts'
import { modifiersToDraw } from '../model/fields.ts'
import { SUPPLY_COLOURS, supplyColours } from '../../../ui/supply.ts'

const SELECTION = 'user_selection'
// The selection's yellow, and its handles' darker yellow (points, sizes, widths).
const HIGHLIGHT = '#ffd600'
const HANDLE = '#b88a00'
const DRAFT = 'user_draft'
// What a placing tool would put down, faint under the cursor ("user_draft…": kept
// with the draft when the map's layers are tidied).
const GHOST = 'user_draft_ghost'
// A graphic being drawn, as it will look (faint).
const GRAPHIC_DRAFT = 'user_draft_graphic'

function sourceId(layerId: string) {
  return `user_${layerId}`
}

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

const POLYGON: FilterSpecification = ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]]
const LINE_OR_POLYGON: FilterSpecification = [
  'in',
  ['geometry-type'],
  ['literal', ['LineString', 'MultiLineString', 'Polygon', 'MultiPolygon']]
]
const POINT: FilterSpecification = ['in', ['geometry-type'], ['literal', ['Point', 'MultiPoint']]]
// Kinds drawn the standard way (kinds/): copies are drawn by clones of upstream's
// layers, graphics from their own source.
const OWN: FilterSpecification = [
  '!',
  ['in', ['get', 'kind'], ['literal', KINDS.filter((k) => k.drawn !== 'standard').map((k) => k.id)]]
]

/** Drawn by the tactical graphics renderer (graphics.ts). */
const isGraphic = (f: UserFeature) => kindOf(f.properties).drawn === 'graphic'

/** A graphic being drawn (Renderer.graphicDraft). */
export interface GraphicDraft {
  sidc: string
  points: [number, number][]
  /** An arrow: the points are its path (its width follows from them). */
  axis?: boolean
  /** An arrow: its width against the automatic one. */
  widthFactor?: number
  colour: string
}

function graphicsSourceId(layerId: string) {
  return `user_${layerId}_g`
}

/** Measurement labels: turned and placed as each says (measure/features.ts); where
 * two would overlap, the one with the lower priority stays (the total first). */
const MEASURE_LABEL_LAYOUT: SymbolLayerSpecification['layout'] = {
  'text-field': ['coalesce', ['get', 'label'], ['get', 'tickLabel']],
  'text-font': font,
  'text-size': ['case', ['has', 'tickLabel'], 10, ['==', ['get', 'big'], true], 14, 12],
  'text-rotate': ['coalesce', ['get', 'rotate'], 0],
  'text-rotation-alignment': 'map',
  'text-offset': ['coalesce', ['array', 'number', 2, ['get', 'offset']], ['literal', [0, 0]]],
  'text-anchor': ['coalesce', ['get', 'anchor'], 'center'],
  'symbol-sort-key': ['coalesce', ['get', 'priority'], 1],
  'text-allow-overlap': false,
  'text-padding': 1,
  // One line along the leg ("23.7 km · 005°T (89 mils)").
  'text-max-width': 40
}

function measureSourceId(layerId: string) {
  return `user_${layerId}_m`
}

const isMeasure = (f: UserFeature) => kindOf(f.properties).drawn === 'measure'

/** The control points of a graphic (stored as a line through them). */
export function controlPoints(geometry: GeoJSON.Geometry): [number, number][] {
  if (geometry.type === 'LineString' || geometry.type === 'MultiPoint')
    return geometry.coordinates as [number, number][]
  if (geometry.type === 'Point') return [geometry.coordinates as [number, number]]
  if (geometry.type === 'Polygon') return geometry.coordinates[0] as [number, number][]
  return []
}

// Sizes a picture, symbol or marker can have (1 = its normal size).
export const MIN_SIZE = 0.2
export const MAX_SIZE = 8

/** Kinds drawn as an image that the resize handle (and the Size slider) apply to. */
export function resizable(feature: UserFeature | null): boolean {
  return feature?.geometry.type === 'Point' && Boolean(kindOf(feature.properties).sized)
}

/**
 * The size when the resize handle is dragged: how far the pointer is from the
 * centre, against where the handle sits at size 1. Clamped, in steps of 0.05.
 */
export function sizeFromDrag(distance: number, distanceAtSize1: number): number {
  if (!(distanceAtSize1 > 0)) return 1
  const size = Math.round((distance / distanceAtSize1) * 20) / 20
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, size))
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

  private ownLayers(layer: UserLayer): LayerSpecification[] {
    const source = sourceId(layer.id)
    const color = ['coalesce', ['get', 'color'], layer.style.color ?? DEFAULT_COLOR]
    return [
      // Items in conflict: an orange dashed ring or outline, under the item.
      {
        id: `${source}_conflict_line`,
        type: 'line',
        source,
        filter: ['all', ['has', 'conflict'], LINE_OR_POLYGON],
        paint: { 'line-color': '#e8590c', 'line-width': 8, 'line-dasharray': [1, 1], 'line-opacity': 0.8 }
      },
      {
        id: `${source}_conflict_point`,
        type: 'circle',
        source,
        filter: ['all', ['has', 'conflict'], POINT],
        paint: {
          'circle-radius': 22,
          'circle-opacity': 0,
          'circle-stroke-color': '#e8590c',
          'circle-stroke-width': 3
        }
      },
      {
        id: `${source}_fill`,
        type: 'fill',
        source,
        filter: ['all', POLYGON, OWN],
        paint: { 'fill-color': color, 'fill-opacity': 0.2 }
      },
      {
        id: `${source}_line`,
        type: 'line',
        source,
        filter: ['all', LINE_OR_POLYGON, OWN],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': color, 'line-width': ['coalesce', ['get', 'width'], 3] }
      },
      {
        id: `${source}_symbol`,
        type: 'symbol',
        source,
        filter: ['all', POINT, OWN],
        layout: {
          'icon-image': ['coalesce', ['get', 'icon'], ''],
          'icon-size': ['coalesce', ['get', 'size'], 1],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'text-field': ['coalesce', ['get', 'name'], ''],
          'text-font': font,
          'text-size': 12,
          'text-offset': [0, 1.6],
          'text-anchor': 'top',
          'text-optional': true
        },
        paint: text_paint
      }
    ] as LayerSpecification[]
  }

  private graphicLayers(layer: UserLayer): LayerSpecification[] {
    return this.graphicSpecs(graphicsSourceId(layer.id), layer.style.color ?? DEFAULT_COLOR)
  }

  /** The map layers a graphic's pieces are drawn with (graphics.ts renderGraphic):
   * fills, a casing, lines in their colour (else `colour`), labels; faint for a
   * preview (opacity). */
  private graphicSpecs(source: string, colour: string, opacity = 1): LayerSpecification[] {
    // The selected graphics glow under their own lines (not for a preview).
    const highlight: LayerSpecification[] =
      opacity === 1
        ? [
            {
              id: `${source}_highlight`,
              type: 'line',
              source,
              filter: this.highlightFilter('graphic'),
              layout: { 'line-join': 'round', 'line-cap': 'round' },
              paint: {
                'line-color': HIGHLIGHT,
                'line-width': ['+', ['coalesce', ['get', 'width'], 2], 10],
                'line-opacity': 0.6
              }
            } as LayerSpecification
          ]
        : []
    return [
      ...highlight,
      {
        id: `${source}_fill`,
        type: 'fill',
        source,
        filter: ['all', POLYGON, ['!=', ['get', 'fill'], null]],
        paint: { 'fill-color': ['get', 'fill'], 'fill-opacity': ['*', ['get', 'fillOpacity'], opacity] }
      },
      {
        id: `${source}_casing`,
        type: 'line',
        source,
        filter: ['all', LINE_OR_POLYGON, ['!=', ['get', 'casing'], null]],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': ['get', 'casing'],
          'line-width': ['+', ['get', 'width'], 2],
          'line-opacity': 0.8 * opacity
        }
      },
      {
        id: `${source}_line`,
        type: 'line',
        source,
        filter: LINE_OR_POLYGON,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': ['coalesce', ['get', 'stroke'], colour],
          'line-width': ['get', 'width'],
          'line-opacity': opacity
        }
      },
      {
        id: `${source}_label`,
        type: 'symbol',
        source,
        filter: POINT,
        layout: {
          'text-field': ['get', 'label'],
          'text-font': font,
          'text-size': 15,
          'text-rotate': ['get', 'angle'],
          'text-rotation-alignment': 'map',
          'text-allow-overlap': true,
          'text-ignore-placement': true
        },
        paint: {
          'text-color': ['get', 'color'],
          'text-halo-color': ['coalesce', ['get', 'halo'], '#ffffff'],
          'text-halo-width': 2,
          'text-opacity': opacity
        }
      }
    ] as LayerSpecification[]
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

  /** Power supply mode: copies of power lines, substations and plants in their
   * original's colour (ui/supply.ts), over their own look; nothing while it's off. */
  private supplyLayers(layer: UserLayer): LayerSpecification[] {
    if (!supplyColours.active) return []
    const source = sourceId(layer.id)
    const colour = [
      'match',
      ['get', 'supply'],
      'red',
      SUPPLY_COLOURS.red,
      'orange',
      SUPPLY_COLOURS.orange,
      'risk',
      SUPPLY_COLOURS.risk,
      SUPPLY_COLOURS.green
    ] as unknown as string
    return [
      {
        id: `${source}__supply_line`,
        type: 'line',
        source,
        filter: ['all', ['has', 'supply'], LINE_OR_POLYGON] as FilterSpecification,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': colour, 'line-width': 5 }
      },
      {
        id: `${source}__supply_point`,
        type: 'circle',
        source,
        filter: ['all', ['has', 'supply'], POINT] as FilterSpecification,
        paint: {
          'circle-color': colour,
          'circle-radius': 9,
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 2
        }
      }
    ]
  }

  /** Upstream's layers for the data copies came from, drawing the copies instead. */
  private copyLayers(layer: UserLayer): LayerSpecification[] {
    const keys = new Set<string>()
    for (const f of layer.features.values()) {
      const copy = f.properties.copy
      if (copy) keys.add(`${copy.source}/${copy.sourceLayer}`)
    }
    if (!keys.size) return []
    const source = sourceId(layer.id)
    const clones: LayerSpecification[] = []
    for (const original of this.primaryLayers()) {
      if (!('source-layer' in original) || original.id.startsWith('user_')) continue
      const key = `${original.source}/${original['source-layer']}`
      if (!keys.has(key)) continue
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { zorder, minzoom, maxzoom, 'source-layer': _sourceLayer, ...rest } = original
      // A copy stays at every zoom: the original's "only once zoomed in" conditions
      // (small plants, low voltages) are left out; its other ones (a point while
      // zoomed out, an area closer) are kept.
      const filter = (
        original.filter
          ? ['all', ['==', ['get', 'copy_key'], key], withoutMinZoom(original.filter)]
          : ['==', ['get', 'copy_key'], key]
      ) as FilterSpecification
      clones.push({
        ...rest,
        id: `${source}__${original.id}`,
        source,
        filter,
        layout: { ...(original.layout ?? {}), visibility: 'visible' }
      } as LayerSpecification)
    }
    return clones
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
        ...this.copyLayers(layer),
        ...this.supplyLayers(layer),
        ...this.graphicLayers(layer),
        ...this.measureLayers(layer),
        ...this.ownLayers(layer)
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

  private measureLayers(layer: UserLayer): LayerSpecification[] {
    const source = measureSourceId(layer.id)
    const color = ['get', 'color']
    return [
      {
        // A selected measurement glows under its lines and rings, like a line.
        id: `${source}_highlight`,
        type: 'line',
        source,
        filter: this.highlightFilter('measure'),
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': HIGHLIGHT, 'line-width': 12, 'line-opacity': 0.6 }
      },
      {
        id: `${source}_fill`,
        type: 'fill',
        source,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': color, 'fill-opacity': 0.12 }
      },
      // The lines and their marks (ticks: thinner) in one layer.
      {
        id: `${source}_line`,
        type: 'line',
        source,
        filter: ['==', ['geometry-type'], 'LineString'],
        layout: { 'line-join': 'round' },
        paint: {
          'line-color': color,
          'line-width': ['match', ['coalesce', ['get', 'tick'], ''], 'major', 2, 'minor', 1.2, 2.5]
        }
      },
      {
        id: `${source}_vertex`,
        type: 'circle',
        source,
        filter: ['==', ['get', 'vertex'], true],
        paint: {
          'circle-radius': 4,
          'circle-color': '#fff',
          'circle-stroke-color': color,
          'circle-stroke-width': 2
        }
      },
      // Lengths and bearings (along their leg, above it), the total, the marks'
      // distances (under the line, smaller, in its colour): measure/features.ts.
      {
        id: `${source}_label`,
        type: 'symbol',
        source,
        filter: ['any', ['has', 'label'], ['has', 'tickLabel']],
        layout: MEASURE_LABEL_LAYOUT,
        paint: {
          'text-color': ['case', ['has', 'tickLabel'], color, '#222'],
          'text-halo-color': '#fff',
          'text-halo-width': 2
        }
      }
    ] as unknown as LayerSpecification[]
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
    const overlays: LayerSpecification[] = [
      {
        id: `${SELECTION}_line`,
        type: 'line',
        source: SELECTION,
        paint: {
          'line-color': HIGHLIGHT,
          // A picture, symbol or marker: a thin box around it.
          'line-width': ['case', ['==', ['get', 'outline'], true], 3, 8],
          'line-opacity': ['case', ['==', ['get', 'outline'], true], 1, 0.6]
        }
      },
      {
        // The points of a selected line, area or graphic: drag one to move it.
        id: `${SELECTION}_vertex`,
        type: 'circle',
        source: SELECTION,
        filter: ['all', POINT, ['==', ['get', 'vertex'], true]] as FilterSpecification,
        paint: {
          'circle-radius': 6,
          'circle-color': '#fff',
          'circle-stroke-color': HANDLE,
          'circle-stroke-width': 2
        }
      },
      {
        // Drag it to resize a picture, symbol or marker.
        id: `${SELECTION}_resize`,
        type: 'circle',
        source: SELECTION,
        filter: ['==', ['get', 'resize'], true],
        paint: {
          'circle-radius': 6,
          'circle-color': '#fff',
          'circle-stroke-color': HANDLE,
          'circle-stroke-width': 2
        }
      },
      {
        id: `${SELECTION}_point`,
        type: 'circle',
        source: SELECTION,
        filter: [
          'all',
          POINT,
          ['!=', ['get', 'vertex'], true],
          ['!=', ['get', 'resize'], true]
        ] as FilterSpecification,
        paint: {
          'circle-radius': 22,
          'circle-color': 'rgba(255, 214, 0, 0.15)',
          'circle-stroke-color': HIGHLIGHT,
          'circle-stroke-width': 3
        }
      },
      {
        id: `${DRAFT}_line`,
        type: 'line',
        source: DRAFT,
        paint: { 'line-color': '#1565c0', 'line-width': 3, 'line-dasharray': [2, 1] }
      },
      {
        id: `${DRAFT}_point`,
        type: 'circle',
        source: DRAFT,
        filter: ['all', POINT, ['!', ['has', 'label']], ['!', ['has', 'tickLabel']]] as FilterSpecification,
        paint: {
          'circle-radius': 5,
          'circle-color': '#fff',
          'circle-stroke-color': '#1565c0',
          'circle-stroke-width': 2
        }
      },
      {
        // What a placing tool would put down, faint, under the cursor.
        id: GHOST,
        type: 'symbol',
        source: GHOST,
        layout: {
          'icon-image': ['get', 'icon'],
          'icon-size': ['coalesce', ['get', 'size'], 1],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true
        },
        paint: { 'icon-opacity': 0.55 }
      },
      {
        // A measurement being drawn: its lengths and bearings so far.
        id: `${DRAFT}_label`,
        type: 'symbol',
        source: DRAFT,
        filter: ['has', 'label'],
        layout: MEASURE_LABEL_LAYOUT,
        paint: { 'text-color': '#1565c0', 'text-halo-color': '#fff', 'text-halo-width': 2 }
      }
    ]
    for (const spec of overlays) if (!map.getLayer(spec.id)) map.addLayer(spec)
  }

  // The graphics and measurements highlighted: they glow under their own lines
  // (renderGraphics, renderMeasures), not a shape drawn over them.
  private highlighted: string[] = []

  /** The pieces of the highlighted items a glow goes under: a graphic's lines and
   * outlines; a measurement's lines and rings, not its tick marks. */
  private highlightFilter(of: 'graphic' | 'measure'): FilterSpecification {
    const ids = ['in', ['get', 'fid'], ['literal', this.highlighted]]
    return (of === 'graphic'
      ? ['all', LINE_OR_POLYGON, ids]
      : [
          'all',
          ['==', ['geometry-type'], 'LineString'],
          ['!', ['has', 'tick']],
          ids
        ]) as unknown as FilterSpecification
  }

  private highlightItems(features: UserFeature[]) {
    const ids = features.filter((f) => isGraphic(f) || isMeasure(f)).map((f) => f.id)
    if (ids.join() === this.highlighted.join()) return
    this.highlighted = ids
    for (const layer of this.map.getStyle().layers) {
      if (!layer.id.startsWith('user_')) continue
      if (layer.id.endsWith('_g_highlight')) this.map.setFilter(layer.id, this.highlightFilter('graphic'))
      if (layer.id.endsWith('_m_highlight')) this.map.setFilter(layer.id, this.highlightFilter('measure'))
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
    const size = feature.properties.size ?? 1
    const pad = 4
    const [l, t, r, b] = [
      box.left * size - pad,
      box.top * size - pad,
      box.right * size + pad,
      box.bottom * size + pad
    ]
    const c = this.map.project((feature.geometry as GeoJSON.Point).coordinates as [number, number])
    const ring = [
      [l, t],
      [r, t],
      [r, b],
      [l, b],
      [l, t]
    ].map(([x, y]) => {
      const at = this.map.unproject([c.x + x, c.y + y])
      return [at.lng, at.lat]
    })
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
    const size = feature.properties.size ?? 1
    const centre = this.map.project((feature.geometry as GeoJSON.Point).coordinates as [number, number])
    const corner = this.map.unproject([centre.x + box.right * size, centre.y + box.bottom * size])
    return [corner.lng, corner.lat]
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
      for (const spec of this.graphicSpecs(GRAPHIC_DRAFT, DEFAULT_COLOR, 0.6)) map.addLayer(spec)
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

/** Items that glow under their own lines when selected (Renderer.highlightItems)
 * rather than have their shape drawn over them: graphics and measurements. */
const glows = (f: UserFeature) => isGraphic(f) || isMeasure(f)

/** A selected feature as drawn: its shape (unless it glows), and its points as
 * handles when it has more than one. */
export function selectionFeatures(feature: UserFeature): GeoJSON.Feature[] {
  const graphic = isGraphic(feature)
  const points = graphic
    ? squareUp(feature.properties.sidc, controlPoints(feature.geometry))
    : vertices(feature.geometry)
  const out: GeoJSON.Feature[] = glows(feature)
    ? []
    : [{ type: 'Feature', geometry: feature.geometry, properties: {} }]
  // Arrows: the size handle, at the arrowhead's corner. Not part of the path (or of
  // the highlighted line): it only sets the width.
  const p = feature.properties
  if (graphic && (p.axis || p.axisWidth !== undefined) && points.length > 1) {
    out.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: axisWidthPoint(points, p.axisWidth ?? axisWidth(points)) },
      properties: { vertex: true, index: -1, width: true }
    })
  }
  if (feature.geometry.type !== 'Point') {
    points.forEach((c, index) =>
      out.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: c },
        properties: { vertex: true, index }
      })
    )
  }
  return out
}

/** The points of a drawing that can be moved (a polygon's closing point left out). */
export function vertices(geometry: GeoJSON.Geometry): [number, number][] {
  if (geometry.type === 'LineString') return geometry.coordinates as [number, number][]
  if (geometry.type === 'Polygon') return (geometry.coordinates[0] as [number, number][]).slice(0, -1)
  return []
}

/** A geometry with one of its movable points moved (vertices() order). */
export function moveVertex(
  geometry: GeoJSON.Geometry,
  index: number,
  to: [number, number]
): GeoJSON.Geometry {
  if (geometry.type === 'LineString') {
    const coordinates = geometry.coordinates.map((c, i) => (i === index ? to : c))
    return { type: 'LineString', coordinates }
  }
  if (geometry.type === 'Polygon') {
    const ring = geometry.coordinates[0].map((c, i, all) =>
      i === index || (index === 0 && i === all.length - 1) ? to : c
    )
    return { type: 'Polygon', coordinates: [ring, ...geometry.coordinates.slice(1)] }
  }
  return geometry
}

/** Every position of a geometry moved by the same amount (degrees). */
export function translateGeometry(geometry: GeoJSON.Geometry, dLng: number, dLat: number): GeoJSON.Geometry {
  const move = (c: unknown): unknown =>
    Array.isArray(c) && typeof c[0] === 'number'
      ? [(c[0] as number) + dLng, (c[1] as number) + dLat, ...c.slice(2)]
      : (c as unknown[]).map(move)
  if (geometry.type === 'GeometryCollection') {
    return { ...geometry, geometries: geometry.geometries.map((g) => translateGeometry(g, dLng, dLat)) }
  }
  return { ...geometry, coordinates: move(geometry.coordinates) } as GeoJSON.Geometry
}

/** The middle of a geometry's bounding box. */
export function geometryCentre(geometry: GeoJSON.Geometry): [number, number] {
  const xs: number[] = []
  const ys: number[] = []
  const add = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === 'number') {
      xs.push(c[0] as number)
      ys.push(c[1] as number)
    } else if (Array.isArray(c)) c.forEach(add)
  }
  if (geometry.type === 'GeometryCollection') geometry.geometries.forEach((g) => add(geometryCentre(g)))
  else add(geometry.coordinates)
  if (!xs.length) return [0, 0]
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]
}

/** A box around an image's drawn part: px from its centre (left and top negative). */
export interface IconBox {
  left: number
  top: number
  right: number
  bottom: number
}

/** The box around an image's visible pixels (RGBA, alpha over a small threshold),
 * in px from its centre on screen; the whole image when nothing is visible. */
export function visibleBox(rgba: ArrayLike<number>, width: number, height: number, ratio = 1): IconBox {
  let [x0, y0, x1, y1] = [width, height, -1, -1]
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] > 16) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) [x0, y0, x1, y1] = [0, 0, width - 1, height - 1]
  return {
    left: (x0 - width / 2) / ratio,
    top: (y0 - height / 2) / ratio,
    right: (x1 + 1 - width / 2) / ratio,
    bottom: (y1 + 1 - height / 2) / ratio
  }
}

const isZoom = (e: unknown) => Array.isArray(e) && e.length === 1 && e[0] === 'zoom'

/** A filter with its minimum-zoom conditions (zoom > n, zoom >= n, n < zoom,
 * n <= zoom) always true; the rest unchanged. */
export function withoutMinZoom<T>(filter: T): T {
  if (!Array.isArray(filter)) return filter
  const [op, a, b] = filter as unknown[]
  if (filter.length === 3) {
    if ((op === '>' || op === '>=') && isZoom(a) && typeof b === 'number') return true as T
    if ((op === '<' || op === '<=') && typeof a === 'number' && isZoom(b)) return true as T
  }
  return filter.map((part) => withoutMinZoom(part)) as T
}
