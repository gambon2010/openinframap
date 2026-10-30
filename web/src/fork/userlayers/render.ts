// Fork: draws "My layers". Each layer is a GeoJSON source (user_<id>) with its own
// map layers (user_<id>_fill/_line/_symbol). Copies of map features are drawn by
// clones of upstream's layers for that data (user_<id>__power_line...), so a
// copied 225 kV line looks just like the original, at every zoom. Ids start with
// user_, which the layer switcher and the key never hide (fork/key).
// Tactical graphics (arrows, phase lines, areas...) are drawn by the C5ISR renderer
// (graphics.ts) into a second source per layer (user_<id>_g), redrawn when the
// zoom changes (arrow heads and teeth depend on the scale).
import { FilterSpecification, GeoJSONSource, LayerSpecification, Map as MapLibreMap } from 'maplibre-gl'
import { LayerSpecificationWithZIndex } from '../../style/types.ts'
import { font, text_paint } from '../../style/common.ts'
import { DEFAULT_COLOR, UserFeature, UserLayer } from './model.ts'
import { ensureImage, getLabelLevel, iconName } from './symbols.ts'
import {
  axisControlPoints,
  axisWidth,
  axisWidthFrom,
  axisWidthPoint,
  graphicsLibrary,
  isAxis,
  mapScale,
  pathFromAxisPoints,
  renderGraphic
} from './graphics.ts'
import { modifiersToDraw } from './fields.ts'

const SELECTION = 'user_selection'
const DRAFT = 'user_draft'

function sourceId(layerId: string) {
  return `user_${layerId}`
}

