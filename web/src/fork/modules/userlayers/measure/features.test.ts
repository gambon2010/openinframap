import { describe, expect, test } from 'vitest'
import { measurementFeatures, measurementOf, summary } from './features.ts'

const leg: [number, number][] = [
  [7, 47],
  [7, 48]
]

describe('measurements', () => {
  test('read from an item', () => {
    expect(
      measurementOf({
        geometry: { type: 'LineString', coordinates: leg },
        properties: { kind: 'measure', measure: 'distance' }
      })
    ).toEqual({ type: 'distance', points: leg })
    const ring = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0]
    ]
    expect(
      measurementOf({
        geometry: { type: 'Polygon', coordinates: [ring] },
        properties: { kind: 'measure', measure: 'area' }
      })?.points
    ).toHaveLength(3)
    expect(
      measurementOf({
        geometry: { type: 'Point', coordinates: [7, 47] },
        properties: { kind: 'measure', measure: 'rings' }
      })?.radii
    ).toEqual([1000, 5000, 10000])
  })

  test('what they come to', () => {
    expect(summary({ type: 'distance', points: leg })).toBe('111 km, 000°T (0 mils)')
    expect(summary({ type: 'distance', points: [...leg, [8, 48]] })).toMatch(/^186 km$/)
    expect(summary({ type: 'rings', points: [[7, 47]], radii: [1000, 5000] })).toBe('1 km, 5 km')
    expect(
      summary({
        type: 'area',
        points: [
          [0, 0],
          [0.01, 0],
          [0.01, 0.01],
          [0, 0.01]
        ]
      })
    ).toMatch(/^1\.2 km², perimeter 4\.45 km$/)
  })

  test('drawn: each leg labelled, the total at the end; rings labelled four times', () => {
    const features = measurementFeatures({ type: 'distance', points: [...leg, [8, 48]] })
    const labels = features.map((f) => f.properties?.label).filter(Boolean)
    expect(labels).toHaveLength(3)
    expect(labels[2]).toBe('186 km')
    const rings = measurementFeatures({ type: 'rings', points: [[7, 47]], radii: [1000, 2000] })
    expect(rings.filter((f) => f.geometry.type === 'LineString')).toHaveLength(2)
    expect(rings.filter((f) => f.properties?.label === '2 km')).toHaveLength(4)
  })

  test('long legs follow their great circle; marks only when asked', () => {
    const [line] = measurementFeatures({ type: 'distance', points: leg }).filter(
      (f) => f.geometry.type === 'LineString'
    )
    expect((line.geometry as GeoJSON.LineString).coordinates.length).toBeGreaterThan(2)
    const withTicks = measurementFeatures({ type: 'distance', points: leg }, { ticks: { zoom: 9 } })
    expect(withTicks.some((f) => f.properties?.tick)).toBe(true)
    expect(measurementFeatures({ type: 'distance', points: leg }).some((f) => f.properties?.tick)).toBe(false)
  })

  test("the one being drawn is marked as a draft, with its points; the item's id on all", () => {
    const features = measurementFeatures(
      { type: 'area', points: leg },
      { draft: true, properties: { fid: 'x' } }
    )
    expect(features.every((f) => f.properties?.draft && f.properties.fid === 'x')).toBe(true)
    expect(features.some((f) => f.properties?.vertex)).toBe(true)
  })
})

describe("a leg's length typed over", () => {
  test('its end moves along the same bearing; the legs after keep theirs', async () => {
    const { withLegLength, legsOf } = await import('./features.ts')
    const { bearing, distance } = await import('./geo.ts')
    const points: [number, number][] = [
      [7, 47],
      [7.1, 47.05],
      [7.2, 47]
    ]
    const changed = withLegLength(points, 0, 5000)
    expect(changed[0]).toEqual(points[0])
    expect(distance(changed[0], changed[1])).toBeCloseTo(5000, 3)
    expect(bearing(changed[0], changed[1])).toBeCloseTo(bearing(points[0], points[1]), 6)
    expect(distance(changed[1], changed[2])).toBeCloseTo(distance(points[1], points[2]), 3)
    expect(legsOf({ type: 'area', points })).toHaveLength(3)
    expect(legsOf({ type: 'distance', points })).toHaveLength(2)
  })
})

describe('lengths as written and typed', () => {
  test('to the metre; typed with units, or metres', async () => {
    const { formatLength, parseLength } = await import('./geo.ts')
    expect(formatLength(18450.4)).toBe('18 km 450 m')
    expect(formatLength(18000)).toBe('18 km')
    expect(formatLength(450)).toBe('450 m')
    expect(parseLength('18 km 450 m')).toBe(18450)
    expect(parseLength('2,5 km')).toBe(2500)
    expect(parseLength('800')).toBe(800)
    expect(parseLength('1 nm')).toBe(1852)
    expect(parseLength('far')).toBeNull()
  })
})

describe('labels that fit', () => {
  test('a leg too short on screen for all its label: only its length', () => {
    const leg: [number, number][] = [
      [7, 47.8],
      [7.5, 47.8]
    ]
    const label = (zoom: number) =>
      measurementFeatures({ type: 'distance', points: leg }, { zoom }).find((f) => f.properties?.label)
        ?.properties?.label
    expect(label(11)).toMatch(/·/)
    expect(label(7)).toMatch(/^[\d.]+ km$/)
  })
})
