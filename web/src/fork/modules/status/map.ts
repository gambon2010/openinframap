// Fork: features with a problem status on the map (GET /userdata/status): a
// coloured casing along lines, an outline round areas, a ring round points, and
// from zoom 12 a badge with the status's sign. The layers start with "status_",
// the layer switcher's "Feature statuses" entry.
import { ExpressionSpecification, GeoJSONSource, Map } from 'maplibre-gl'
import type { FeatureCollection, Point } from 'geojson'
import { LayerSpecificationWithZIndex } from '../../../style/types.ts'
import { PROBLEMS, Status, statusLook } from './statuses.ts'

const SHAPES = 'feature_status'
const BADGES = 'feature_status_badge'
const BADGE_PIXELS = 20
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }

/** The status's colour, for paint properties. */
const color = [
  'match',
  ['get', 'status'],
  ...PROBLEMS.flatMap((status) => [status, statusLook(status).color]),
  '#868e96'
] as unknown as ExpressionSpecification

export function statusSources() {
  return {
    [SHAPES]: { type: 'geojson' as const, data: EMPTY },
    [BADGES]: { type: 'geojson' as const, data: EMPTY }
  }
}

export function statusLayers(): LayerSpecificationWithZIndex[] {
  const kind = (...types: string[]): ExpressionSpecification => ['in', ['geometry-type'], ['literal', types]]
  const lines = kind('LineString', 'MultiLineString')
  const areas = kind('Polygon', 'MultiPolygon')
  const points = kind('Point', 'MultiPoint')
  // Above the infrastructure (power lines and stations reach about 270), below labels.
  return [
    {
      zorder: 280,
      id: 'status_area_fill',
      type: 'fill',
      source: SHAPES,
      filter: areas,
      paint: { 'fill-color': color, 'fill-opacity': 0.15 }
    },
    {
      zorder: 281,
      id: 'status_area_outline',
      type: 'line',
      source: SHAPES,
      filter: areas,
      paint: { 'line-color': color, 'line-width': 3, 'line-opacity': 0.9 }
    },
    {
      // A halo along each side of the line, the line itself showing between.
      zorder: 282,
      id: 'status_line_casing',
      type: 'line',
      source: SHAPES,
      filter: lines,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': color,
        'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1.5, 14, 3],
        'line-gap-width': ['interpolate', ['linear'], ['zoom'], 5, 2, 14, 6],
        'line-opacity': 0.9
      }
    },
    {
      zorder: 283,
      id: 'status_point_ring',
      type: 'circle',
      source: SHAPES,
      filter: points,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 5, 14, 14],
        'circle-opacity': 0,
        'circle-stroke-color': color,
        'circle-stroke-width': 3
      }
    },
    {
      zorder: 284,
      id: 'status_badge',
      type: 'symbol',
      source: BADGES,
      minzoom: 12,
      layout: {
        'icon-image': ['concat', 'status-badge-', ['get', 'status']],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        // At the corner of a point's icon; on lines and areas, on them.
        'icon-offset': ['case', ['get', 'point'], ['literal', [14, -14]], ['literal', [0, 0]]]
      }
    }
  ]
}

/** A round badge with the status's sign (drawn by the browser, any character). */
export function badgeImage(status: Status, pixels = BADGE_PIXELS, ratio = 2): ImageData | null {
  const look = statusLook(status)
  if (!look.symbol) return null
  const size = pixels * ratio
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) return null
  context.beginPath()
  context.arc(size / 2, size / 2, size / 2 - ratio, 0, 2 * Math.PI)
  context.fillStyle = look.color
  context.fill()
  context.lineWidth = 1.5 * ratio
  context.strokeStyle = '#ffffff'
  context.stroke()
  context.fillStyle = status === 'threatened' ? '#1a1a1a' : '#ffffff'
  context.font = `bold ${Math.round(size * 0.55)}px sans-serif`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(look.symbol, size / 2, size / 2 + ratio)
  return context.getImageData(0, 0, size, size)
}

export class StatusMap {
  private data: FeatureCollection = EMPTY

  constructor(private map: Map) {
    this.addBadges()
    // A new style (another background map) starts without them, and with empty sources.
    map.on('style.load', () => {
      this.addBadges()
      this.draw()
    })
  }

  private addBadges() {
    for (const status of PROBLEMS) {
      const id = `status-badge-${status}`
      const image = badgeImage(status)
      if (image && !this.map.hasImage(id)) this.map.addImage(id, image, { pixelRatio: 2 })
    }
  }

  /** Load the statuses again (after one was set). */
  async refresh() {
    try {
      const response = await fetch('/userdata/status')
      if (!response.ok) return
      this.data = await response.json()
    } catch {
      return
    }
    this.draw()
  }

  private draw() {
    const shapes = this.map.getSource(SHAPES) as GeoJSONSource | undefined
    const badges = this.map.getSource(BADGES) as GeoJSONSource | undefined
    if (!shapes || !badges) return
    shapes.setData(this.data)
    badges.setData({
      type: 'FeatureCollection',
      features: this.data.features.map((f) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: f.properties?.badge } as Point,
        properties: { status: f.properties?.status, point: f.geometry.type.endsWith('Point') }
      }))
    })
  }
}
