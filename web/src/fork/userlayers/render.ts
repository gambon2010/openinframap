// Fork: draws "My layers". Each layer is a GeoJSON source (user_<id>) with its own
// map layers (user_<id>_fill/_line/_symbol). Copies of map features are drawn by
// clones of upstream's layers for that data (user_<id>__power_line...), so a
// copied 225 kV line looks just like the original, at every zoom. Ids start with
// user_, which the layer switcher and the key never hide (fork/key).
import { FilterSpecification, GeoJSONSource, LayerSpecification, Map as MapLibreMap } from 'maplibre-gl'
import { LayerSpecificationWithZIndex } from '../../style/types.ts'
import { font, text_paint } from '../../style/common.ts'
import { DEFAULT_COLOR, UserFeature, UserLayer } from './model.ts'
import { ensureImage, iconName } from './symbols.ts'

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
const OWN: FilterSpecification = ['!=', ['get', 'kind'], 'copy']

export class Renderer {
  private map: MapLibreMap
  private primaryLayers: () => LayerSpecificationWithZIndex[]
  private last: { layers: Map<string, UserLayer>; hidden: Set<string> } | null = null

  constructor(map: MapLibreMap, primaryLayers: () => LayerSpecificationWithZIndex[]) {
    this.map = map
    this.primaryLayers = primaryLayers
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

      for (const spec of [...this.copyLayers(layer), ...this.ownLayers(layer)]) {
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
        ![...layers.keys()].some((l) => sourceId(l) === id)
      ) {
        map.removeSource(id)
      }
    }
    this.ensureOverlays()
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
        id: `${SELECTION}_point`,
        type: 'circle',
        source: SELECTION,
        filter: POINT,
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
      features: feature ? [{ type: 'Feature', geometry: feature.geometry, properties: {} }] : []
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
