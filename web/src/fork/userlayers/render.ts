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
import { graphicsLibrary, mapScale, renderGraphic } from './graphics.ts'
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

export class Renderer {
  private map: MapLibreMap
  private primaryLayers: () => LayerSpecificationWithZIndex[]
  private last: { layers: Map<string, UserLayer>; hidden: Set<string> } | null = null

  private graphicsZoom = -1

  constructor(map: MapLibreMap, primaryLayers: () => LayerSpecificationWithZIndex[]) {
    this.map = map
    this.primaryLayers = primaryLayers
    // Arrow heads, teeth and labels are sized for a scale: redraw on zoom.
    map.on('zoomend', () => {
      if (this.last && Math.abs(map.getZoom() - this.graphicsZoom) >= 0.5) void this.renderGraphics()
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
          'text-size': 13,
          'text-rotate': ['get', 'angle'],
          'text-rotation-alignment': 'map',
          'text-allow-overlap': true,
          'text-ignore-placement': true
        },
        paint: { 'text-color': ['get', 'color'], 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 }
      }
    ] as LayerSpecification[]
  }

  /** Draw the graphics of the layers shown (after render(), and on zoom). */
  private async renderGraphics() {
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
      for (const f of layer.features.values()) {
        if (f.properties.kind !== 'graphic' || !f.properties.sidc) continue
        try {
          const pieces = renderGraphic(lib, {
            sidc: f.properties.sidc,
            points: controlPoints(f.geometry),
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
          'circle-color': '#fff',
          'circle-stroke-color': '#b88a00',
          'circle-stroke-width': 2
        }
      },
      {
        id: `${SELECTION}_point`,
        type: 'circle',
        source: SELECTION,
        filter: ['all', POINT, ['!=', ['get', 'vertex'], true]] as FilterSpecification,
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

  /** Highlight a feature (null: none). */
  select(feature: UserFeature | null) {
    this.ensureOverlays()
    ;(this.map.getSource(SELECTION) as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: feature ? selectionFeatures(feature) : []
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