/** A feature as drawn: its properties plus what the map layers need. */
function drawn(feature: UserFeature, layerColor: string): GeoJSON.Feature {
  const p = feature.properties
  return {
    type: 'Feature',
    geometry: feature.geometry,
    properties: {
      ...p,
      copy: undefined,
      fid: feature.id,
      icon: iconName(p, layerColor),
      copy_key: p.copy ? `${p.copy.source}/${p.copy.sourceLayer}` : null
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
// Copies are drawn by clones of upstream's layers, graphics from their own source.
const OWN: FilterSpecification = ['!', ['in', ['get', 'kind'], ['literal', ['copy', 'graphic']]]]

function graphicsSourceId(layerId: string) {
  return `user_${layerId}_g`
}

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
  const kind = feature?.properties.kind
  return feature?.geometry.type === 'Point' && (kind === 'image' || kind === 'symbol' || kind === 'marker')
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
    // A new style (e.g. another background map) drops everything added here.
    map.on('style.load', () => {
      if (this.last) void this.render(this.last.layers, this.last.hidden)
    })
  }

  private ownLayers(layer: UserLayer): LayerSpecification[] {
    const source = sourceId(layer.id)
    const color = ['coalesce', ['get', 'color'], layer.style.color ?? DEFAULT_COLOR]
    return [
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
    const source = graphicsSourceId(layer.id)
    return [
      {
        id: `${source}_fill`,
        type: 'fill',
        source,
        filter: ['all', POLYGON, ['!=', ['get', 'fill'], null]],
        paint: { 'fill-color': ['get', 'fill'], 'fill-opacity': ['get', 'fillOpacity'] }
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
          'line-opacity': 0.8
        }
      },
      {
        id: `${source}_line`,
        type: 'line',
        source,
        filter: LINE_OR_POLYGON,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': ['coalesce', ['get', 'stroke'], layer.style.color ?? DEFAULT_COLOR],
          'line-width': ['get', 'width']
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
          'text-halo-width': 2
        }
      }
    ] as LayerSpecification[]
  }

  /** Draw the graphics of the layers shown (after render(), and on zoom); `changed`
   * draws a feature being dragged as it is now. */
  private async renderGraphics(changed?: UserFeature) {
    if (!this.last) return
    const { layers } = this.last
    const withGraphics = [...layers.values()].filter((l) =>
      [...l.features.values()].some((f) => f.properties.kind === 'graphic')
    )
    if (!withGraphics.length) return
    const lib = await graphicsLibrary()
    if (!this.last || this.last.layers !== layers) return
    const map = this.map
    const zoom = map.getZoom()
    this.graphicsZoom = zoom
    const bounds = map.getBounds()
    const scale = mapScale(zoom, map.getCenter().lat)
    const level = getLabelLevel()
    for (const layer of withGraphics) {
      const features: GeoJSON.Feature[] = []
      for (const stored of layer.features.values()) {
        let f = changed && stored.id === changed.id ? changed : stored
        if (f.properties.kind !== 'graphic' || !f.properties.sidc) continue
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
                : controlPoints(f.geometry),
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
      const filter = (
        original.filter
          ? ['all', ['==', ['get', 'copy_key'], key], original.filter]
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
      map.once('idle', () => void this.render(layers, hidden))
      return
    }
    const icons = new Set<string>()
    for (const layer of layers.values()) {
      for (const f of layer.features.values()) {
        const icon = iconName(f.properties, layer.style.color ?? DEFAULT_COLOR)
        if (icon) icons.add(icon)
      }
    }
    await Promise.all([...icons].map((icon) => ensureImage(map, icon)))
    if (this.last.layers !== layers) return // something newer is being drawn

    const wanted = new Set<string>()
    for (const layer of layers.values()) {
      const source = sourceId(layer.id)
      const data: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: [...layer.features.values()].map((f) => drawn(f, layer.style.color ?? DEFAULT_COLOR))
      }
      const existing = map.getSource(source) as GeoJSONSource | undefined
      if (existing) existing.setData(data)
      else map.addSource(source, { type: 'geojson', data, promoteId: 'fid' })

      const graphicsSource = graphicsSourceId(layer.id)
      if (!map.getSource(graphicsSource)) {
        map.addSource(graphicsSource, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      }
      for (const spec of [
        ...this.copyLayers(layer),
        ...this.graphicLayers(layer),
        ...this.ownLayers(layer)
      ]) {
        wanted.add(spec.id)
        if (!map.getLayer(spec.id))
          map.addLayer(spec, this.map.getLayer(`${SELECTION}_line`) ? `${SELECTION}_line` : undefined)
        map.setLayoutProperty(spec.id, 'visibility', hidden.has(layer.id) ? 'none' : 'visible')
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
        id !== DRAFT &&
        ![...layers.keys()].some((l) => sourceId(l) === id || graphicsSourceId(l) === id)
      ) {
        map.removeSource(id)
      }
    }
    this.ensureOverlays()
    // The selection's resize handle needs the image, which may only be loaded now.
    if (resizable(this.selected)) this.select(this.selected)
    await this.renderGraphics()
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
    for (const id of [SELECTION, DRAFT]) {
      if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: empty })
    }
    const overlays: LayerSpecification[] = [
      {
        id: `${SELECTION}_line`,
        type: 'line',
        source: SELECTION,
        paint: { 'line-color': '#ffd600', 'line-width': 8, 'line-opacity': 0.6 }
      },
      {
        // The points of a selected line, area or graphic: drag one to move it.
        id: `${SELECTION}_vertex`,
        type: 'circle',
        source: SELECTION,
        filter: ['all', POINT, ['==', ['get', 'vertex'], true]] as FilterSpecification,
        paint: {
          'circle-radius': 6,
          // An arrow's size handle is blue, like the resize handle of pictures.
          'circle-color': '#fff',
          'circle-stroke-color': ['case', ['==', ['get', 'width'], true], '#1565c0', '#b88a00'],
          'circle-stroke-width': ['case', ['==', ['get', 'width'], true], 3, 2]
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
          'circle-stroke-color': '#1565c0',
          'circle-stroke-width': 3
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
          'circle-stroke-color': '#ffd600',
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
        filter: POINT,
        paint: {
          'circle-radius': 5,
          'circle-color': '#fff',
          'circle-stroke-color': '#1565c0',
          'circle-stroke-width': 2
        }
      }
    ]
    for (const spec of overlays) if (!map.getLayer(spec.id)) map.addLayer(spec)
  }

  /** Highlight a feature (null: none); pictures, symbols and markers get a resize handle. */
  select(feature: UserFeature | null) {
    this.selected = feature
    this.ensureOverlays()
    const features = feature ? selectionFeatures(feature) : []
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

  /** Half the width and height on screen (px) of a point feature's image at size 1. */
  iconHalfSize(feature: UserFeature): [number, number] | null {
    const layer = [...(this.last?.layers.values() ?? [])].find((l) => l.features.has(feature.id))
    const name = iconName(feature.properties, layer?.style.color ?? DEFAULT_COLOR)
    const image = name ? this.map.getImage(name) : null
    if (!image) return null
    const ratio = image.pixelRatio || 1
    return [image.data.width / ratio / 2, image.data.height / ratio / 2]
  }

  /** Where the resize handle goes: the bottom-right corner of the image. */
  private resizeHandle(feature: UserFeature): [number, number] | null {
    if (!resizable(feature)) return null
    const half = this.iconHalfSize(feature)
    if (!half) return null
    const size = feature.properties.size ?? 1
    const centre = this.map.project((feature.geometry as GeoJSON.Point).coordinates as [number, number])
    const corner = this.map.unproject([centre.x + half[0] * size, centre.y + half[1] * size])
    return [corner.lng, corner.lat]
  }

  /** Draw a feature as it's being changed (e.g. resized), before it's saved. */
  preview(layerId: string, feature: UserFeature) {
    const layer = this.last?.layers.get(layerId)
    const source = this.map.getSource(sourceId(layerId)) as GeoJSONSource | undefined
    if (!layer || !source) return
    if (feature.properties.kind === 'graphic') {
      void this.renderGraphics(feature)
      return
    }
    const color = layer.style.color ?? DEFAULT_COLOR
    source.setData({
      type: 'FeatureCollection',
      features: [...layer.features.values()].map((f) => drawn(f.id === feature.id ? feature : f, color))
    })
  }

  /** The shape being drawn (line/area tools). */
  draft(coordinates: [number, number][], closed: boolean) {
    this.ensureOverlays()
    const features: GeoJSON.Feature[] = coordinates.map((c) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: c },
      properties: {}
    }))
    if (coordinates.length > 1) {
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

/** A selected feature as drawn: its shape (a graphic: the line through its control
 * points), and its points as handles when it has more than one. */
export function selectionFeatures(feature: UserFeature): GeoJSON.Feature[] {
  const graphic = feature.properties.kind === 'graphic'
  const points = graphic ? controlPoints(feature.geometry) : vertices(feature.geometry)
  const shape: GeoJSON.Geometry =
    graphic && points.length > 1 ? { type: 'LineString', coordinates: points } : feature.geometry
  const out: GeoJSON.Feature[] = [{ type: 'Feature', geometry: shape, properties: {} }]
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
